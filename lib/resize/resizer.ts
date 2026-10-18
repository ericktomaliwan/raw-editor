/**
 * Client for the Lanczos resize worker, served as static files from
 * /public/resize (see scripts/copy-wasm.mjs and lib/resize/resize.worker.js).
 *
 * Used for exports at a reduced size. The GPU's own downscaling (the mip
 * chain the preview samples) is fine on screen but soft at in-between sizes
 * and averages in gamma space, which darkens fine high-contrast detail.
 * Lanczos3 in linear light avoids both, at the cost of a second or two.
 */
import type { RawPixels } from "@/lib/jpeg/encoder";

const WORKER_URL = "/resize/worker.js";

export class ResizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResizeError";
  }
}

type Reply = { out?: ArrayBuffer; error?: string };

/**
 * Safety net so an export can never hang forever if the worker goes silent.
 * It grows with the source image: about 60 ms per megapixel on a fast laptop,
 * several times that on a slow device.
 */
const TIMEOUT_BASE_MS = 30_000;
const TIMEOUT_PER_MEGAPIXEL_MS = 3_000;

/**
 * Resize raw pixels with a Lanczos3 filter, in linear light.
 * Returns top-down rows (`flipY: false`) whatever the input's orientation.
 *
 * Each call gets its own worker, terminated as soon as it settles: the codec
 * works in 25-40 bytes of memory per source pixel (1.2 GB for a 48-megapixel
 * photo), and ending the worker is the only way to give WebAssembly memory
 * back.
 *
 * Rejects with ResizeError if the resizer can't run here; callers should fall
 * back to the GPU's downscaling.
 */
export function resizePixels(pixels: RawPixels, width: number, height: number): Promise<RawPixels> {
  return new Promise<RawPixels>((resolve, reject) => {
    if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") {
      reject(new ResizeError("WebAssembly workers aren't supported here."));
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
      reject(new ResizeError(reason));
    };
    try {
      const w = new Worker(/* turbopackIgnore: true */ WORKER_URL, { type: "module" });
      worker = w;
      w.onmessage = ({ data }: MessageEvent<Reply>) => {
        if (data?.out) {
          finish();
          resolve({ data: new Uint8Array(data.out), width, height, flipY: false });
        } else {
          fail(data?.error || "Resizing failed.");
        }
      };
      // Fires when the worker script or the codec can't be loaded, or the worker crashes.
      w.onerror = (e) => {
        e.preventDefault();
        fail(e.message || "The resizer couldn't be started.");
      };
      w.onmessageerror = () => fail("The resizer sent an unreadable reply.");

      const megapixels = (pixels.width * pixels.height) / 1e6;
      timer = setTimeout(
        () => fail("The resizer timed out."),
        TIMEOUT_BASE_MS + megapixels * TIMEOUT_PER_MEGAPIXEL_MS,
      );
      const buffer = pixels.data.buffer;
      w.postMessage(
        {
          pixels: buffer,
          width: pixels.width,
          height: pixels.height,
          outWidth: width,
          outHeight: height,
          flipY: pixels.flipY,
        },
        [buffer as ArrayBuffer],
      );
    } catch (e) {
      fail(e instanceof Error ? e.message : "The resizer couldn't be started.");
    }
  });
}
