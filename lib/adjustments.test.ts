import { describe, expect, it } from "vitest";
import {
  applyPreset,
  createDefaultAdjustments,
  DEFAULT_ADJUSTMENTS,
  isDefault,
  MAX_CURVE_POINTS,
  sanitizeAdjustments,
} from "./adjustments";

describe("defaults", () => {
  it("hands out independent copies", () => {
    const a = createDefaultAdjustments();
    a.hslHue.red = 50;
    a.toneCurve.push([10, 20]);
    expect(DEFAULT_ADJUSTMENTS.hslHue.red).toBe(0);
    expect(DEFAULT_ADJUSTMENTS.toneCurve).toEqual([]);
  });

  it("isDefault notices any change", () => {
    expect(isDefault(createDefaultAdjustments())).toBe(true);
    expect(isDefault({ ...createDefaultAdjustments(), exposure: 0.5 })).toBe(false);
    expect(isDefault({ ...createDefaultAdjustments(), grayscale: true })).toBe(false);
  });
});

describe("applyPreset", () => {
  it("replaces plain fields and deep-merges the HSL channels", () => {
    const base = createDefaultAdjustments();
    base.exposure = 1;
    base.hslHue.red = 10;
    const next = applyPreset(base, { exposure: -1, hslHue: { blue: 5 } as never });
    expect(next.exposure).toBe(-1);
    expect(next.hslHue).toMatchObject({ red: 10, blue: 5, green: 0 });
    expect(base.hslHue.blue).toBe(0); // the base is not mutated
  });
});

describe("sanitizeAdjustments", () => {
  it("returns nothing for input that isn't an object", () => {
    for (const input of [null, undefined, 42, "x", [1, 2]])
      expect(sanitizeAdjustments(input)).toEqual({});
  });

  it("keeps a full, valid set unchanged", () => {
    expect(sanitizeAdjustments(createDefaultAdjustments())).toEqual(DEFAULT_ADJUSTMENTS);
  });

  it("drops unknown keys", () => {
    const out = sanitizeAdjustments(
      JSON.parse('{"exposure":1,"evil":"x","__proto__":{"polluted":true}}'),
    );
    expect(out).toEqual({ exposure: 1 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("clamps numbers into range and drops non-numbers", () => {
    expect(sanitizeAdjustments({ exposure: 99, contrast: -500, sharpness: 200 })).toEqual({
      exposure: 5,
      contrast: -100,
      sharpness: 150,
    });
    expect(sanitizeAdjustments({ exposure: "1", contrast: NaN, clarity: Infinity })).toEqual({});
  });

  it("wraps hues instead of clamping them", () => {
    expect(sanitizeAdjustments({ shadowHue: 370, midtoneHue: -30, globalHue: 360 })).toEqual({
      shadowHue: 10,
      midtoneHue: 330,
      globalHue: 360,
    });
  });

  it("clamps curve points, drops malformed ones and caps the count", () => {
    expect(
      sanitizeAdjustments({
        toneCurve: [[-10, 300], "x", [1], [128, "y"], [64, 64]],
        toneCurveRed: "not a curve",
      }),
    ).toEqual({
      toneCurve: [
        [0, 255],
        [64, 64],
      ],
    });
    const long = Array.from({ length: MAX_CURVE_POINTS + 10 }, (_, i) => [i, i]);
    expect(sanitizeAdjustments({ toneCurve: long }).toneCurve).toHaveLength(MAX_CURVE_POINTS);
  });

  it("keeps only valid HSL channels, clamped", () => {
    expect(sanitizeAdjustments({ hslHue: { red: 500, blue: "x", cyan: 10 } })).toEqual({
      hslHue: { red: 100 },
    });
  });

  it("accepts grayscale only as a boolean", () => {
    expect(sanitizeAdjustments({ grayscale: true })).toEqual({ grayscale: true });
    expect(sanitizeAdjustments({ grayscale: "true" })).toEqual({});
  });
});
