// MozJPEG encoder worker.
//
//
// Protocol: { id, pixels: ArrayBuffer (RGBA), width, height, quality, flipY }
//        -> { id, out: ArrayBuffer (JPEG bytes) } | { id, error: string }
import createMozjpeg from "./mozjpeg_enc.js";

// MozJPEG's own recommended settings, unmodified: progressive scan, optimised
// Huffman tables, and `auto_subsample`, which lets the codec pick the chroma
// subsampling from the quality level (4:2:0 below 80, 4:2:2 from 80, full
// colour resolution from 90). Only `quality` varies per export.
//
// Note the consequence: at 90 and above the file keeps more colour detail than
// a browser's built-in encoder at the same number (those stay 4:2:0 until 100),
// so it can come out larger. Below 80 it is smaller at matching quality.
const BASE_OPTIONS = {
  quality: 75,
  baseline: false,
  arithmetic: false,
  progressive: true,
  optimize_coding: true,
  smoothing: 0,
  color_space: 3, // YCbCr
  quant_table: 3,
  trellis_multipass: false,
  trellis_opt_zero: false,
  trellis_opt_table: false,
  trellis_loops: 1,
  auto_subsample: true,
  chroma_subsample: 2, // ignored while auto_subsample is on
  separate_chroma_quality: false,
  chroma_quality: 75,
};

let modulePromise;
function loadCodec() {
  modulePromise ??= createMozjpeg({ noInitialRun: true });
  return modulePromise;
}

/** WebGL reads rows bottom-up; JPEG wants them top-down. Swap in place. */
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

/**
 * JPEG has no alpha channel and the codec simply drops it. Blend any
 * transparent pixels onto black first, which is what the browser's own JPEG
 * encoder does, so both encoders give the same picture.
 */
function flattenOnBlack(rgba) {
  for (let i = 3; i < rgba.length; i += 4) {
    const a = rgba[i];
    if (a === 255) continue;
    rgba[i - 3] = (rgba[i - 3] * a + 127) / 255;
    rgba[i - 2] = (rgba[i - 2] * a + 127) / 255;
    rgba[i - 1] = (rgba[i - 1] * a + 127) / 255;
    rgba[i] = 255;
  }
}

self.onmessage = async ({ data: msg }) => {
  const { id } = msg;
  try {
    const { width, height } = msg;
    const rgba = new Uint8Array(msg.pixels);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new Error("Invalid image size.");
    }
    if (rgba.length !== width * height * 4) throw new Error("Pixel data doesn't match the image size.");
    const quality = Math.min(100, Math.max(1, Math.round(Number(msg.quality) || BASE_OPTIONS.quality)));

    const codec = await loadCodec();
    if (msg.flipY) flipRows(rgba, width, height);
    flattenOnBlack(rgba);

    const result = codec.encode(rgba, width, height, { ...BASE_OPTIONS, quality });
    // Hand back a standalone buffer (never a view into the WebAssembly heap).
    const out =
      result.byteOffset === 0 && result.byteLength === result.buffer.byteLength
        ? result.buffer
        : result.slice().buffer;
    self.postMessage({ id, out }, [out]);
  } catch (e) {
    self.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
