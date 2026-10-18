import type {
  LibRawImageData,
  LibRawMetadata,
  LibRawSettings,
  LibRawThumbnailData,
} from "libraw-wasm";
import { dngBaselineEv, exposureLut, luminanceStats, matchExposureEv } from "./exposure";

/**
 * Minimal client for the libraw-wasm worker, served as a static asset from
 * /public/libraw (see scripts/copy-wasm.mjs). Mirrors the package's own
 * index.js: messages are `{ id, fn, args }`, replies are `{ id, out | error }`.
 */
const WORKER_URL = "/libraw/worker.js";

export interface RawMetadata {
  make: string;
  model: string;
  iso: number;
  shutter: number; // seconds
  aperture: number;
  focalLength: number;
  timestamp?: Date;
}

export interface DecodedRaw {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  metadata: RawMetadata;
  /** True when we fell back to the embedded JPEG preview. */
  preview: boolean;
  /**
   * EV added so the decode's midtones match the camera's embedded preview
   * (lib/raw/exposure.ts). 0 when not applied: a DNG with its own
   * BaselineExposure, no usable preview, or the preview itself is shown.
   */
  cameraMatchEv: number;
}

export class RawDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RawDecodeError";
  }
}

class LibRawWorker {
  private worker: Worker;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private nextId = 0;

  constructor() {
    this.worker = new Worker(/* turbopackIgnore: true */ WORKER_URL, { type: "module" });
    this.worker.onmessage = ({
      data,
    }: MessageEvent<{ id: number; out?: unknown; error?: string }>) => {
      const p = this.pending.get(data?.id);
      if (!p) return;
      this.pending.delete(data.id);
      if (data.error) p.reject(new RawDecodeError(data.error));
      else p.resolve(data.out);
    };
    this.worker.onerror = (e) => {
      const err = new RawDecodeError(e.message || "RAW decoder worker crashed.");
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
  }

  call<T>(fn: string, ...args: unknown[]): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      const transfer = args
        .filter((a): a is ArrayBufferView => ArrayBuffer.isView(a))
        .map((a) => a.buffer);
      this.worker.postMessage({ id, fn, args }, transfer as Transferable[]);
    });
  }

  dispose() {
    this.worker.terminate();
    const err = new RawDecodeError("RAW decoder disposed.");
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}

export function rawDecodingAvailable(): { ok: boolean; reason?: string } {
  if (typeof window === "undefined") return { ok: false, reason: "no window" };
  if (typeof WebAssembly === "undefined")
    return { ok: false, reason: "WebAssembly isn't supported here." };
  if (!window.crossOriginIsolated) {
    return {
      ok: false,
      reason:
        "RAW decoding needs a cross-origin-isolated page (COOP/COEP headers). Check the headers() config in next.config.ts.",
    };
  }
  return { ok: true };
}

export interface DecodeOptions {
  onStatus?: (status: string) => void;
}

/**
 * Decode a camera RAW / DNG file into an sRGB ImageBitmap using LibRaw, always
 * at the sensor's full resolution: the point of RAW is the untouched picture.
 * (If that exceeds the GPU's texture limit, lib/image.ts scales it down once,
 * to exactly the limit.) Falls back to the embedded JPEG preview if the sensor
 * data can't be decoded (e.g. lossy-compressed DNGs this build lacks a codec for).
 */
export async function decodeRawFile(file: File, opts: DecodeOptions): Promise<DecodedRaw> {
  const avail = rawDecodingAvailable();
  if (!avail.ok) throw new RawDecodeError(avail.reason ?? "RAW decoding unavailable.");

  opts.onStatus?.("Reading file…");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const worker = new LibRawWorker();

  try {
    opts.onStatus?.("Parsing RAW…");
    // First pass: open so we can read the DNG levels before processing.
    await worker.call<void>("open", bytes.slice(), buildSettings({ bright: 1 }));
    const meta = (await worker.call<LibRawMetadata | undefined>("metadata", true)) ?? null;
    if (!meta) throw new RawDecodeError("Couldn't read RAW metadata.");

    // DNG BaselineExposure is the EV offset a viewer must apply to get the
    // intended default rendering (iPhone ProRAW files use +2..+4 EV). Other
    // RAWs have none; they are matched to the camera's preview below instead.
    const baselineEv = dngBaselineEv(meta.color_data?.dng_levels?.baseline_exposure);
    const bright = baselineEv === null ? 1 : clamp(2 ** baselineEv, 0.25, 32);

    // Second pass with the final processing parameters.
    await worker.call<void>("open", bytes.slice(), buildSettings({ bright }));

    const metadata = normaliseMetadata(meta);

    opts.onStatus?.("Demosaicing…");
    let image: LibRawImageData | undefined;
    try {
      image = await worker.call<LibRawImageData | undefined>("imageData");
    } catch (e) {
      image = undefined;
      console.warn("[raw] full decode failed, trying embedded preview:", e);
    }

    if (image && image.data.length) {
      let cameraMatchEv = 0;
      if (baselineEv === null) {
        opts.onStatus?.("Matching camera brightness…");
        cameraMatchEv = await previewMatchEv(worker, image).catch((e) => {
          console.warn("[raw] couldn't match the camera preview's brightness:", e);
          return 0;
        });
      }
      opts.onStatus?.("Uploading…");
      const bitmap = await toBitmap(image, 2 ** cameraMatchEv);
      return {
        bitmap,
        width: bitmap.width,
        height: bitmap.height,
        metadata,
        preview: false,
        cameraMatchEv,
      };
    }

    // Fallback: embedded preview.
    const blob = await embeddedPreview(worker);
    if (blob) {
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      return {
        bitmap,
        width: bitmap.width,
        height: bitmap.height,
        metadata,
        preview: true,
        cameraMatchEv: 0,
      };
    }

    throw new RawDecodeError(
      `Couldn't decode "${file.name}". The file may use a compression this decoder doesn't support.`,
    );
  } finally {
    worker.dispose();
  }
}

/**
 * sRGB transfer curve, in the form LibRaw's `gamm` parameter actually takes:
 * all six slots, with the first being the *inverse* exponent (1/2.4) and the
 * second the toe slope. The remaining four are derived by LibRaw.
 *
 * The package's typings say `[power, toe_slope]`, but a two-element array is
 * silently ignored and LibRaw then falls back to its BT.709 default
 * (0.45 / 4.5). Browsers display that as sRGB, which renders shadows and
 * midtones too dark (18% grey at 104 instead of 118). Verified against a grey
 * ramp; keep the six-element form.
 */
const SRGB_GAMMA = [1 / 2.4, 12.92, 0, 0, 0, 0] as unknown as LibRawSettings["gamm"];

function buildSettings({ bright }: { bright: number }): LibRawSettings {
  return {
    useCameraWb: true, // start from the as-shot white balance
    outputColor: 1, // sRGB
    // 16 bits so the camera-brightness gain is applied before the reduction to
    // 8 bits (toBitmap), without gaps between levels in brightened shadows.
    outputBps: 16,
    gamm: SRGB_GAMMA,
    userQual: 3, // AHD demosaic
    highlight: 0,
    // Deterministic brightness: no histogram-based auto-bright, just the
    // file's own baseline exposure. The Exposure slider handles the rest.
    noAutoBright: true,
    bright,
    // Never half size: it skips demosaicing and quarters the pixels. Full
    // resolution is what RAW is for; any fit to the GPU happens afterwards.
    halfSize: false,
    userFlip: -1, // honour the orientation tag
  };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/** The camera's embedded JPEG preview, or null if the file has none. */
async function embeddedPreview(worker: LibRawWorker): Promise<Blob | null> {
  const thumb = await worker
    .call<LibRawThumbnailData | undefined>("thumbnailData")
    .catch(() => undefined);
  if (!thumb || thumb.format !== "jpeg" || !thumb.data.length) return null;
  return new Blob([thumb.data as BlobPart], { type: "image/jpeg" });
}

/**
 * EV that brings the decode's midtones up to the camera's embedded preview
 * (see lib/raw/exposure.ts). 0 when the file has no usable preview.
 */
async function previewMatchEv(worker: LibRawWorker, image: LibRawImageData): Promise<number> {
  const blob = await embeddedPreview(worker);
  if (!blob) return 0;
  // A small copy is plenty for a median, and cheap even when the preview is full size.
  const bitmap = await createImageBitmap(blob, { resizeWidth: 1024, resizeQuality: "medium" });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const preview = luminanceStats(ctx.getImageData(0, 0, canvas.width, canvas.height).data, 4, 255);
  const decode = luminanceStats(image.data, image.colors, image.bits === 16 ? 65535 : 255);
  return preview && decode ? matchExposureEv(decode, preview) : 0;
}

/** LibRaw's output (8 or 16 bits) to an 8-bit RGBA bitmap, multiplying linear light by `gain`. */
async function toBitmap(image: LibRawImageData, gain: number): Promise<ImageBitmap> {
  const { width, height, colors, bits, data } = image;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const lut = exposureLut(bits === 16 ? 16 : 8, gain);
  if (colors === 3) {
    for (let i = 0, j = 0; j < rgba.length; i += 3, j += 4) {
      rgba[j] = lut[data[i]];
      rgba[j + 1] = lut[data[i + 1]];
      rgba[j + 2] = lut[data[i + 2]];
      rgba[j + 3] = 255;
    }
  } else if (colors === 4) {
    for (let i = 0, j = 0; j < rgba.length; i += 4, j += 4) {
      rgba[j] = lut[data[i]];
      rgba[j + 1] = lut[data[i + 1]];
      rgba[j + 2] = lut[data[i + 2]];
      rgba[j + 3] = 255;
    }
  } else if (colors === 1) {
    for (let i = 0, j = 0; j < rgba.length; i++, j += 4) {
      const v = lut[data[i]];
      rgba[j] = rgba[j + 1] = rgba[j + 2] = v;
      rgba[j + 3] = 255;
    }
  } else {
    throw new RawDecodeError(`Unsupported channel count: ${colors}`);
  }
  return createImageBitmap(new ImageData(rgba, width, height));
}

function normaliseMetadata(m: LibRawMetadata): RawMetadata {
  return {
    make: (m.camera_make ?? "").trim(),
    model: (m.camera_model ?? "").trim(),
    iso: m.iso_speed ?? 0,
    shutter: m.shutter ?? 0,
    aperture: m.aperture ?? 0,
    focalLength: m.focal_len ?? 0,
    timestamp:
      m.timestamp instanceof Date && !isNaN(m.timestamp.getTime()) ? m.timestamp : undefined,
  };
}

export function formatRawMetadata(m: RawMetadata): string {
  const parts: string[] = [];
  const camera = [m.make, m.model].filter(Boolean).join(" ");
  if (camera) parts.push(camera);
  if (m.iso) parts.push(`ISO ${Math.round(m.iso)}`);
  if (m.shutter)
    parts.push(m.shutter >= 1 ? `${m.shutter.toFixed(1)}s` : `1/${Math.round(1 / m.shutter)}`);
  if (m.aperture) parts.push(`f/${m.aperture.toFixed(1).replace(/\.0$/, "")}`);
  if (m.focalLength) parts.push(`${Math.round(m.focalLength)}mm`);
  return parts.join(" · ");
}
