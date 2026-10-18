import { describe, expect, it } from "vitest";
import { EXPORT_FORMATS } from "../exportFormat";
import { ExportEstimator } from "./estimate";

const full = { width: 4000, height: 3000 }; // 12 MP
const half = { width: 2000, height: 1500 }; // 3 MP
const done = { resizeMs: 0, usedBuiltInResize: false };

describe("ExportEstimator", () => {
  it("starts from the per-format defaults", () => {
    const e = new ExportEstimator();
    expect(e.estimate("image/png", full, full)).toBe(
      12 * EXPORT_FORMATS["image/png"].estimateMsPerMegapixel,
    );
  });

  it("never estimates below the floor", () => {
    expect(
      new ExportEstimator().estimate(
        "image/jpeg",
        { width: 10, height: 10 },
        { width: 10, height: 10 },
      ),
    ).toBe(400);
  });

  it("adds resize time, per full-size megapixel, for a smaller export", () => {
    const e = new ExportEstimator();
    const encode = 3 * EXPORT_FORMATS["image/jpeg"].estimateMsPerMegapixel;
    expect(e.estimate("image/jpeg", full, half)).toBe(encode + 12 * 80);
  });

  it("learns each format's rate from finished exports", () => {
    const e = new ExportEstimator();
    e.record("image/jpeg", full, full, 2400, done); // 200 ms/MP
    expect(e.estimate("image/jpeg", full, full)).toBe(2400);
    expect(e.estimate("image/png", full, full)).toBe(
      12 * EXPORT_FORMATS["image/png"].estimateMsPerMegapixel,
    );
  });

  it("learns the resize rate separately from the encode rate", () => {
    const e = new ExportEstimator();
    e.record("image/webp", full, half, 1800 + 1200, { resizeMs: 1200, usedBuiltInResize: false });
    // encode: 1800 ms / 3 MP = 600 ms/MP; resize: 1200 ms / 12 MP = 100 ms/MP
    expect(e.estimate("image/webp", full, half)).toBe(1800 + 1200);
  });

  it("doesn't learn a resize rate from the GPU fallback", () => {
    const e = new ExportEstimator();
    e.record("image/webp", full, half, 900, { resizeMs: 5, usedBuiltInResize: true });
    expect(e.estimate("image/webp", full, half)).toBe(Math.round(895) + 12 * 80);
  });
});
