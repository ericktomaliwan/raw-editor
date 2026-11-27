import { describe, expect, it } from "vitest";
import type { LinearMask, RadialMask } from "../layers";
import {
  clientToUv,
  isoOf,
  linearMaskAt,
  MIN_RADIUS,
  moveLinear,
  moveLinearEnd,
  moveRadial,
  radialHandles,
  radialMaskAt,
  resizeRadial,
  rotateRadial,
  uvToPercent,
} from "./geometry";

const W = 3000;
const H = 2000;
const iso = isoOf(W, H); // { sx: 1, sy: 2/3 }

const radial = (over: Partial<RadialMask> = {}): RadialMask => ({
  type: "radial",
  cx: 0.5,
  cy: 0.5,
  rx: 0.2,
  ry: 0.1,
  angle: 0,
  feather: 0,
  invert: false,
  ...over,
});
const linear: LinearMask = { type: "linear", x0: 0.5, y0: 0.2, x1: 0.5, y1: 0.6 };

describe("screen <-> image", () => {
  it("maps a pointer over a cropped view to image uv and back", () => {
    const view = { x: 1000, y: 500, width: 1000, height: 1000 };
    const box = { left: 100, top: 50, width: 400, height: 400 };
    const uv = clientToUv(300, 150, box, view, W, H); // middle across, a quarter down
    expect(uv[0]).toBeCloseTo(1500 / W);
    expect(uv[1]).toBeCloseTo(750 / H);
    const pct = uvToPercent(uv, view, W, H);
    expect(parseFloat(pct.left)).toBeCloseTo(50);
    expect(parseFloat(pct.top)).toBeCloseTo(25);
  });
});

describe("linear gradient", () => {
  it("is full before the start, none past the end, half in the middle", () => {
    expect(linearMaskAt(linear, [0.5, 0.1], iso)).toBe(1);
    expect(linearMaskAt(linear, [0.2, 0.2], iso)).toBe(1); // along the start line
    expect(linearMaskAt(linear, [0.5, 0.4], iso)).toBeCloseTo(0.5);
    expect(linearMaskAt(linear, [0.9, 0.7], iso)).toBe(0);
  });

  it("moves its ends, but never onto each other", () => {
    expect(moveLinearEnd(linear, "end", [0.5, 0.9], iso)).toMatchObject({ x1: 0.5, y1: 0.9 });
    expect(moveLinearEnd(linear, "end", [0.5, 0.2], iso)).toBe(linear);
    expect(moveLinear(linear, 0.1, -0.1)).toMatchObject({ x0: 0.6, y1: 0.5 });
  });
});

describe("radial gradient", () => {
  it("is full inside, none outside, and the other way round inverted", () => {
    const m = radial();
    expect(radialMaskAt(m, [0.5, 0.5], iso)).toBe(1);
    expect(radialMaskAt(m, [0.69, 0.5], iso)).toBe(1); // inside rx = 0.2 (in long-edge units)
    expect(radialMaskAt(m, [0.71, 0.5], iso)).toBe(0);
    // ry = 0.1 long-edge units = 0.15 of the height
    expect(radialMaskAt(m, [0.5, 0.64], iso)).toBe(1);
    expect(radialMaskAt(m, [0.5, 0.66], iso)).toBe(0);
    expect(radialMaskAt({ ...m, invert: true }, [0.5, 0.5], iso)).toBe(0);
  });

  it("feathers towards its edge", () => {
    const m = radial({ feather: 50 });
    expect(radialMaskAt(m, [0.59, 0.5], iso)).toBe(1); // e = 0.45, inside 1 - feather
    const half = radialMaskAt(m, [0.65, 0.5], iso); // e = 0.75
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);
  });

  it("puts its handles on its axes, round in pixels", () => {
    const h = radialHandles(radial({ rx: 0.1, ry: 0.1 }), iso);
    expect(h.right[0]).toBeCloseTo(0.6);
    // The same length is a larger share of the shorter side.
    expect(h.bottom[1]).toBeCloseTo(0.5 + 0.1 / (2 / 3));
    expect(h.rotate[1]).toBeLessThan(h.top[1]);
  });

  it("turns its handles with it", () => {
    const h = radialHandles(radial({ angle: Math.PI / 2 }), iso);
    // A quarter turn clockwise: the x axis points down the image.
    expect(h.right[0]).toBeCloseTo(0.5);
    expect(h.right[1]).toBeGreaterThan(0.5);
  });

  it("resizes one semi-axis from the centre, down to a minimum", () => {
    const m = radial();
    expect(resizeRadial(m, "left", [0.2, 0.9], iso).rx).toBeCloseTo(0.3);
    expect(resizeRadial(m, "top", [0.5, 0.2], iso).ry).toBeCloseTo(0.2);
    expect(resizeRadial(m, "right", [0.5, 0.5], iso).rx).toBe(MIN_RADIUS);
  });

  it("rotates so the rotate handle follows the pointer", () => {
    const m = rotateRadial(radial(), [0.9, 0.5], iso); // pointer to the right of the centre
    expect(m.angle).toBeCloseTo(Math.PI / 2);
    const h = radialHandles(m, iso);
    expect(h.rotate[0]).toBeGreaterThan(0.5);
    expect(h.rotate[1]).toBeCloseTo(0.5);
    // Rotated, the long axis is vertical: a point right of the centre is now outside.
    expect(radialMaskAt(m, [0.65, 0.5], iso)).toBe(0);
    expect(radialMaskAt(m, [0.5, 0.75], iso)).toBe(1);
  });

  it("moves, keeping its centre on the photo", () => {
    expect(moveRadial(radial(), 0.2, -0.1)).toMatchObject({ cx: 0.7, cy: 0.4 });
    expect(moveRadial(radial(), 0.9, -0.9)).toMatchObject({ cx: 1, cy: 0 });
  });
});
