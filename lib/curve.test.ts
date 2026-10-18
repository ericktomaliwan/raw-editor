import { describe, expect, it } from "vitest";
import { createDefaultAdjustments, type CurvePoint } from "./adjustments";
import { buildCurveLut, buildCurveTexture, hasPointCurve, LUT_SIZE } from "./curve";

const identity = Array.from({ length: LUT_SIZE }, (_, i) => i);

describe("buildCurveLut", () => {
  it("is the identity for no points or points on the diagonal", () => {
    expect(Array.from(buildCurveLut([]))).toEqual(identity);
    expect(
      Array.from(
        buildCurveLut([
          [0, 0],
          [255, 255],
        ]),
      ),
    ).toEqual(identity);
  });

  it("passes through every control point", () => {
    const points: CurvePoint[] = [
      [0, 0],
      [64, 32],
      [192, 224],
      [255, 255],
    ];
    const lut = buildCurveLut(points);
    for (const [x, y] of points) expect(lut[x]).toBe(y);
  });

  it("never overshoots: rising points give a rising curve", () => {
    const lut = buildCurveLut([
      [0, 0],
      [60, 50],
      [127, 128],
      [190, 206],
      [253, 255],
    ]);
    for (let i = 1; i < LUT_SIZE; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
  });

  it("holds the end values flat beyond the first and last points", () => {
    const lut = buildCurveLut([
      [50, 20],
      [200, 230],
    ]);
    for (let i = 0; i <= 50; i++) expect(lut[i]).toBe(20);
    for (let i = 200; i < LUT_SIZE; i++) expect(lut[i]).toBe(230);
  });

  it("sorts points and lets a later duplicate x win", () => {
    const lut = buildCurveLut([
      [255, 255],
      [0, 0],
      [128, 100],
      [128, 140],
    ]);
    expect(lut[128]).toBe(140);
  });

  it("turns a single point into a constant", () => {
    expect(new Set(buildCurveLut([[100, 80]]))).toEqual(new Set([80]));
  });
});

describe("buildCurveTexture", () => {
  it("packs R, G, B curves into RGB and the composite curve into alpha", () => {
    const adj = createDefaultAdjustments();
    adj.toneCurveRed = [
      [0, 255],
      [255, 0],
    ];
    const tex = buildCurveTexture(adj);
    expect(tex.length).toBe(LUT_SIZE * 4);
    expect(Array.from(tex.subarray(0, 4))).toEqual([255, 0, 0, 0]);
    expect(Array.from(tex.subarray(255 * 4, 256 * 4))).toEqual([0, 255, 255, 255]);
  });
});

describe("hasPointCurve", () => {
  it("is false for empty or identity curves and true otherwise", () => {
    const adj = createDefaultAdjustments();
    expect(hasPointCurve(adj)).toBe(false);
    adj.toneCurve = [
      [0, 0],
      [255, 255],
    ];
    expect(hasPointCurve(adj)).toBe(false);
    adj.toneCurveBlue = [
      [0, 0],
      [128, 150],
      [255, 255],
    ];
    expect(hasPointCurve(adj)).toBe(true);
  });
});
