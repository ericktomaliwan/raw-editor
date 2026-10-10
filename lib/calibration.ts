import type { Adjustments } from "./adjustments";

/**
 * Camera-calibration matrix.
 *
 * Each primary (R, G, B) is treated as a vector in linear RGB. Its chroma
 * component (the part orthogonal to the grey axis) is rotated around that axis
 * by the hue slider and scaled by the saturation slider; the achromatic part is
 * left alone so white stays white. The three adjusted primaries become the
 * columns of a 3x3 matrix applied to linear RGB before tone processing.
 *
 * Returns the matrix in column-major order, ready for `uniformMatrix3fv`.
 */
export function calibrationMatrix(a: Adjustments): Float32Array {
  const HUE_DEG_AT_100 = 36; // full slider travel ≈ a third of the way to the next primary
  const SAT_AT_100 = 1.0; // +100 doubles chroma, -100 removes it

  const out = new Float32Array(9);
  const primaries: Array<[number, number, [number, number, number]]> = [
    [a.calRedHue, a.calRedSaturation, [1, 0, 0]],
    [a.calGreenHue, a.calGreenSaturation, [0, 1, 0]],
    [a.calBlueHue, a.calBlueSaturation, [0, 0, 1]],
  ];

  primaries.forEach(([hue, sat, p], col) => {
    const theta = (hue / 100) * HUE_DEG_AT_100 * (Math.PI / 180);
    const scale = Math.max(0, 1 + (sat / 100) * SAT_AT_100);

    // Split into grey (along (1,1,1)) and chroma.
    const mean = (p[0] + p[1] + p[2]) / 3;
    const c: [number, number, number] = [p[0] - mean, p[1] - mean, p[2] - mean];

    // Rotate chroma about the unit grey axis (Rodrigues; a·c = 0 so the last
    // term vanishes). Positive angle goes R -> G -> B, i.e. red toward yellow,
    // green toward cyan, blue toward magenta — matching the slider directions.
    const k = 1 / Math.sqrt(3);
    const cross: [number, number, number] = [
      k * (c[2] - c[1]),
      k * (c[0] - c[2]),
      k * (c[1] - c[0]),
    ];
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const r: [number, number, number] = [
      (c[0] * cos + cross[0] * sin) * scale,
      (c[1] * cos + cross[1] * sin) * scale,
      (c[2] * cos + cross[2] * sin) * scale,
    ];

    out[col * 3 + 0] = mean + r[0];
    out[col * 3 + 1] = mean + r[1];
    out[col * 3 + 2] = mean + r[2];
  });

  return out;
}

export function hasCalibration(a: Adjustments): boolean {
  return (
    a.calRedHue !== 0 ||
    a.calRedSaturation !== 0 ||
    a.calGreenHue !== 0 ||
    a.calGreenSaturation !== 0 ||
    a.calBlueHue !== 0 ||
    a.calBlueSaturation !== 0
  );
}
