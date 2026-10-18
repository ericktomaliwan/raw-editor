/**
 * Client for the libwebp encoder worker, served as static files from
 * /public/webp (see scripts/copy-wasm.mjs and lib/webp/webp.worker.js).
 *
 * Browsers' own WebP support is uneven: some can't write WebP from a canvas
 * at all and hand back a PNG instead. Bringing the encoder along makes WebP
 * export work the same everywhere, with the same quality setting as JPEG.
 */
import type { RawPixels } from "@/lib/jpeg/encoder";

const WORKER_URL = "/webp/worker.js";

/** The format stores each side in 14 bits, so larger images can't be WebP at all. */
export const WEBP_MAX_DIMENSION = 16383;

export class WebpEncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebpEncodeError";
  }
}

type Reply = { out?: ArrayBuffer; error?: string };

/**
 * Safety net so an export can never hang forever if the worker goes silent.
 * It grows with the image because the encode does: about an eighth of a second
 * per megapixel on a fast laptop, several times that on a slow device.
 */
const TIMEOUT_BASE_MS = 30_000;
const TIMEOUT_PER_MEGAPIXEL_MS = 2_000;

/**
 * Encode raw pixels as a lossy WebP with libwebp.
 * @param quality 1–100; lower means a smaller file.
 *
 * Each call gets its own worker, terminated as soon as it settles, like the
 * PNG encoder: the codec needs about 16 bytes of memory per pixel (nearly
 * 800 MB for a 48-megapixel photo), and ending the worker is the only way to
 * give WebAssembly memory back.
 *
 * Rejects with WebpEncodeError if the encoder can't run here; callers should
 * fall back to the browser's own encoder.
 */
export function encodeWebp(pixels: RawPixels, quality: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") {
      reject(new WebpEncodeError("WebAssembly workers aren't supported here."));
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
      reject(new WebpEncodeError(reason));
    };
    try {
      const w = new Worker(/* turbopackIgnore: true */ WORKER_URL, { type: "module" });
      worker = w;
      w.onmessage = ({ data }: MessageEvent<Reply>) => {
        if (data?.out) {
          finish();
          resolve(new Blob([data.out], { type: "image/webp" }));
        } else {
          fail(data?.error || "WebP encoding failed.");
        }
      };
      // Fires when the worker script or the codec can't be loaded, or the worker crashes.
      w.onerror = (e) => {
        e.preventDefault();
        fail(e.message || "The WebP encoder couldn't be started.");
      };
      w.onmessageerror = () => fail("The WebP encoder sent an unreadable reply.");

      const megapixels = (pixels.width * pixels.height) / 1e6;
      timer = setTimeout(
        () => fail("The WebP encoder timed out."),
        TIMEOUT_BASE_MS + megapixels * TIMEOUT_PER_MEGAPIXEL_MS,
      );
      const buffer = pixels.data.buffer;
      w.postMessage(
        { pixels: buffer, width: pixels.width, height: pixels.height, quality, flipY: pixels.flipY },
        [buffer as ArrayBuffer],
      );
    } catch (e) {
      fail(e instanceof Error ? e.message : "The WebP encoder couldn't be started.");
    }
  });
}
