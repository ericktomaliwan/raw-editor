// OxiPNG encoder worker.
//
// Protocol: { pixels: ArrayBuffer (RGBA), width, height, flipY }
//        -> { out: ArrayBuffer (PNG bytes) } | { error: string }
//
// One job per worker: the client starts a fresh worker for each export and
// terminates it afterwards (see lib/png/encoder.ts).
import init, { optimise_raw } from "./squoosh_oxipng.js";

// Effort preset (0-6), chosen by measurement on photos. 1 tries two row
// filters and keeps the smaller result. 2 tries four: the same file size on
// photos with any noise in them (at most 2% smaller on very clean ones) for
// 2-3x the time and a third more memory. 0 is twice as fast but 7-9% larger.
const LEVEL = 1;

// This is the codec's single-threaded build, on purpose. The package also
// ships a threaded one, but its memory is capped at 1 GB when it is compiled,
// which a photo of about 24 megapixels already exceeds, and a thread that
// runs out of memory leaves the encode hanging instead of failing. This build
// can grow to the browser's limit and reports a failure as an error.

/** WebGL reads rows bottom-up; PNG wants them top-down. Swap in place. */
function flipRows(rgba, width, height) {
  const stride = width * 4;
  const tmp = new Uint8Array(stride);
  for (let top = 0, bottom = height - 1; top < bottom; top++, bottom--) {
    const a = top * stride;
    const b = bottom * stride;
    tmp.set(rgba.subarray(a, a + stride));
    rgba.copyWithin(a, b, b + stride);
    rgba.set(tmp, b);
  }
}

self.onmessage = async ({ data: msg }) => {
  try {
    const { width, height } = msg;
    const rgba = new Uint8Array(msg.pixels);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new Error("Invalid image size.");
    }
    if (rgba.length !== width * height * 4)
      throw new Error("Pixel data doesn't match the image size.");

    await init();
    if (msg.flipY) flipRows(rgba, width, height);

    // Not interlaced, and the colour under fully transparent pixels is kept,
    // so the file decodes to exactly the pixels that were rendered.
    const result = optimise_raw(rgba, width, height, LEVEL, false, false);
    // Hand back a standalone buffer (never a view into the WebAssembly heap).
    const out =
      result.byteOffset === 0 && result.byteLength === result.buffer.byteLength
        ? result.buffer
        : result.slice().buffer;
    self.postMessage({ out }, [out]);
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : String(e) });
  }
};
