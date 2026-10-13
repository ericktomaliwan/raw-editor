/**
 * Client for the OxiPNG encoder worker, served as static files from
 * /public/oxipng (see scripts/copy-wasm.mjs and lib/png/oxipng.worker.js).
 *
 * OxiPNG searches harder than a browser's built-in PNG encoder, so the file
 * comes out smaller (35-45% against Chrome on the photos tried). The picture
 * is the same either way: PNG is lossless. The price is time, seconds rather
 * than a fraction of one, which is why it runs off the main thread.
 */
import type { RawPixels } from "@/lib/jpeg/encoder";

const WORKER_URL = "/oxipng/worker.js";

export class PngEncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PngEncodeError";
  }
}

type Reply = { out?: ArrayBuffer; error?: string };

/**
 * Safety net so an export can never hang forever if the worker goes silent.
 * It grows with the image because the encode does: about half a second per
 * megapixel on a fast laptop, several times that on a slow device.
 */
const TIMEOUT_BASE_MS = 30_000;
const TIMEOUT_PER_MEGAPIXEL_MS = 5_000;

/**
 * Encode raw pixels as a PNG with OxiPNG.
 *
 * Each call gets its own worker, terminated as soon as it settles (unlike the
 * JPEG encoder, which keeps one for the session). The codec works in about
 * 20 bytes of memory per pixel, 1 GB for a 48-megapixel photo, and ending the
 * worker is the only way to give WebAssembly memory back.
 *
 * Rejects with PngEncodeError if the encoder can't run here; callers should
 * fall back to the browser's own encoder.
 */
export function encodePng(pixels: RawPixels): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") {
      reject(new PngEncodeError("WebAssembly workers aren't supported here."));
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
      reject(new PngEncodeError(reason));
    };
    try {
      const w = new Worker(/* turbopackIgnore: true */ WORKER_URL, { type: "module" });
      worker = w;
      w.onmessage = ({ data }: MessageEvent<Reply>) => {
        if (data?.out) {
          finish();
          resolve(new Blob([data.out], { type: "image/png" }));
        } else {
          fail(data?.error || "PNG encoding failed.");
        }
      };
      // Fires when the worker script or the codec can't be loaded, or the worker crashes.
      w.onerror = (e) => {
        e.preventDefault();
        fail(e.message || "The PNG encoder couldn't be started.");
      };
      w.onmessageerror = () => fail("The PNG encoder sent an unreadable reply.");

      const megapixels = (pixels.width * pixels.height) / 1e6;
      timer = setTimeout(
        () => fail("The PNG encoder timed out."),
        TIMEOUT_BASE_MS + megapixels * TIMEOUT_PER_MEGAPIXEL_MS,
      );
      const buffer = pixels.data.buffer;
      w.postMessage(
        { pixels: buffer, width: pixels.width, height: pixels.height, flipY: pixels.flipY },
        [buffer as ArrayBuffer],
      );
    } catch (e) {
      fail(e instanceof Error ? e.message : "The PNG encoder couldn't be started.");
    }
  });
}
