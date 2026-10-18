import { describe, expect, it } from "vitest";
import {
  dngBaselineEv,
  exposureLut,
  luminanceStats,
  MAX_MATCH_EV,
  matchExposureEv,
} from "./exposure";

/** Encoded sRGB value (0..1) of a linear-light value. */
const encode = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

describe("dngBaselineEv", () => {
  it("passes a real BaselineExposure through", () => {
    expect(dngBaselineEv(0.5)).toBe(0.5);
    expect(dngBaselineEv(-1.25)).toBe(-1.25);
    expect(dngBaselineEv(0)).toBe(0);
  });

  it("treats LibRaw's -999 'not set' marker, and anything else odd, as no value", () => {
    expect(dngBaselineEv(-999)).toBeNull();
    expect(dngBaselineEv(undefined)).toBeNull();
    expect(dngBaselineEv(NaN)).toBeNull();
    expect(dngBaselineEv("1")).toBeNull();
  });
});

describe("luminanceStats", () => {
  it("measures a flat grey in linear light", () => {
    const v = Math.round(encode(0.18) * 255); // 18% grey
    const stats = luminanceStats(new Uint8Array(300).fill(v), 3, 255)!;
    expect(stats.median).toBeCloseTo(0.18, 2);
    expect(stats.p999).toBeCloseTo(0.18, 2);
  });

  it("reads 16-bit, RGBA and grey layouts", () => {
    const v16 = Math.round(encode(0.05) * 65535);
    expect(luminanceStats(new Uint16Array(30).fill(v16), 3, 65535)!.median).toBeCloseTo(0.05, 2);
    const rgba = new Uint8Array(40).fill(Math.round(encode(0.05) * 255));
    expect(luminanceStats(rgba, 4, 255)!.median).toBeCloseTo(0.05, 2);
    expect(luminanceStats(new Uint8Array(10).fill(255), 1, 255)!.median).toBeCloseTo(1, 2);
  });

  it("finds the median and the brightest tail of a mixed image", () => {
    // 998 dark pixels and 2 white ones (0.2%): the median is dark, the 99.9th
    // percentile is white. With a single white pixel (exactly 0.1%) it would
    // still be dark: 99.9% of pixels are at or below the dark value.
    const data = new Uint8Array(1000 * 3).fill(Math.round(encode(0.05) * 255));
    data.fill(255, 998 * 3);
    const stats = luminanceStats(data, 3, 255)!;
    expect(stats.median).toBeCloseTo(0.05, 2);
    expect(stats.p999).toBeCloseTo(1, 2);
  });

  it("is null for no pixels", () => {
    expect(luminanceStats(new Uint8Array(0), 3, 255)).toBeNull();
  });
});

describe("matchExposureEv", () => {
  const decode = { median: 0.05, p999: 0.1 };

  it("brightens by the EV between the two medians", () => {
    expect(matchExposureEv(decode, { median: 0.1, p999: 0.5 })).toBeCloseTo(1, 6);
    expect(matchExposureEv(decode, { median: 0.05, p999: 0.5 })).toBe(0);
  });

  it("never darkens", () => {
    expect(matchExposureEv(decode, { median: 0.02, p999: 0.5 })).toBe(0);
  });

  it(`is capped at ${MAX_MATCH_EV} EV`, () => {
    expect(matchExposureEv({ median: 0.01, p999: 0.01 }, { median: 0.5, p999: 1 })).toBe(
      MAX_MATCH_EV,
    );
  });

  it("stops short of clipping more than the brightest 0.1%", () => {
    // Wants +2 EV, but the brightest 0.1% are at 0.5: only +1 EV of headroom.
    expect(matchExposureEv({ median: 0.05, p999: 0.5 }, { median: 0.2, p999: 1 })).toBeCloseTo(
      1,
      6,
    );
  });

  it("does nothing with an unusable measurement", () => {
    expect(matchExposureEv({ median: 0, p999: 0 }, { median: 0.2, p999: 1 })).toBe(0);
    expect(matchExposureEv(decode, { median: 0, p999: 0 })).toBe(0);
  });
});

describe("exposureLut", () => {
  it("at gain 1 is plain rounding to 8 bits", () => {
    const lut8 = exposureLut(8, 1);
    for (let v = 0; v < 256; v++) expect(lut8[v]).toBe(v);
    const lut16 = exposureLut(16, 1);
    expect(lut16.length).toBe(65536);
    expect([lut16[0], lut16[257 * 128], lut16[65535]]).toEqual([0, 128, 255]);
  });

  it("doubles linear light at gain 2 and clips at white", () => {
    const lut = exposureLut(16, 2);
    const in25 = Math.round(encode(0.25) * 65535);
    expect(lut[in25]).toBe(Math.round(encode(0.5) * 255));
    expect(lut[Math.round(encode(0.6) * 65535)]).toBe(255);
    expect(lut[0]).toBe(0);
  });

  it("never reverses tones", () => {
    const lut = exposureLut(16, 2.5);
    for (let v = 1; v < lut.length; v++) expect(lut[v]).toBeGreaterThanOrEqual(lut[v - 1]);
  });
});
