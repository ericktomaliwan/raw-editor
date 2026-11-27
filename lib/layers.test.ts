import { describe, expect, it } from "vitest";
import {
  colorRangeWidth,
  createLayer,
  DEFAULT_LOCAL,
  DEFAULT_LUMINANCE,
  isLocalDefault,
  type Layer,
  MASK_CODE,
  MAX_LAYERS,
  nextLayerName,
  packLayerUniforms,
  pickedHue,
} from "./layers";

const W = 3000;
const H = 2000;
const whole = { x: 0, y: 0, width: W, height: H };
const make = (kind: Parameters<typeof createLayer>[0], view = whole, id = "a"): Layer =>
  createLayer(kind, { id, name: "L", view, imageWidth: W, imageHeight: H });
const vec = (arr: Float32Array, i: number) => Array.from(arr.slice(i * 4, i * 4 + 4));

describe("createLayer", () => {
  it("places a linear gradient over the top half of the view", () => {
    const l = make("linear");
    expect(l.mask).toEqual({ type: "linear", x0: 0.5, y0: 0.1, x1: 0.5, y1: 0.5 });
  });

  it("places a radial gradient in the middle of the view, round in pixels", () => {
    const view = { x: 1000, y: 500, width: 1000, height: 1000 };
    const l = make("radial", view);
    if (l.mask.type !== "radial") throw new Error("not radial");
    expect(l.mask.cx).toBeCloseTo(0.5);
    expect(l.mask.cy).toBeCloseTo(0.5);
    // A square view gives equal semi-axes: lengths are in long-edge units.
    expect(l.mask.rx).toBeCloseTo(0.1);
    expect(l.mask.ry).toBeCloseTo(0.1);
    expect(l.mask.invert).toBe(false);
  });

  it("makes range layers that cover the whole photo, narrowed by their range", () => {
    const lum = make("luminance");
    expect(lum.mask.type).toBe("range");
    expect(lum.luminance).toEqual(DEFAULT_LUMINANCE);
    expect(lum.color).toBeNull();
    const col = make("color");
    expect(col.mask.type).toBe("range");
    expect(col.color).not.toBeNull();
    expect(col.luminance).toBeNull();
  });

  it("starts with nothing changed, and copies its defaults", () => {
    const l = make("luminance");
    expect(isLocalDefault(l.adjustments)).toBe(true);
    expect(l.strokes).toEqual([]);
    l.luminance!.lo = 1;
    l.adjustments.exposure = 1;
    expect(DEFAULT_LUMINANCE.lo).not.toBe(1);
    expect(DEFAULT_LOCAL.exposure).toBe(0);
  });
});

describe("nextLayerName", () => {
  it("numbers layers of each kind, filling gaps", () => {
    expect(nextLayerName("radial", [])).toBe("Radial gradient 1");
    const named = (name: string) => ({ ...make("radial"), name });
    expect(nextLayerName("radial", [named("Radial gradient 1")])).toBe("Radial gradient 2");
    expect(nextLayerName("radial", [named("Radial gradient 2")])).toBe("Radial gradient 1");
    expect(nextLayerName("brush", [named("Radial gradient 1")])).toBe("Brush 1");
  });
});

describe("packLayerUniforms", () => {
  it("puts gradient geometry in long-edge units", () => {
    const u = packLayerUniforms([make("linear"), make("radial")], W, H);
    expect(u.count).toBe(2);
    // uv (0.5, 0.1) -> (0.5 * 1, 0.1 * 2/3)
    expect(vec(u.maskA, 0)[0]).toBeCloseTo(0.5);
    expect(vec(u.maskA, 0)[1]).toBeCloseTo(0.1 * (2 / 3));
    expect(vec(u.maskB, 0)[0]).toBe(MASK_CODE.linear);
    expect(vec(u.maskB, 1)[0]).toBe(MASK_CODE.radial);
    expect(vec(u.maskB, 1)[2]).toBeCloseTo(0.5); // feather 50
  });

  it("scales settings by the amount, and zeroes hidden layers", () => {
    const l = make("radial");
    l.adjustments = { ...l.adjustments, exposure: 2, contrast: 50 };
    const half = { ...l, amount: 50 };
    const hidden = { ...l, visible: false };
    const u = packLayerUniforms([l, half, hidden], W, H);
    expect(vec(u.localA, 0)[2]).toBe(2);
    expect(vec(u.localA, 0)[3]).toBeCloseTo(0.5);
    expect(vec(u.localA, 1)[2]).toBe(1);
    expect(vec(u.localA, 2)).toEqual([0, 0, 0, 0]);
    // A hidden layer keeps its slot and its mask, so the mask can still be shown.
    expect(vec(u.maskB, 2)[0]).toBe(MASK_CODE.radial);
  });

  it("packs ranges, with the luminance ends in order", () => {
    const l = make("luminance");
    l.luminance = { lo: 80, hi: 20, feather: 10 };
    l.color = { hue: 370, width: 50 };
    const u = packLayerUniforms([l], W, H);
    expect(vec(u.rangeL, 0).map((v) => +v.toFixed(3))).toEqual([0.2, 0.8, 0.1, 1]);
    const c = vec(u.rangeC, 0);
    expect(c[0]).toBeCloseTo(10 / 360);
    expect(c[1]).toBeCloseTo(colorRangeWidth(50));
    expect(c[2]).toBe(1);
    expect(c[3]).toBe(0); // no brush strokes
  });

  it("flags layers that have brush strokes", () => {
    const l = make("brush");
    const painted = {
      ...l,
      strokes: [{ erase: false, size: 0.05, feather: 50, flow: 100, points: [0.5, 0.5] }],
    };
    const u = packLayerUniforms([l, painted], W, H);
    expect(vec(u.maskB, 0)[0]).toBe(MASK_CODE.brush);
    expect(vec(u.rangeC, 0)[3]).toBe(0);
    expect(vec(u.rangeC, 1)[3]).toBe(1);
  });

  it("packs at most MAX_LAYERS layers", () => {
    const many = Array.from({ length: MAX_LAYERS + 2 }, (_, i) => make("radial", whole, `l${i}`));
    const u = packLayerUniforms(many, W, H);
    expect(u.count).toBe(MAX_LAYERS);
    expect(u.maskA.length).toBe(MAX_LAYERS * 4);
  });
});

describe("pickedHue", () => {
  it("finds the hue of a coloured sample", () => {
    expect(pickedHue(255, 0, 0)).toBe(0);
    expect(pickedHue(0, 255, 0)).toBe(120);
    expect(pickedHue(0, 0, 255)).toBe(240);
    expect(pickedHue(255, 0, 128)).toBe(330);
    expect(pickedHue(190, 40, 35)).toBe(2);
  });

  it("refuses greys, which have no hue to match", () => {
    expect(pickedHue(0, 0, 0)).toBeNull();
    expect(pickedHue(128, 128, 128)).toBeNull();
    expect(pickedHue(130, 128, 126)).toBeNull();
  });
});
