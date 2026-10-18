import type {
  LibRawImageData,
  LibRawMetadata,
  LibRawSettings,
  LibRawThumbnailData,
} from "libraw-wasm";

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
  /**
   * Full size of the picture, oriented like the bitmap. Larger than the bitmap
   * when the sensor data was decoded at half size to fit the GPU.
   */
  sourceWidth: number;
  sourceHeight: number;
  metadata: RawMetadata;
  /** True when we fell back to the embedded JPEG preview. */
  preview: boolean;
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
  /**
   * Longest side allowed; larger images are decoded at half size. That can
   * still exceed it (a sensor more than twice the limit), so the caller fits
   * the result afterwards (lib/image.ts).
   */
  maxSize: number;
  onStatus?: (status: string) => void;
}

/**
 * Decode a camera RAW / DNG file into an sRGB ImageBitmap using LibRaw.
 * Falls back to the embedded JPEG preview if the sensor data can't be decoded
 * (e.g. lossy-compressed DNGs this build lacks a codec for).
 */
export async function decodeRawFile(file: File, opts: DecodeOptions): Promise<DecodedRaw> {
  const avail = rawDecodingAvailable();
  if (!avail.ok) throw new RawDecodeError(avail.reason ?? "RAW decoding unavailable.");

  opts.onStatus?.("Reading file…");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const worker = new LibRawWorker();

  try {
    opts.onStatus?.("Parsing RAW…");
    // First pass: open so we can read sizes + DNG levels before processing.
    await worker.call<void>("open", bytes.slice(), buildSettings({ halfSize: false, bright: 1 }));
    const meta = (await worker.call<LibRawMetadata | undefined>("metadata", true)) ?? null;
    if (!meta) throw new RawDecodeError("Couldn't read RAW metadata.");

    const longest = Math.max(meta.width, meta.height);
    const halfSize = longest > opts.maxSize;

    // DNG BaselineExposure is the EV offset a viewer must apply to get the
    // intended default rendering (iPhone ProRAW files use +2..+4 EV).
    const baselineEv = meta.color_data?.dng_levels?.baseline_exposure ?? 0;
    const bright = Number.isFinite(baselineEv) ? clamp(2 ** baselineEv, 0.25, 32) : 1;

    // Second pass with the final processing parameters.
    await worker.call<void>("open", bytes.slice(), buildSettings({ halfSize, bright }));

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
      opts.onStatus?.("Uploading…");
      const bitmap = await toBitmap(image);
      // LibRaw reports the sensor size before rotation; turn it to match the bitmap.
      const source = !halfSize
        ? { width: bitmap.width, height: bitmap.height }
        : meta.width >= meta.height === bitmap.width >= bitmap.height
          ? { width: meta.width, height: meta.height }
          : { width: meta.height, height: meta.width };
      return {
        bitmap,
        width: bitmap.width,
        height: bitmap.height,
        sourceWidth: source.width,
        sourceHeight: source.height,
        metadata,
        preview: false,
      };
    }

    // Fallback: embedded preview.
    const thumb = await worker
      .call<LibRawThumbnailData | undefined>("thumbnailData")
      .catch(() => undefined);
    if (thumb && thumb.format === "jpeg" && thumb.data.length) {
      const blob = new Blob([thumb.data as BlobPart], { type: "image/jpeg" });
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      return {
        bitmap,
        width: bitmap.width,
        height: bitmap.height,
        sourceWidth: bitmap.width,
        sourceHeight: bitmap.height,
        metadata,
        preview: true,
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

function buildSettings({
  halfSize,
  bright,
}: {
  halfSize: boolean;
  bright: number;
}): LibRawSettings {
  return {
    useCameraWb: true, // start from the as-shot white balance
    outputColor: 1, // sRGB
    outputBps: 8,
    gamm: SRGB_GAMMA,
    userQual: 3, // AHD demosaic
    highlight: 0,
    // Deterministic brightness: no histogram-based auto-bright, just the
    // file's own baseline exposure. The Exposure slider handles the rest.
    noAutoBright: true,
    bright,
    halfSize,
    userFlip: -1, // honour the orientation tag
  };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

async function toBitmap(image: LibRawImageData): Promise<ImageBitmap> {
  const { width, height, colors, bits, data } = image;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const shift = bits === 16 ? 8 : 0;
  if (colors === 3) {
    for (let i = 0, j = 0; j < rgba.length; i += 3, j += 4) {
      rgba[j] = data[i] >> shift;
      rgba[j + 1] = data[i + 1] >> shift;
      rgba[j + 2] = data[i + 2] >> shift;
      rgba[j + 3] = 255;
    }
  } else if (colors === 4) {
    for (let i = 0, j = 0; j < rgba.length; i += 4, j += 4) {
      rgba[j] = data[i] >> shift;
      rgba[j + 1] = data[i + 1] >> shift;
      rgba[j + 2] = data[i + 2] >> shift;
      rgba[j + 3] = 255;
    }
  } else if (colors === 1) {
    for (let i = 0, j = 0; j < rgba.length; i++, j += 4) {
      const v = data[i] >> shift;
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
