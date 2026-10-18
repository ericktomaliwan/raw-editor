// libwebp encoder worker.
//
// Protocol: { pixels: ArrayBuffer (RGBA), width, height, quality, flipY }
//        -> { out: ArrayBuffer (WebP bytes) } | { error: string }
//
// One job per worker: the client starts a fresh worker for each export and
// terminates it afterwards (see lib/webp/encoder.ts).

// libwebp's own defaults (its struct WebPConfig), unmodified apart from
// `quality`. Effort `method` 4 measured on phone photos: 3 is no faster, 2
// halves the time but costs about 0.5 dB PSNR at the same quality and makes a
// slightly larger file, 6 takes twice as long. `use_sharp_yuv` made no visible
// difference on photos and lowered PSNR slightly.
const BASE_OPTIONS = {
  quality: 75,
  target_size: 0,
  target_PSNR: 0,
  method: 4,
  sns_strength: 50,
  filter_strength: 60,
  filter_sharpness: 0,
  filter_type: 1,
  partitions: 0,
  segments: 4,
  pass: 1,
  show_compressed: 0,
  preprocessing: 0,
  autofilter: 0,
  partition_limit: 0,
  alpha_compression: 1,
  alpha_filtering: 1,
  alpha_quality: 100,
  lossless: 0,
  exact: 0,
  image_hint: 0,
  emulate_jpeg_size: 0,
  thread_level: 0,
  low_memory: 0,
  near_lossless: 100,
  use_delta_palette: 0,
  use_sharp_yuv: 0,
};

/** The format stores each side in 14 bits. */
const MAX_DIMENSION = 16383;

/**
 * The codec ships in two builds; the SIMD one is faster where the browser
 * supports WebAssembly SIMD. The bytes are a minimal module that uses a SIMD
 * instruction (the same test wasm-feature-detect runs).
 */
const SIMD_TEST = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15,
  253, 98, 11,
]);

async function loadCodec() {
  const { default: create } = WebAssembly.validate(SIMD_TEST)
    ? await import("./webp_enc_simd.js")
    : await import("./webp_enc.js");
  return create({ noInitialRun: true });
}

/** WebGL reads rows bottom-up; WebP wants them top-down. Swap in place. */
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
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      throw new Error(`WebP images can be at most ${MAX_DIMENSION} pixels on a side.`);
    }
    if (rgba.length !== width * height * 4)
      throw new Error("Pixel data doesn't match the image size.");
    const quality = Math.min(
      100,
      Math.max(1, Math.round(Number(msg.quality) || BASE_OPTIONS.quality)),
    );

    const codec = await loadCodec();
    if (msg.flipY) flipRows(rgba, width, height);

    // WebP keeps alpha, so unlike the JPEG worker there is nothing to flatten.
    const result = codec.encode(rgba, width, height, { ...BASE_OPTIONS, quality });
    if (!result) throw new Error("WebP encoding failed.");
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
