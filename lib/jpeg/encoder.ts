/**
 * Client for the MozJPEG encoder worker, served as static files from
 * /public/mozjpeg (see scripts/copy-wasm.mjs and lib/jpeg/mozjpeg.worker.js).
 *
 * MozJPEG produces noticeably smaller files than a browser's built-in JPEG
 * encoder at the same visual quality. Encoding runs off the main thread, so
 * the UI stays responsive on large photos.
 */
const WORKER_URL = "/mozjpeg/worker.js";

export class JpegEncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JpegEncodeError";
  }
}

export interface RawPixels {
  /** Tightly packed 8-bit RGBA. Ownership moves to the encoder (the buffer is transferred). */
  data: Uint8Array;
  width: number;
  height: number;
  /** True when rows run bottom-to-top, as WebGL's readPixels returns them. */
  flipY: boolean;
}

type Reply = { id: number; out?: ArrayBuffer; error?: string };
type Pending = { resolve: (blob: Blob) => void; reject: (e: Error) => void };

/**
 * Safety net so an export can never hang forever if the worker goes silent.
 * Far longer than any real encode (a 100-megapixel photo takes a few seconds).
 */
const TIMEOUT_MS = 120_000;

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

/** Drop the worker and fail whatever was waiting on it. The next call starts a fresh one. */
function reset(reason: string) {
  worker?.terminate();
  worker = null;
  const err = new JpegEncodeError(reason);
  for (const p of pending.values()) p.reject(err);
  pending.clear();
}

/** Started on first use and kept for the session, so the codec only loads once. */
function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(/* turbopackIgnore: true */ WORKER_URL, { type: "module" });
  w.onmessage = ({ data }: MessageEvent<Reply>) => {
    const p = pending.get(data?.id);
    if (!p) return;
    pending.delete(data.id);
    if (data.out) {
      p.resolve(new Blob([data.out], { type: "image/jpeg" }));
    } else {
      p.reject(new JpegEncodeError(data.error || "JPEG encoding failed."));
      // An encoder error (typically out of memory) can leave the WebAssembly
      // instance unusable, so don't reuse it.
      reset("JPEG encoder restarted.");
    }
  };
  // Fires when the worker script or the codec can't be loaded, or the worker crashes.
  w.onerror = (e) => {
    e.preventDefault();
    reset(e.message || "The JPEG encoder couldn't be started.");
  };
  w.onmessageerror = () => reset("The JPEG encoder sent an unreadable reply.");
  worker = w;
  return w;
}

/**
 * Encode raw pixels as a JPEG with MozJPEG.
 * @param quality 1–100; lower means a smaller file.
 * Rejects with JpegEncodeError if the encoder can't run here; callers should
 * fall back to the browser's own encoder.
 */
export function encodeJpeg(pixels: RawPixels, quality: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") {
      reject(new JpegEncodeError("WebAssembly workers aren't supported here."));
      return;
    }
    try {
      const w = getWorker();
      const id = nextId++;
      const timer = setTimeout(() => {
        if (pending.has(id)) reset("The JPEG encoder timed out.");
      }, TIMEOUT_MS);
      pending.set(id, {
        resolve: (blob) => {
          clearTimeout(timer);
          resolve(blob);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      const buffer = pixels.data.buffer;
      w.postMessage(
        { id, pixels: buffer, width: pixels.width, height: pixels.height, quality, flipY: pixels.flipY },
        [buffer as ArrayBuffer],
      );
    } catch (e) {
      reject(new JpegEncodeError(e instanceof Error ? e.message : "The JPEG encoder couldn't be started."));
    }
  });
}
