// Lanczos resize worker (the Rust `resize` crate, compiled to WebAssembly).
//
// Protocol: { pixels: ArrayBuffer (RGBA), width, height, outWidth, outHeight, flipY }
//        -> { out: ArrayBuffer (RGBA, top row first) } | { error: string }
//
// One job per worker: the client starts a fresh worker for each export and
// terminates it afterwards (see lib/resize/resizer.ts).
import init, { resize } from "./squoosh_resize.js";

// Filter index in the codec: 0 triangle, 1 Catmull-Rom, 2 Mitchell, 3 Lanczos3.
const LANCZOS3 = 3;

/** WebGL reads rows bottom-up; the result must be top-down. Swap in place. */
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

const isSize = (n) => Number.isInteger(n) && n >= 1;

self.onmessage = async ({ data: msg }) => {
  try {
    const { width, height, outWidth, outHeight } = msg;
    const rgba = new Uint8Array(msg.pixels);
    if (![width, height, outWidth, outHeight].every(isSize)) throw new Error("Invalid image size.");
    if (rgba.length !== width * height * 4) throw new Error("Pixel data doesn't match the image size.");

    await init();
    // Premultiplied so transparent pixels don't bleed their colour into
    // neighbours; linear light so fine bright/dark detail averages to the right
    // brightness instead of darkening.
    const result = resize(rgba, width, height, outWidth, outHeight, LANCZOS3, true, true);
    // Flip after resizing: fewer rows to move.
    if (msg.flipY) flipRows(result, outWidth, outHeight);
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
