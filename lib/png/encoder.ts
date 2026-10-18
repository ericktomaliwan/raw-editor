/**
 * Client for the OxiPNG encoder worker, served as static files from
 * /public/oxipng (see scripts/copy-wasm.mjs and lib/png/oxipng.worker.js).
 *
 * OxiPNG searches harder than a browser's built-in PNG encoder, so the file
 * comes out smaller (35-45% against Chrome on the photos tried). The picture
 * is the same either way: PNG is lossless. The price is time, seconds rather
 * than a fraction of one, which is why it runs off the main thread.
 */
import { type RawPixels, runPixelJob } from "@/lib/workers/pixelWorker";

/**
 * Encode raw pixels as a PNG with OxiPNG.
 *
 * Each call gets its own worker, terminated as soon as it settles (unlike the
 * JPEG encoder, which keeps one for the session): the codec works in about
 * 20 bytes of memory per pixel, 1 GB for a 48-megapixel photo.
 *
 * Rejects with WorkerJobError if the encoder can't run here; callers should
 * fall back to the browser's own encoder.
 */
export function encodePng(pixels: RawPixels): Promise<Blob> {
  return runPixelJob({
    url: "/oxipng/worker.js",
    label: "PNG encoder",
    failure: "PNG encoding failed.",
    pixels,
    // About half a second per megapixel on a fast laptop, several times that on a slow device.
    timeout: { baseMs: 30_000, perMegapixelMs: 5_000 },
    result: (out) => new Blob([out], { type: "image/png" }),
  });
}
