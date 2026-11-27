/**
 * Geometry of the gradient masks and their on-photo handles. Pure functions,
 * no DOM, so the rules can be tested apart from the pointer handling in
 * MaskOverlay (the same split as crop.ts and CropOverlay).
 *
 * Points are image uv. Lengths and angles are worked out in "iso" space, uv
 * scaled by (width, height) / long edge, where distances are proportional to
 * pixels: that is the space the shader measures masks in.
 */

import type { CropRect } from "../crop";
import type { LinearMask, RadialMask } from "../layers";

export type UV = readonly [u: number, v: number];

export interface Iso {
  sx: number;
  sy: number;
}

/** Smallest radial semi-axis and gradient length, as fractions of the long edge. */
export const MIN_RADIUS = 0.005;
export const MIN_GRADIENT = 0.005;

export function isoOf(width: number, height: number): Iso {
  const long = Math.max(width, height, 1);
  return { sx: width / long, sy: height / long };
}

const toIso = ([u, v]: UV, { sx, sy }: Iso): [number, number] => [u * sx, v * sy];
const fromIso = (x: number, y: number, { sx, sy }: Iso): UV => [x / sx, y / sy];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

// ---------- screen <-> image ----------

/** A pointer position over the displayed picture, as image uv. */
export function clientToUv(
  clientX: number,
  clientY: number,
  box: { left: number; top: number; width: number; height: number },
  view: CropRect,
  imageWidth: number,
  imageHeight: number,
): UV {
  const px = view.x + ((clientX - box.left) / box.width) * view.width;
  const py = view.y + ((clientY - box.top) / box.height) * view.height;
  return [px / imageWidth, py / imageHeight];
}

/** Where an image uv point sits over the displayed picture, as CSS percentages. */
export function uvToPercent(
  [u, v]: UV,
  view: CropRect,
  imageWidth: number,
  imageHeight: number,
): { left: string; top: string } {
  return {
    left: `${((u * imageWidth - view.x) / view.width) * 100}%`,
    top: `${((v * imageHeight - view.y) / view.height) * 100}%`,
  };
}

// ---------- linear gradient ----------

export const linearStart = (m: LinearMask): UV => [m.x0, m.y0];
export const linearEnd = (m: LinearMask): UV => [m.x1, m.y1];
export const linearMid = (m: LinearMask): UV => [(m.x0 + m.x1) / 2, (m.y0 + m.y1) / 2];

/**
 * The three guide lines (start, middle, end), each as two far-apart points
 * across the gradient's direction, so they span any photo.
 */
export function linearGuides(m: LinearMask, iso: Iso): [UV, UV][] {
  const [x0, y0] = toIso(linearStart(m), iso);
  const [x1, y1] = toIso(linearEnd(m), iso);
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const px = (-(y1 - y0) / len) * 3;
  const py = ((x1 - x0) / len) * 3;
  return [0, 0.5, 1].map((t) => {
    const cx = x0 + (x1 - x0) * t;
    const cy = y0 + (y1 - y0) * t;
    return [fromIso(cx - px, cy - py, iso), fromIso(cx + px, cy + py, iso)];
  });
}

/** Move one end of the gradient to `p`; refused (unchanged) if the ends would meet. */
export function moveLinearEnd(m: LinearMask, end: "start" | "end", p: UV, iso: Iso): LinearMask {
  const next = end === "start" ? { ...m, x0: p[0], y0: p[1] } : { ...m, x1: p[0], y1: p[1] };
  const [ax, ay] = toIso(linearStart(next), iso);
  const [bx, by] = toIso(linearEnd(next), iso);
  return Math.hypot(bx - ax, by - ay) < MIN_GRADIENT ? m : next;
}

export function moveLinear(start: LinearMask, du: number, dv: number): LinearMask {
  return { ...start, x0: start.x0 + du, y0: start.y0 + dv, x1: start.x1 + du, y1: start.y1 + dv };
}

/** CPU version of the shader's linearMask(), for tests and reasoning. */
export function linearMaskAt(m: LinearMask, p: UV, iso: Iso): number {
  const [x0, y0] = toIso(linearStart(m), iso);
  const [x1, y1] = toIso(linearEnd(m), iso);
  const [x, y] = toIso(p, iso);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const t = ((x - x0) * dx + (y - y0) * dy) / Math.max(dx * dx + dy * dy, 1e-8);
  return 1 - smoothstep(0, 1, t);
}

// ---------- radial gradient ----------

export type RadialHandle = "left" | "right" | "top" | "bottom";

/** Unit vectors of the ellipse's own x and y axes, in iso space. */
function axes(angle: number): { ax: [number, number]; ay: [number, number] } {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { ax: [c, s], ay: [-s, c] };
}

/** The handle positions: the centre, the ends of both axes, and the rotate handle above the top. */
export function radialHandles(
  m: RadialMask,
  iso: Iso,
): Record<RadialHandle | "center" | "rotate", UV> {
  const [cx, cy] = toIso([m.cx, m.cy], iso);
  const { ax, ay } = axes(m.angle);
  const at = (dx: number, dy: number) => fromIso(cx + dx, cy + dy, iso);
  const lift = m.ry + Math.max(m.ry * 0.25, 0.03);
  return {
    center: [m.cx, m.cy],
    right: at(ax[0] * m.rx, ax[1] * m.rx),
    left: at(-ax[0] * m.rx, -ax[1] * m.rx),
    bottom: at(ay[0] * m.ry, ay[1] * m.ry),
    top: at(-ay[0] * m.ry, -ay[1] * m.ry),
    rotate: at(-ay[0] * lift, -ay[1] * lift),
  };
}

/** Drag an axis handle to `p`: that semi-axis becomes p's distance along it. The centre stays. */
export function resizeRadial(m: RadialMask, handle: RadialHandle, p: UV, iso: Iso): RadialMask {
  const [cx, cy] = toIso([m.cx, m.cy], iso);
  const [x, y] = toIso(p, iso);
  const { ax, ay } = axes(m.angle);
  const along = handle === "left" || handle === "right" ? ax : ay;
  const r = Math.max(Math.abs((x - cx) * along[0] + (y - cy) * along[1]), MIN_RADIUS);
  return handle === "left" || handle === "right" ? { ...m, rx: r } : { ...m, ry: r };
}

/** Drag the rotate handle (which sits above the top) to `p`. */
export function rotateRadial(m: RadialMask, p: UV, iso: Iso): RadialMask {
  const [cx, cy] = toIso([m.cx, m.cy], iso);
  const [x, y] = toIso(p, iso);
  if (x === cx && y === cy) return m;
  // The handle is on the ellipse's -y axis, which points at angle - 90deg.
  let angle = Math.atan2(y - cy, x - cx) + Math.PI / 2;
  if (angle > Math.PI) angle -= 2 * Math.PI;
  return { ...m, angle };
}

export function moveRadial(start: RadialMask, du: number, dv: number): RadialMask {
  return { ...start, cx: clamp01(start.cx + du), cy: clamp01(start.cy + dv) };
}

/** CPU version of the shader's radialMask() (without its anti-aliasing), for tests. */
export function radialMaskAt(m: RadialMask, p: UV, iso: Iso): number {
  const [cx, cy] = toIso([m.cx, m.cy], iso);
  const [x, y] = toIso(p, iso);
  const c = Math.cos(m.angle);
  const s = Math.sin(m.angle);
  const qx = c * (x - cx) + s * (y - cy);
  const qy = -s * (x - cx) + c * (y - cy);
  const e = Math.hypot(qx / m.rx, qy / m.ry);
  const w = Math.max(m.feather / 100, 1e-4);
  const inside = 1 - smoothstep(1 - w, 1, e);
  return m.invert ? 1 - inside : inside;
}
