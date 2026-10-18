/**
 * Client for the MozJPEG encoder worker, served as static files from
 * /public/mozjpeg (see scripts/copy-wasm.mjs and lib/jpeg/mozjpeg.worker.js).
 *
 * MozJPEG produces noticeably smaller files than a browser's built-in JPEG
 * encoder at the same visual quality. Encoding runs off the main thread, so
 * the UI stays responsive on large photos.
 *
 * Unlike the other pixel workers (lib/workers/pixelWorker.ts), this one is
 * kept for the session: its codec is small, so it loads only once. Jobs carry
 * an `id` so replies can be matched to them.
 */
import {
  pixelMessage,
  type RawPixels,
  startWorker,
  UNSUPPORTED_MESSAGE,
  WorkerJobError,
  workersSupported,
} from "@/lib/workers/pixelWorker";

const WORKER_URL = "/mozjpeg/worker.js";

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
  const err = new WorkerJobError(reason);
  for (const p of pending.values()) p.reject(err);
  pending.clear();
}

/** Started on first use and kept for the session, so the codec only loads once. */
function getWorker(): Worker {
  if (worker) return worker;
  const w = startWorker(WORKER_URL);
  w.onmessage = ({ data }: MessageEvent<Reply>) => {
    const p = pending.get(data?.id);
    if (!p) return;
    pending.delete(data.id);
    if (data.out) {
      p.resolve(new Blob([data.out], { type: "image/jpeg" }));
    } else {
      p.reject(new WorkerJobError(data.error || "JPEG encoding failed."));
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
 * Rejects with WorkerJobError if the encoder can't run here; callers should
 * fall back to the browser's own encoder.
 */
export function encodeJpeg(pixels: RawPixels, quality: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    if (!workersSupported()) {
      reject(new WorkerJobError(UNSUPPORTED_MESSAGE));
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
      w.postMessage(...pixelMessage(pixels, { id, quality }));
    } catch (e) {
      reject(
        new WorkerJobError(
          e instanceof Error ? e.message : "The JPEG encoder couldn't be started.",
        ),
      );
    }
  });
}
