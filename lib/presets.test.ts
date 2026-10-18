import { describe, expect, it } from "vitest";
import { HSL_CHANNELS, sanitizeAdjustments } from "./adjustments";
import { BUILTIN_ID_PREFIX, BUILTIN_PRESETS } from "./presets";

describe("built-in presets", () => {
  it("have unique ids in the built-in namespace", () => {
    const ids = BUILTIN_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of BUILTIN_PRESETS) {
      expect(p.id.startsWith(BUILTIN_ID_PREFIX)).toBe(true);
      expect(p.source).toBe("builtin");
    }
  });

  it("hold only valid, in-range settings", () => {
    for (const p of BUILTIN_PRESETS)
      expect(sanitizeAdjustments(p.adjustments)).toEqual(p.adjustments);
  });

  it("list all eight channels in any HSL setting they use", () => {
    for (const p of BUILTIN_PRESETS) {
      for (const key of ["hslHue", "hslSaturation", "hslLuminance"] as const) {
        const triple = p.adjustments[key];
        if (triple) expect(Object.keys(triple).sort()).toEqual([...HSL_CHANNELS].sort());
      }
    }
  });
});
