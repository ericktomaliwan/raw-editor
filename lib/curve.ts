import type { Adjustments, CurvePoint } from "./adjustments";

export const LUT_SIZE = 256;

function isIdentity(points: CurvePoint[]): boolean {
  if (points.length === 0) return true;
  return points.every(([x, y]) => Math.abs(x - y) < 0.5);
}

/**
 * Monotone cubic Hermite (Fritsch–Carlson) interpolation through the curve
 * points, sampled into a 0..255 lookup table. Matches how most photo editors
 * draw a point curve and never overshoots.
 */
export function buildCurveLut(points: CurvePoint[]): Uint8Array {
  const lut = new Uint8Array(LUT_SIZE);
  if (isIdentity(points)) {
    for (let i = 0; i < LUT_SIZE; i++) lut[i] = i;
    return lut;
  }

  const pts = [...points]
    .map(([x, y]) => [clamp255(x), clamp255(y)] as CurvePoint)
    .sort((a, b) => a[0] - b[0]);
  // Remove duplicate x.
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of pts) {
    if (xs.length && Math.abs(xs[xs.length - 1] - x) < 1e-6) {
      ys[ys.length - 1] = y;
    } else {
      xs.push(x);
      ys.push(y);
    }
  }
  if (xs.length === 1) {
    lut.fill(Math.round(ys[0]));
    return lut;
  }

  const n = xs.length;
  const d: number[] = new Array(n - 1);
  const h: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    h[i] = xs[i + 1] - xs[i];
    d[i] = (ys[i + 1] - ys[i]) / h[i];
  }
  const m: number[] = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const a = m[i] / d[i];
      const b = m[i + 1] / d[i];
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        m[i] = t * a * d[i];
        m[i + 1] = t * b * d[i];
      }
    }
  }

  let seg = 0;
  for (let i = 0; i < LUT_SIZE; i++) {
    const x = i;
    let y: number;
    if (x <= xs[0]) {
      y = ys[0];
    } else if (x >= xs[n - 1]) {
      y = ys[n - 1];
    } else {
      while (seg < n - 2 && x > xs[seg + 1]) seg++;
      const t = (x - xs[seg]) / h[seg];
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      y =
        h00 * ys[seg] +
        h10 * h[seg] * m[seg] +
        h01 * ys[seg + 1] +
        h11 * h[seg] * m[seg + 1];
    }
    lut[i] = Math.round(clamp255(y));
  }
  return lut;
}

function clamp255(v: number): number {
  return Math.min(255, Math.max(0, v));
}

/**
 * Packs the four point curves into one RGBA 256x1 texture:
 * R/G/B = per-channel curves, A = composite RGB curve.
 */
export function buildCurveTexture(adj: Adjustments): Uint8Array {
  const r = buildCurveLut(adj.toneCurveRed);
  const g = buildCurveLut(adj.toneCurveGreen);
  const b = buildCurveLut(adj.toneCurveBlue);
  const a = buildCurveLut(adj.toneCurve);
  const out = new Uint8Array(LUT_SIZE * 4);
  for (let i = 0; i < LUT_SIZE; i++) {
    out[i * 4] = r[i];
    out[i * 4 + 1] = g[i];
    out[i * 4 + 2] = b[i];
    out[i * 4 + 3] = a[i];
  }
  return out;
}

export function hasPointCurve(adj: Adjustments): boolean {
  return (
    !isIdentity(adj.toneCurve) ||
    !isIdentity(adj.toneCurveRed) ||
    !isIdentity(adj.toneCurveGreen) ||
    !isIdentity(adj.toneCurveBlue)
  );
}
