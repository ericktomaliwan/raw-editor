import { describe, expect, it } from "vitest";
import {
  ASPECT_PRESETS,
  type CropHandle,
  type CropRect,
  applyAspect,
  aspectLabel,
  fullRect,
  isFullRect,
  moveRect,
  resizeRect,
  resolveAspect,
} from "./crop";

const preset = (id: string) => ASPECT_PRESETS.find((p) => p.id === id)!;

/** Every crop must be whole pixels, inside the image and not inside out. */
function expectValid(r: CropRect, imageWidth: number, imageHeight: number) {
  for (const v of [r.x, r.y, r.width, r.height]) expect(Number.isInteger(v)).toBe(true);
  expect(r.x).toBeGreaterThanOrEqual(0);
  expect(r.y).toBeGreaterThanOrEqual(0);
  expect(r.x + r.width).toBeLessThanOrEqual(imageWidth);
  expect(r.y + r.height).toBeLessThanOrEqual(imageHeight);
  expect(r.width).toBeGreaterThan(0);
  expect(r.height).toBeGreaterThan(0);
}

/** A locked ratio may be off by under a pixel (whole-pixel rounding), no more. */
function expectRatio(r: CropRect, ratio: number) {
  const off = Math.min(Math.abs(r.width - r.height * ratio), Math.abs(r.height - r.width / ratio));
  expect(off).toBeLessThan(1);
}

describe("full rect", () => {
  it("covers the image and is recognised as such", () => {
    expect(fullRect(6000, 4000)).toEqual({ x: 0, y: 0, width: 6000, height: 4000 });
    expect(isFullRect(fullRect(6000, 4000), 6000, 4000)).toBe(true);
    expect(isFullRect({ x: 1, y: 0, width: 5999, height: 4000 }, 6000, 4000)).toBe(false);
  });
});

describe("aspect presets", () => {
  it("resolves to width / height", () => {
    expect(resolveAspect({ id: "free", portrait: false }, 6000, 4000)).toBeNull();
    expect(resolveAspect({ id: "original", portrait: false }, 6000, 4000)).toBe(1.5);
    expect(resolveAspect({ id: "16:9", portrait: false }, 6000, 4000)).toBe(16 / 9);
    expect(resolveAspect({ id: "16:9", portrait: true }, 6000, 4000)).toBe(9 / 16);
  });

  it("ignores portrait for a square and treats an unknown id as free", () => {
    expect(resolveAspect({ id: "1:1", portrait: true }, 6000, 4000)).toBe(1);
    expect(resolveAspect({ id: "nope", portrait: false }, 6000, 4000)).toBeNull();
  });

  it("labels ratios, turned for portrait", () => {
    expect(aspectLabel(preset("1:1"), false)).toBe("Square");
    expect(aspectLabel(preset("16:9"), false)).toBe("16:9");
    expect(aspectLabel(preset("16:9"), true)).toBe("9:16");
  });

  it("lists every fixed ratio in landscape form", () => {
    for (const p of ASPECT_PRESETS)
      if (p.ratio) expect(p.ratio.w).toBeGreaterThanOrEqual(p.ratio.h);
  });
});

describe("applyAspect", () => {
  it("gives the largest centred crop of that shape from the full image", () => {
    expect(applyAspect(fullRect(6000, 4000), 1, 6000, 4000)).toEqual({
      x: 1000,
      y: 0,
      width: 4000,
      height: 4000,
    });
    expect(applyAspect(fullRect(6000, 4000), 16 / 9, 6000, 4000)).toEqual({
      x: 0,
      y: 313,
      width: 6000,
      height: 3375,
    });
  });

  it("stays inside the image and on ratio from any starting crop", () => {
    const starts: CropRect[] = [
      { x: 0, y: 0, width: 16, height: 16 },
      { x: 5900, y: 3900, width: 100, height: 100 },
      { x: 100, y: 1000, width: 5800, height: 200 },
    ];
    for (const start of starts) {
      for (const ratio of [1, 16 / 9, 9 / 16, 4 / 5, 3]) {
        const r = applyAspect(start, ratio, 6000, 4000);
        expectValid(r, 6000, 4000);
        expectRatio(r, ratio);
      }
    }
  });
});

describe("moveRect", () => {
  const start = { x: 100, y: 100, width: 200, height: 200 };

  it("moves by whole pixels and keeps the size", () => {
    expect(moveRect(start, 10.4, -20.6, 1000, 800)).toEqual({
      x: 110,
      y: 79,
      width: 200,
      height: 200,
    });
  });

  it("stops at the image edges", () => {
    expect(moveRect(start, -500, -500, 1000, 800)).toMatchObject({ x: 0, y: 0 });
    expect(moveRect(start, 10000, 10000, 1000, 800)).toMatchObject({ x: 800, y: 600 });
  });
});

describe("resizeRect", () => {
  const start = { x: 100, y: 100, width: 200, height: 200 };

  it("free: moves only the dragged sides", () => {
    expect(resizeRect(start, "se", 50, 30, null, 1000, 800)).toEqual({
      x: 100,
      y: 100,
      width: 250,
      height: 230,
    });
    expect(resizeRect(start, "w", -40, 999, null, 1000, 800)).toEqual({
      x: 60,
      y: 100,
      width: 240,
      height: 200,
    });
  });

  it("free: stops at the image edges", () => {
    expect(resizeRect(start, "se", 10000, 10000, null, 1000, 800)).toEqual({
      x: 100,
      y: 100,
      width: 900,
      height: 700,
    });
  });

  it("free: never flips inside out or drops below the minimum size", () => {
    expect(resizeRect(start, "nw", 1000, 1000, null, 1000, 800)).toEqual({
      x: 284,
      y: 284,
      width: 16,
      height: 16,
    });
  });

  it("ratio: a corner keeps the opposite corner fixed", () => {
    const r = resizeRect({ x: 0, y: 0, width: 400, height: 300 }, "se", 100, 0, 4 / 3, 1000, 1000);
    expect(r).toEqual({ x: 0, y: 0, width: 500, height: 375 });
  });

  it("ratio: an edge grows the other dimension equally on both sides", () => {
    const r = resizeRect(
      { x: 100, y: 100, width: 400, height: 300 },
      "e",
      80,
      0,
      4 / 3,
      1000,
      1000,
    );
    expect(r).toEqual({ x: 100, y: 70, width: 480, height: 360 });
  });

  it("always returns a valid crop, on ratio when one is locked", () => {
    const handles: Exclude<CropHandle, "move">[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
    const deltas = [-5000, -300, -7.3, 0, 7.3, 300, 5000];
    const begin = { x: 200, y: 150, width: 600, height: 400 };
    for (const handle of handles) {
      for (const ratio of [null, 1, 16 / 9, 2 / 3]) {
        for (const dx of deltas) {
          for (const dy of deltas) {
            const r = resizeRect(begin, handle, dx, dy, ratio, 1200, 900);
            expectValid(r, 1200, 900);
            expect(r.width).toBeGreaterThanOrEqual(16);
            expect(r.height).toBeGreaterThanOrEqual(16);
            if (ratio !== null) expectRatio(r, ratio);
          }
        }
      }
    }
  });
});
