/**
 * Starting brightness for a RAW decode. Pure functions, so they can be tested
 * apart from LibRaw (see lib/raw/decoder.ts for where they are used).
 *
 * A neutral decode (no auto-brightness, no tone curve) maps the sensor's
 * linear values straight to sRGB, and comes out darker than the photo the
 * camera showed: cameras expose to protect highlights and brighten the
 * midtones when they render. DNGs say how much in BaselineExposure; other
 * RAWs don't, so for those the decode is matched to the camera's own
 * rendering, the JPEG preview embedded in every RAW file.
 */

/**
 * The file's DNG BaselineExposure in EV, or null when it has none. LibRaw
 * reports -999 for "not set" (every non-DNG file), which is not a real value:
 * taken at face value it darkened every Sony/Canon/Nikon/Fuji RAW by 2 EV.
 */
export function dngBaselineEv(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 10
    ? value
    : null;
}

const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

export interface LuminanceStats {
  /** Median luminance, in linear light (0..1). */
  median: number;
  /** 99.9th percentile luminance, in linear light: how close the brightest areas are to white. */
  p999: number;
}

const BINS = 4096;

/**
 * Luminance statistics of sRGB-encoded pixels: `channels` values per pixel
 * (1 = grey, 3 = RGB, 4 = RGBA), each 0..`maxValue`. Samples about `samples`
 * pixels spread over the image, which is plenty for a median and fast on a
 * 50-megapixel decode. Null for empty data.
 */
export function luminanceStats(
  data: ArrayLike<number>,
  channels: number,
  maxValue: number,
  samples = 1_000_000,
): LuminanceStats | null {
  const pixels = Math.floor(data.length / channels);
  if (pixels === 0) return null;
  const linear = new Float32Array(maxValue + 1);
  for (let v = 0; v <= maxValue; v++) linear[v] = srgbToLinear(v / maxValue);

  const step = Math.max(1, Math.floor(pixels / samples));
  const histogram = new Uint32Array(BINS);
  let counted = 0;
  for (let p = 0; p < pixels; p += step) {
    const i = p * channels;
    const y =
      channels >= 3
        ? 0.2126 * linear[data[i]] + 0.7152 * linear[data[i + 1]] + 0.0722 * linear[data[i + 2]]
        : linear[data[i]];
    histogram[Math.min(BINS - 1, Math.floor(y * BINS))]++;
    counted++;
  }
  const quantile = (q: number) => {
    let seen = 0;
    for (let b = 0; b < BINS; b++) {
      seen += histogram[b];
      if (seen >= q * counted) return (b + 0.5) / BINS;
    }
    return 1;
  };
  return { median: quantile(0.5), p999: quantile(0.999) };
}

/** Most a decode is ever brightened to match the camera. */
export const MAX_MATCH_EV = 2;

/**
 * EV to add to a neutral decode so its midtones match the camera's preview.
 *
 * Never negative: darkening would turn highlights LibRaw already clipped to
 * grey. At most MAX_MATCH_EV. And no more than the decode's headroom, so at
 * most 0.1% of pixels newly clip; the camera keeps more highlight detail than
 * a plain gain can, because it rolls highlights off with a tone curve.
 */
export function matchExposureEv(decode: LuminanceStats, preview: LuminanceStats): number {
  if (!(decode.median > 0) || !(preview.median > 0)) return 0;
  const wanted = Math.log2(preview.median / decode.median);
  const headroom = decode.p999 > 0 ? Math.log2(1 / decode.p999) : MAX_MATCH_EV;
  return Math.max(0, Math.min(wanted, MAX_MATCH_EV, headroom));
}

/**
 * Lookup table from sRGB-encoded values (0..2^bits - 1) to 8-bit sRGB, with
 * linear light multiplied by `gain` and clipped at white. At gain 1 it is
 * plain rounding to 8 bits. Applying the gain to 16-bit input, before the
 * reduction to 8 bits, keeps brightened shadows free of gaps between levels.
 */
export function exposureLut(bits: 8 | 16, gain: number): Uint8Array {
  const max = 2 ** bits - 1;
  const lut = new Uint8Array(max + 1);
  for (let v = 0; v <= max; v++) {
    lut[v] =
      gain === 1
        ? Math.round((v / max) * 255)
        : Math.round(Math.min(1, linearToSrgb(srgbToLinear(v / max) * gain)) * 255);
  }
  return lut;
}
