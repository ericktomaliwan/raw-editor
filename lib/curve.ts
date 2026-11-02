import { type Adjustments, type CurvePoint, MAX_CURVE_POINTS } from "./adjustments";

export const LUT_SIZE = 256;

/** Smallest gap between the inputs of neighbouring points when editing. */
const MIN_POINT_GAP = 1;

export function isIdentity(points: CurvePoint[]): boolean {
  if (points.length === 0) return true;
  // A curve holds flat past its first and last points, so points on the
  // diagonal only leave the image alone if they also span the whole range.
  const xs = points.map(([x]) => x);
  return (
    Math.min(...xs) < 0.5 &&
    Math.max(...xs) > 254.5 &&
    points.every(([x, y]) => Math.abs(x - y) < 0.5)
  );
}

/** A curve as the LUT reads it: in range, sorted by input, a later duplicate input winning. */
function sortedCurve(points: CurvePoint[]): CurvePoint[] {
  const sorted = points
    .map(([x, y]) => [clamp255(x), clamp255(y)] as CurvePoint)
    .sort((a, b) => a[0] - b[0]);
  const out: CurvePoint[] = [];
  for (const point of sorted) {
    if (out.length && Math.abs(out[out.length - 1][0] - point[0]) < 1e-6) {
      out[out.length - 1] = point;
    } else {
      out.push(point);
    }
  }
  return out;
}

/**
 * Monotone cubic Hermite (Fritsch–Carlson) interpolation through the curve
 * points, sampled at each of the 256 input levels. Matches how most photo
 * editors draw a point curve and never overshoots.
 */
function sampleCurve(points: CurvePoint[]): number[] {
  if (isIdentity(points)) return Array.from({ length: LUT_SIZE }, (_, i) => i);

  const pts = sortedCurve(points);
  const xs = pts.map(([x]) => x);
  const ys = pts.map(([, y]) => y);
  if (xs.length === 1) return new Array<number>(LUT_SIZE).fill(ys[0]);

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

  const samples = new Array<number>(LUT_SIZE);
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
      y = h00 * ys[seg] + h10 * h[seg] * m[seg] + h01 * ys[seg + 1] + h11 * h[seg] * m[seg + 1];
    }
    samples[i] = clamp255(y);
  }
  return samples;
}

/** The curve as a 0..255 lookup table: what the shader applies. */
export function buildCurveLut(points: CurvePoint[]): Uint8Array {
  return Uint8Array.from(sampleCurve(points), (y) => Math.round(y));
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

/** The points to show and edit for a stored curve; no curve is a straight line between two ends. */
export function editableCurve(points: CurvePoint[]): CurvePoint[] {
  return points.length
    ? sortedCurve(points)
    : [
        [0, 0],
        [255, 255],
      ];
}

/**
 * What to store after an edit: a straight line between untouched ends goes back
 * to "no curve", so a curve put back as it was doesn't count as a change.
 */
export function storedCurve(points: CurvePoint[]): CurvePoint[] {
  const untouched =
    points.length === 2 &&
    points[0][0] === 0 &&
    points[0][1] === 0 &&
    points[1][0] === 255 &&
    points[1][1] === 255;
  return untouched ? [] : points;
}

/**
 * Moves one point of a sorted curve to whole levels. It stays between its
 * neighbours, so points can't swap order during a drag.
 */
export function moveCurvePoint(
  points: CurvePoint[],
  index: number,
  x: number,
  y: number,
): CurvePoint[] {
  const lo = index > 0 ? points[index - 1][0] + MIN_POINT_GAP : 0;
  const hi = index < points.length - 1 ? points[index + 1][0] - MIN_POINT_GAP : 255;
  // Presets can hold points closer than the gap; those keep their input.
  const nextX = lo > hi ? points[index][0] : Math.min(hi, Math.max(lo, Math.round(x)));
  const next = [...points];
  next[index] = [nextX, clamp255(Math.round(y))];
  return next;
}

/** Adds a point to a sorted curve, or returns null if it is full or that input is taken. */
export function insertCurvePoint(
  points: CurvePoint[],
  x: number,
  y: number,
): { points: CurvePoint[]; index: number } | null {
  if (points.length >= MAX_CURVE_POINTS) return null;
  const nextX = clamp255(Math.round(x));
  const after = points.findIndex(([px]) => px > nextX);
  const index = after === -1 ? points.length : after;
  if (index > 0 && nextX - points[index - 1][0] < MIN_POINT_GAP) return null;
  if (index < points.length && points[index][0] - nextX < MIN_POINT_GAP) return null;
  const next = [...points];
  next.splice(index, 0, [nextX, clamp255(Math.round(y))]);
  return { points: next, index };
}

/** Removes a point between the two ends. The ends themselves can only be moved. */
export function removeCurvePoint(points: CurvePoint[], index: number): CurvePoint[] {
  if (index <= 0 || index >= points.length - 1) return points;
  return points.filter((_, i) => i !== index);
}

/** Index of the point closest to (x, y) within `radius`, or -1 if none is that close. */
export function nearestCurvePoint(
  points: CurvePoint[],
  x: number,
  y: number,
  radius: number,
): number {
  let nearest = -1;
  let nearestDistance = radius;
  points.forEach(([px, py], i) => {
    const distance = Math.hypot(px - x, py - y);
    if (distance <= nearestDistance) {
      nearest = i;
      nearestDistance = distance;
    }
  });
  return nearest;
}

/**
 * SVG path of a curve on a 255 x 255 plot (y pointing down). Drawn from the
 * samples the LUT is rounded from: rounded ones would show as stairs on shallow
 * slopes.
 */
export function curvePath(points: CurvePoint[]): string {
  const samples = sampleCurve(points);
  let d = "";
  for (let i = 0; i < LUT_SIZE; i++) {
    d += `${i ? "L" : "M"}${i} ${Math.round((255 - samples[i]) * 100) / 100}`;
  }
  return d;
}
