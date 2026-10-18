/**
 * Client for the Lanczos resize worker, served as static files from
 * /public/resize (see scripts/copy-wasm.mjs and lib/resize/resize.worker.js).
 *
 * Used for exports at a reduced size. The GPU's own downscaling (the mip
 * chain the preview samples) is fine on screen but soft at in-between sizes
 * and averages in gamma space, which darkens fine high-contrast detail.
 * Lanczos3 in linear light avoids both, at the cost of a second or two.
 */
import { type RawPixels, runPixelJob } from "@/lib/workers/pixelWorker";

/**
 * Resize raw pixels with a Lanczos3 filter, in linear light.
 * Returns top-down rows (`flipY: false`) whatever the input's orientation.
 *
 * Each call gets its own worker, terminated as soon as it settles: the codec
 * works in 25-40 bytes of memory per source pixel (1.2 GB for a 48-megapixel
 * photo).
 *
 * Rejects with WorkerJobError if the resizer can't run here; callers should
 * fall back to the GPU's downscaling.
 */
export function resizePixels(pixels: RawPixels, width: number, height: number): Promise<RawPixels> {
  return runPixelJob({
    url: "/resize/worker.js",
    label: "resizer",
    failure: "Resizing failed.",
    pixels,
    params: { outWidth: width, outHeight: height },
    // About 60 ms per source megapixel on a fast laptop, several times that on a slow device.
    timeout: { baseMs: 30_000, perMegapixelMs: 3_000 },
    result: (out) => ({ data: new Uint8Array(out), width, height, flipY: false }),
  });
}
