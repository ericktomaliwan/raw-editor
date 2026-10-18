/**
 * Client for the libwebp encoder worker, served as static files from
 * /public/webp (see scripts/copy-wasm.mjs and lib/webp/webp.worker.js).
 *
 * Browsers' own WebP support is uneven: some can't write WebP from a canvas
 * at all and hand back a PNG instead. Bringing the encoder along makes WebP
 * export work the same everywhere, with the same quality setting as JPEG.
 */
import { type RawPixels, runPixelJob } from "@/lib/workers/pixelWorker";

/** The format stores each side in 14 bits, so larger images can't be WebP at all. */
export const WEBP_MAX_DIMENSION = 16383;

/**
 * Encode raw pixels as a lossy WebP with libwebp.
 * @param quality 1–100; lower means a smaller file.
 *
 * Each call gets its own worker, terminated as soon as it settles, like the
 * PNG encoder: the codec needs about 16 bytes of memory per pixel (nearly
 * 800 MB for a 48-megapixel photo).
 *
 * Rejects with WorkerJobError if the encoder can't run here; callers should
 * fall back to the browser's own encoder.
 */
export function encodeWebp(pixels: RawPixels, quality: number): Promise<Blob> {
  return runPixelJob({
    url: "/webp/worker.js",
    label: "WebP encoder",
    failure: "WebP encoding failed.",
    pixels,
    params: { quality },
    // About an eighth of a second per megapixel on a fast laptop, several times that on a slow device.
    timeout: { baseMs: 30_000, perMegapixelMs: 2_000 },
    result: (out) => new Blob([out], { type: "image/webp" }),
  });
}
