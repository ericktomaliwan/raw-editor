// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { MAX_PRESET_LABEL } from "./presets";
import { parseXmpPreset } from "./xmp";

/** A test namespace: the parser matches the `crs` prefix or the schema name, not a host. */
const NS = `xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:crs="http://example.com/camera-raw-settings/1.0/"`;

/** Wrap attributes and/or child elements in an rdf:Description. */
const xmp = (attrs: string, children = "") =>
  `<?xml version="1.0"?><rdf:RDF ${NS}><rdf:Description ${attrs}>${children}</rdf:Description></rdf:RDF>`;

describe("parseXmpPreset", () => {
  it("reads attribute-style settings", () => {
    const p = parseXmpPreset(
      xmp(`crs:Exposure2012="+0.50" crs:Contrast2012="-20" crs:Texture="15"`),
    );
    expect(p.adjustments).toEqual({ exposure: 0.5, contrast: -20, texture: 15 });
    expect(p.source).toBe("imported");
    expect(p.id).toMatch(/^imported-/);
  });

  it("reads element-style settings, an rdf:Alt name and an rdf:Seq tone curve", () => {
    const p = parseXmpPreset(
      xmp(
        "",
        `<crs:Name><rdf:Alt><rdf:li xml:lang="x-default">Warm Film</rdf:li></rdf:Alt></crs:Name>
         <crs:Clarity2012>25</crs:Clarity2012>
         <crs:ToneCurvePV2012><rdf:Seq>
           <rdf:li>0, 0</rdf:li><rdf:li>128, 140</rdf:li><rdf:li>255, 255</rdf:li>
         </rdf:Seq></crs:ToneCurvePV2012>`,
      ),
    );
    expect(p.name).toBe("Warm Film");
    expect(p.adjustments).toEqual({
      clarity: 25,
      toneCurve: [
        [0, 0],
        [128, 140],
        [255, 255],
      ],
    });
  });

  it("clamps out-of-range values and wraps hues", () => {
    const p = parseXmpPreset(
      xmp(`crs:Exposure2012="+9" crs:Sharpness="200" crs:SplitToningShadowHue="400"`),
    );
    expect(p.adjustments).toEqual({ exposure: 5, sharpness: 150, shadowHue: 40 });
  });

  it("prefers relative white balance and reads Kelvin only for a custom balance", () => {
    expect(
      parseXmpPreset(xmp(`crs:IncrementalTemperature="12" crs:Temperature="9000"`)).adjustments,
    ).toEqual({
      temperature: 12,
    });
    expect(
      parseXmpPreset(xmp(`crs:WhiteBalance="Custom" crs:Temperature="5500" crs:Tint="30"`))
        .adjustments,
    ).toEqual({ temperature: 0, tint: 20 });
    expect(() => parseXmpPreset(xmp(`crs:WhiteBalance="As Shot" crs:Temperature="6500"`))).toThrow(
      /doesn't contain any supported/,
    );
  });

  it("maps HSL keys to channels, leaving others for the base to fill", () => {
    const p = parseXmpPreset(xmp(`crs:HueAdjustmentRed="10" crs:SaturationAdjustmentBlue="-20"`));
    expect(p.adjustments).toEqual({ hslHue: { red: 10 }, hslSaturation: { blue: -20 } });
  });

  it("reads grayscale case-insensitively", () => {
    expect(parseXmpPreset(xmp(`crs:ConvertToGrayscale="True"`)).adjustments).toEqual({
      grayscale: true,
    });
  });

  it("falls back to the given name and group, and caps label length", () => {
    const p = parseXmpPreset(xmp(`crs:Vibrance="10"`), "file name", "Folder");
    expect(p.name).toBe("file name");
    expect(p.group).toBe("Folder");
    const own = parseXmpPreset(
      xmp(`crs:Vibrance="10" crs:Group="Pack" crs:Name="${"n".repeat(500)}"`),
      "x",
      "Folder",
    );
    expect(own.group).toBe("Pack");
    expect(own.name).toHaveLength(MAX_PRESET_LABEL);
  });

  it("rejects files that aren't usable presets", () => {
    expect(() => parseXmpPreset("<not xml")).toThrow("Not a valid XMP file.");
    expect(() => parseXmpPreset(`<?xml version="1.0"?><root/>`)).toThrow(/No rdf:Description/);
    expect(() => parseXmpPreset(xmp(`crs:Unknown="1"`))).toThrow(/doesn't contain any supported/);
  });
});
