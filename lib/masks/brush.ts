/**
 * Brush strokes as geometry: which points to keep while painting, and where
 * the round "dabs" that draw a stroke go. Pure functions; the GPU side is in
 * lib/webgl/brushMasks.ts.
 *
 * Points are image uv. Distances are measured with uv scaled by
 * (width, height) / long edge, so they are proportional to pixels and a dab is
 * round on any photo.
 */

import type { BrushStroke } from "../layers";

/** Brush radius limits, as fractions of the long edge. */
export const MIN_BRUSH_SIZE = 0.002;
export const MAX_BRUSH_SIZE = 0.25;
/** The brush as set in the panel; each stroke keeps a copy of what it was painted with. */
export interface BrushSettings {
  /** Radius, as a fraction of the long edge. */
  size: number;
  feather: number; // 0..100
  flow: number; // 1..100
}

/** "paint" adds to the mask, "erase" takes away; "off" leaves the pointer to the handles. */
export type BrushMode = "off" | "paint" | "erase";

export const DEFAULT_BRUSH: BrushSettings = { size: 0.04, feather: 60, flow: 100 };

/** Step the brush size up or down by one notch ([ and ] keys), within limits. */
export function stepBrushSize(size: number, up: boolean): number {
  const next = up ? size * 1.2 : size / 1.2;
  return Math.min(MAX_BRUSH_SIZE, Math.max(MIN_BRUSH_SIZE, Math.round(next * 1e4) / 1e4));
}

/** Dabs are this many radii apart: close enough that a stroke shows no beads. */
const DAB_SPACING = 0.25;
/** A new point is kept only once the pointer has moved this many radii. */
const POINT_SPACING = 0.15;

/**
 * Add a pointer position to a stroke's points, unless it is too close to the
 * last kept point to matter. Returns the same array when nothing was added.
 */
export function addStrokePoint(
  points: number[],
  u: number,
  v: number,
  size: number,
  sx: number,
  sy: number,
): number[] {
  const n = points.length;
  if (n >= 2) {
    const dx = (u - points[n - 2]) * sx;
    const dy = (v - points[n - 1]) * sy;
    if (Math.hypot(dx, dy) < size * POINT_SPACING) return points;
  }
  // Rounded so long strokes stay compact in the undo history.
  return [...points, round(u), round(v)];
}

const round = (x: number) => Math.round(x * 1e5) / 1e5;

/**
 * Centres of the dabs that draw a stroke, as flat uv pairs: one on the first
 * point, then one every DAB_SPACING radii along the path. Each dab depends
 * only on the points before it, so a stroke that grew keeps all its earlier
 * dabs, and only the new ones need drawing.
 */
export function strokeDabs(stroke: BrushStroke, sx: number, sy: number): Float32Array {
  const pts = stroke.points;
  if (pts.length < 2) return new Float32Array(0);
  const step = Math.max(stroke.size * DAB_SPACING, 1e-5);
  const out: number[] = [pts[0], pts[1]];
  let carry = 0; // distance walked since the last dab
  for (let i = 2; i + 1 < pts.length; i += 2) {
    const x0 = pts[i - 2] * sx;
    const y0 = pts[i - 1] * sy;
    const x1 = pts[i] * sx;
    const y1 = pts[i + 1] * sy;
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len === 0) continue;
    let t = step - carry; // distance along this segment to the next dab
    while (t <= len) {
      const f = t / len;
      out.push((x0 + (x1 - x0) * f) / sx, (y0 + (y1 - y0) * f) / sy);
      t += step;
    }
    carry = len - (t - step);
  }
  return new Float32Array(out);
}

/** True when `b` is `a` with more points on the end (the same stroke, still being painted). */
export function isStrokeGrowth(a: BrushStroke, b: BrushStroke): boolean {
  if (a === b) return true;
  if (
    a.erase !== b.erase ||
    a.size !== b.size ||
    a.feather !== b.feather ||
    a.flow !== b.flow ||
    b.points.length < a.points.length
  ) {
    return false;
  }
  for (let i = 0; i < a.points.length; i++) if (a.points[i] !== b.points[i]) return false;
  return true;
}

export type StrokeDiff =
  /** Draw `from` onwards; the strokes before it are already drawn. */
  | { kind: "append"; from: number }
  /** Stroke `index` grew: draw its dabs from `fromDab` on, then the strokes after it. */
  | { kind: "grow"; index: number; fromDab: number }
  /** Start over: clear and draw everything. */
  | { kind: "redraw" };

/**
 * What has to be drawn to bring a mask showing `drawn` up to `next`.
 * `drawnLastDabs` is how many dabs of the last drawn stroke are on the mask.
 * Strokes are compared by reference: an edit that keeps a stroke keeps the object.
 */
export function diffStrokes(
  drawn: readonly BrushStroke[],
  next: readonly BrushStroke[],
  drawnLastDabs: number,
): StrokeDiff {
  let k = 0;
  while (k < drawn.length && k < next.length && drawn[k] === next[k]) k++;
  if (k === drawn.length) return { kind: "append", from: k };
  if (k === drawn.length - 1 && k < next.length && isStrokeGrowth(drawn[k], next[k])) {
    return { kind: "grow", index: k, fromDab: drawnLastDabs };
  }
  return { kind: "redraw" };
}
