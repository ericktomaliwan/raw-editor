/**
 * Shared plumbing for the workers that take raw pixels: the encoders
 * (lib/jpeg, lib/png, lib/webp) and the export resizer (lib/resize). Each
 * worker is a static file under public/ (see scripts/copy-wasm.mjs), so these
 * helpers only deal with starting it, the message protocol and failure.
 *
 * Protocol: { pixels: ArrayBuffer (RGBA, transferred), width, height, flipY, ...params }
 *        -> { out: ArrayBuffer } | { error: string }
 * (The JPEG worker adds an `id`, because it is kept for the session and may
 * have several jobs in flight; see lib/jpeg/encoder.ts.)
 */

export interface RawPixels {
  /** Tightly packed 8-bit RGBA. Ownership moves to the worker (the buffer is transferred). */
  data: Uint8Array;
  width: number;
  height: number;
  /** True when rows run bottom-to-top, as WebGL's readPixels returns them. */
  flipY: boolean;
}

/** Any failure to get a result out of a worker. Callers fall back to the browser's own path. */
export class WorkerJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerJobError";
  }
}

export const UNSUPPORTED_MESSAGE = "WebAssembly workers aren't supported here.";

/** Whether this browser can run our module workers at all. */
export function workersSupported(): boolean {
  return typeof Worker !== "undefined" && typeof WebAssembly !== "undefined";
}

/** Start one of our workers. They are served as-is, never bundled. */
export function startWorker(url: string): Worker {
  return new Worker(/* turbopackIgnore: true */ url, { type: "module" });
}

/** The message for a pixel job plus its transfer list (the pixel buffer moves, it isn't copied). */
export function pixelMessage(
  pixels: RawPixels,
  params: Record<string, unknown> = {},
): [message: Record<string, unknown>, transfer: Transferable[]] {
  const buffer = pixels.data.buffer as ArrayBuffer;
  return [
    { ...params, pixels: buffer, width: pixels.width, height: pixels.height, flipY: pixels.flipY },
    [buffer],
  ];
}

export interface PixelJob<T> {
  /** The worker script, e.g. "/oxipng/worker.js". */
  url: string;
  /** Names the worker in messages: "PNG encoder" gives "The PNG encoder timed out." */
  label: string;
  /** Message for when the worker reports a failure without saying why. */
  failure: string;
  pixels: RawPixels;
  /** Extra fields for the worker's message (quality, output size, ...). */
  params?: Record<string, unknown>;
  /**
   * Safety net so a job can never hang forever if the worker goes silent: a
   * base plus an allowance per megapixel of `pixels`, because the work grows
   * with the image.
   */
  timeout: { baseMs: number; perMegapixelMs: number };
  /** Turns the worker's output bytes into the result. */
  result: (out: ArrayBuffer) => T;
}

/**
 * Run one job in a fresh worker, terminated as soon as it settles. Ending the
 * worker is the only way to give its WebAssembly memory back, and these codecs
 * use 16-40 bytes per pixel (around a gigabyte for a 48-megapixel photo).
 *
 * Rejects with WorkerJobError if the worker can't run here, fails, crashes or
 * times out.
 */
export function runPixelJob<T>(job: PixelJob<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!workersSupported()) {
      reject(new WorkerJobError(UNSUPPORTED_MESSAGE));
      return;
    }
    let worker: Worker | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      clearTimeout(timer);
      worker?.terminate();
    };
    const fail = (reason: string) => {
      finish();
      reject(new WorkerJobError(reason));
    };
    try {
      const w = startWorker(job.url);
      worker = w;
      w.onmessage = ({ data }: MessageEvent<{ out?: ArrayBuffer; error?: string }>) => {
        if (data?.out) {
          finish();
          resolve(job.result(data.out));
        } else {
          fail(data?.error || job.failure);
        }
      };
      // Fires when the worker script or the codec can't be loaded, or the worker crashes.
      w.onerror = (e) => {
        e.preventDefault();
        fail(e.message || `The ${job.label} couldn't be started.`);
      };
      w.onmessageerror = () => fail(`The ${job.label} sent an unreadable reply.`);

      const megapixels = (job.pixels.width * job.pixels.height) / 1e6;
      timer = setTimeout(
        () => fail(`The ${job.label} timed out.`),
        job.timeout.baseMs + megapixels * job.timeout.perMegapixelMs,
      );
      w.postMessage(...pixelMessage(job.pixels, job.params));
    } catch (e) {
      fail(e instanceof Error ? e.message : `The ${job.label} couldn't be started.`);
    }
  });
}
