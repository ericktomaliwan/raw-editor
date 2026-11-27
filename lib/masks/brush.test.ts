import { describe, expect, it } from "vitest";
import type { BrushStroke } from "../layers";
import {
  addStrokePoint,
  diffStrokes,
  isStrokeGrowth,
  MAX_BRUSH_SIZE,
  MIN_BRUSH_SIZE,
  stepBrushSize,
  strokeDabs,
} from "./brush";

const stroke = (points: number[], over: Partial<BrushStroke> = {}): BrushStroke => ({
  erase: false,
  size: 0.04,
  feather: 50,
  flow: 100,
  points,
  ...over,
});

describe("addStrokePoint", () => {
  it("keeps the first point and those far enough from the last", () => {
    let pts = addStrokePoint([], 0.1, 0.1, 0.04, 1, 1);
    expect(pts).toEqual([0.1, 0.1]);
    const same = addStrokePoint(pts, 0.101, 0.1, 0.04, 1, 1); // under 0.15 radii away
    expect(same).toBe(pts);
    pts = addStrokePoint(pts, 0.12, 0.1, 0.04, 1, 1);
    expect(pts).toEqual([0.1, 0.1, 0.12, 0.1]);
  });

  it("measures in pixel proportions, not raw uv", () => {
    // On a photo half as tall as wide, 0.01 of the height is only 0.005 of the long edge.
    const pts = addStrokePoint([0.5, 0.5], 0.5, 0.51, 0.04, 1, 0.5);
    expect(pts).toEqual([0.5, 0.5]);
  });

  it("rounds coordinates to keep strokes compact", () => {
    expect(addStrokePoint([], 0.123456789, 0.987654321, 0.04, 1, 1)).toEqual([0.12346, 0.98765]);
  });
});

describe("strokeDabs", () => {
  it("draws a dab on a single click", () => {
    expect(Array.from(strokeDabs(stroke([0.3, 0.4]), 1, 1))).toEqual([
      expect.closeTo(0.3, 6),
      expect.closeTo(0.4, 6),
    ]);
  });

  it("spaces dabs a quarter radius apart along the path", () => {
    const dabs = strokeDabs(stroke([0, 0.5, 0.1, 0.5]), 1, 1); // 0.1 long, step 0.01
    expect(dabs.length / 2).toBe(11);
    expect(dabs[2]).toBeCloseTo(0.01);
    expect(dabs[20]).toBeCloseTo(0.1);
  });

  it("carries spacing across points, so a stroke that grows keeps its earlier dabs", () => {
    const short = strokeDabs(stroke([0, 0, 0.025, 0, 0.051, 0]), 1, 1);
    const long = strokeDabs(stroke([0, 0, 0.025, 0, 0.051, 0, 0.09, 0.02]), 1, 1);
    expect(long.length).toBeGreaterThan(short.length);
    expect(Array.from(long.slice(0, short.length))).toEqual(Array.from(short));
  });
});

describe("diffStrokes", () => {
  const a = stroke([0.1, 0.1]);
  const b = stroke([0.2, 0.2]);

  it("appends new strokes", () => {
    expect(diffStrokes([a], [a, b], 1)).toEqual({ kind: "append", from: 1 });
    expect(diffStrokes([], [a], 0)).toEqual({ kind: "append", from: 0 });
    expect(diffStrokes([a, b], [a, b], 3)).toEqual({ kind: "append", from: 2 });
  });

  it("continues the stroke being painted", () => {
    const grown = { ...b, points: [...b.points, 0.3, 0.3] };
    expect(diffStrokes([a, b], [a, grown], 4)).toEqual({ kind: "grow", index: 1, fromDab: 4 });
  });

  it("redraws after an undo or a different stroke", () => {
    expect(diffStrokes([a, b], [a], 1)).toEqual({ kind: "redraw" });
    expect(diffStrokes([a, b], [b], 1)).toEqual({ kind: "redraw" });
    const other = stroke([0.2, 0.2], { erase: true });
    expect(diffStrokes([a, b], [a, other], 1)).toEqual({ kind: "redraw" });
  });
});

describe("isStrokeGrowth", () => {
  it("needs the same settings and the same points so far", () => {
    const s = stroke([0.1, 0.1, 0.2, 0.2]);
    expect(isStrokeGrowth(s, stroke([0.1, 0.1, 0.2, 0.2, 0.3, 0.3]))).toBe(true);
    expect(isStrokeGrowth(s, stroke([0.1, 0.1, 0.25, 0.2, 0.3, 0.3]))).toBe(false);
    expect(isStrokeGrowth(s, stroke([0.1, 0.1, 0.2, 0.2], { flow: 50 }))).toBe(false);
    expect(isStrokeGrowth(s, stroke([0.1, 0.1]))).toBe(false);
  });
});

describe("stepBrushSize", () => {
  it("steps up and down within limits", () => {
    expect(stepBrushSize(0.05, true)).toBeCloseTo(0.06);
    expect(stepBrushSize(0.06, false)).toBeCloseTo(0.05);
    expect(stepBrushSize(MAX_BRUSH_SIZE, true)).toBe(MAX_BRUSH_SIZE);
    expect(stepBrushSize(MIN_BRUSH_SIZE, false)).toBe(MIN_BRUSH_SIZE);
  });
});
