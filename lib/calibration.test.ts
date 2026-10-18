import { describe, expect, it } from "vitest";
import { createDefaultAdjustments } from "./adjustments";
import { calibrationMatrix } from "./calibration";

/** Column-major 3x3 matrix times a vector, as the shader computes it. */
function apply(m: Float32Array, v: [number, number, number]) {
  return [0, 1, 2].map((row) => m[row] * v[0] + m[3 + row] * v[1] + m[6 + row] * v[2]);
}

describe("calibrationMatrix", () => {
  it("is the identity at the defaults", () => {
    const m = calibrationMatrix(createDefaultAdjustments());
    const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    m.forEach((v, i) => expect(v).toBeCloseTo(identity[i], 6));
  });

  it("keeps white neutral when every primary moves together", () => {
    const adj = {
      ...createDefaultAdjustments(),
      calRedSaturation: 40,
      calGreenSaturation: 40,
      calBlueSaturation: 40,
    };
    for (const c of apply(calibrationMatrix(adj), [1, 1, 1])) expect(c).toBeCloseTo(1, 5);
  });

  // Known bug: the matrix isn't normalised, so adjusting one primary moves
  // white too (Red Saturation +100 sends white to about (1.67, 0.67, 0.67)).
  // The comment in calibration.ts says white stays white. When this is fixed,
  // the test starts passing, Vitest reports it, and `.fails` should be removed.
  it.fails("keeps white neutral when a single primary is adjusted", () => {
    const adj = { ...createDefaultAdjustments(), calRedSaturation: 100 };
    for (const c of apply(calibrationMatrix(adj), [1, 1, 1])) expect(c).toBeCloseTo(1, 2);
  });
});
