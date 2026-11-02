import { describe, expect, it } from "vitest";
import { createDefaultAdjustments, type CurvePoint, MAX_CURVE_POINTS } from "./adjustments";
import {
  buildCurveLut,
  buildCurveTexture,
  curvePath,
  editableCurve,
  hasPointCurve,
  insertCurvePoint,
  LUT_SIZE,
  moveCurvePoint,
  nearestCurvePoint,
  removeCurvePoint,
  storedCurve,
} from "./curve";

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

  it("clips past end points moved along the diagonal, as it does just off it", () => {
    const onDiagonal = buildCurveLut([
      [50, 50],
      [200, 200],
    ]);
    expect(onDiagonal[0]).toBe(50);
    expect(onDiagonal[255]).toBe(200);
    expect(onDiagonal[100]).toBe(100);
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

  it("is true for points on the diagonal that don't span the whole range", () => {
    const adj = createDefaultAdjustments();
    adj.toneCurve = [
      [50, 50],
      [255, 255],
    ];
    expect(hasPointCurve(adj)).toBe(true);
  });
});

describe("editing a curve", () => {
  const curve: CurvePoint[] = [
    [0, 0],
    [100, 80],
    [200, 220],
    [255, 255],
  ];

  describe("editableCurve", () => {
    it("shows no curve as a straight line between the two ends", () => {
      expect(editableCurve([])).toEqual([
        [0, 0],
        [255, 255],
      ]);
    });

    it("reads a preset's curve the way the LUT does", () => {
      expect(
        editableCurve([
          [255, 255],
          [128, 100],
          [128, 140],
          [0, 0],
        ]),
      ).toEqual([
        [0, 0],
        [128, 140],
        [255, 255],
      ]);
    });
  });

  describe("storedCurve", () => {
    it("turns untouched ends back into no curve", () => {
      expect(storedCurve(editableCurve([]))).toEqual([]);
    });

    it("keeps anything else, including extra points on the diagonal", () => {
      const moved: CurvePoint[] = [
        [0, 20],
        [255, 255],
      ];
      const onDiagonal: CurvePoint[] = [
        [0, 0],
        [128, 128],
        [255, 255],
      ];
      expect(storedCurve(moved)).toBe(moved);
      expect(storedCurve(onDiagonal)).toBe(onDiagonal);
    });
  });

  describe("moveCurvePoint", () => {
    it("moves the point to whole levels without changing the original", () => {
      const before = structuredClone(curve);
      expect(moveCurvePoint(curve, 1, 120.4, 90.6)[1]).toEqual([120, 91]);
      expect(curve).toEqual(before);
    });

    it("stops short of its neighbours", () => {
      expect(moveCurvePoint(curve, 1, 250, 80)[1][0]).toBe(199);
      expect(moveCurvePoint(curve, 1, -50, 80)[1][0]).toBe(1);
    });

    it("keeps the output in range", () => {
      expect(moveCurvePoint(curve, 1, 100, 300)[1][1]).toBe(255);
      expect(moveCurvePoint(curve, 1, 100, -40)[1][1]).toBe(0);
    });

    it("lets the ends move inward, up to their one neighbour", () => {
      expect(moveCurvePoint(curve, 0, 40, 10)[0]).toEqual([40, 10]);
      expect(moveCurvePoint(curve, 0, 300, 0)[0][0]).toBe(99);
      expect(moveCurvePoint(curve, 3, -10, 255)[3][0]).toBe(201);
    });

    it("keeps the input of a preset point with no room either side", () => {
      const tight: CurvePoint[] = [
        [10, 10],
        [10.2, 50],
        [10.4, 90],
      ];
      expect(moveCurvePoint(tight, 1, 200, 60)[1]).toEqual([10.2, 60]);
    });
  });

  describe("insertCurvePoint", () => {
    it("puts the point in input order and says where", () => {
      const inserted = insertCurvePoint(curve, 150.2, 140.7);
      expect(inserted?.index).toBe(2);
      expect(inserted?.points[2]).toEqual([150, 141]);
      expect(inserted?.points).toHaveLength(curve.length + 1);
    });

    it("can extend a preset's curve past its first or last point", () => {
      const short: CurvePoint[] = [
        [50, 50],
        [200, 200],
      ];
      expect(insertCurvePoint(short, 10, 30)?.index).toBe(0);
      expect(insertCurvePoint(short, 240, 250)?.index).toBe(2);
    });

    it("refuses an input that is already taken", () => {
      expect(insertCurvePoint(curve, 100, 200)).toBeNull();
      expect(insertCurvePoint(curve, -5, 100)).toBeNull();
    });

    it("refuses a full curve", () => {
      const full = Array.from({ length: MAX_CURVE_POINTS }, (_, i) => [i * 2, i * 2] as CurvePoint);
      expect(insertCurvePoint(full, 200, 200)).toBeNull();
    });
  });

  describe("removeCurvePoint", () => {
    it("removes a point between the ends", () => {
      expect(removeCurvePoint(curve, 1)).toEqual([
        [0, 0],
        [200, 220],
        [255, 255],
      ]);
    });

    it("leaves the ends alone", () => {
      expect(removeCurvePoint(curve, 0)).toBe(curve);
      expect(removeCurvePoint(curve, 3)).toBe(curve);
    });
  });

  describe("nearestCurvePoint", () => {
    it("finds the closest point within the radius", () => {
      expect(nearestCurvePoint(curve, 104, 83, 10)).toBe(1);
      expect(nearestCurvePoint(curve, 204, 218, 10)).toBe(2);
    });

    it("finds nothing outside the radius", () => {
      expect(nearestCurvePoint(curve, 150, 20, 10)).toBe(-1);
    });

    it("picks the closer of two points in range", () => {
      const close: CurvePoint[] = [
        [100, 100],
        [106, 100],
      ];
      expect(nearestCurvePoint(close, 104, 100, 10)).toBe(1);
      expect(nearestCurvePoint(close, 102, 100, 10)).toBe(0);
    });
  });

  describe("curvePath", () => {
    it("draws every LUT entry, with y flipped for the screen", () => {
      const path = curvePath([]);
      expect(path.startsWith("M0 255L1 254")).toBe(true);
      expect(path.endsWith("L255 0")).toBe(true);
      expect(path.match(/L/g)).toHaveLength(LUT_SIZE - 1);
    });
  });
});
