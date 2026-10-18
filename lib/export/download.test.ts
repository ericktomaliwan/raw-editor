import { describe, expect, it } from "vitest";
import { EXPORT_FORMAT_ORDER, EXPORT_FORMATS } from "../exportFormat";
import { exportFileName } from "./download";

describe("exportFileName", () => {
  it("replaces the extension with the format's", () => {
    expect(exportFileName("IMG_1234.dng", "image/jpeg", null)).toBe("IMG_1234-edited.jpg");
    expect(exportFileName("photo.final.png", "image/webp", null)).toBe("photo.final-edited.webp");
    expect(exportFileName("no-extension", "image/png", null)).toBe("no-extension-edited.png");
  });

  it("adds the pixel size when the export was scaled down", () => {
    expect(exportFileName("IMG_1234.dng", "image/jpeg", { width: 2048, height: 1365 })).toBe(
      "IMG_1234-edited-2048x1365.jpg",
    );
  });
});

describe("export formats", () => {
  it("lists every format once, each with a distinct extension", () => {
    expect([...EXPORT_FORMAT_ORDER].sort()).toEqual(Object.keys(EXPORT_FORMATS).sort());
    const extensions = EXPORT_FORMAT_ORDER.map((f) => EXPORT_FORMATS[f].extension);
    expect(new Set(extensions).size).toBe(extensions.length);
  });

  it("offers quality only for the lossy formats", () => {
    expect(EXPORT_FORMATS["image/png"].hasQuality).toBe(false);
    expect(EXPORT_FORMATS["image/jpeg"].hasQuality).toBe(true);
    expect(EXPORT_FORMATS["image/webp"].hasQuality).toBe(true);
  });
});
