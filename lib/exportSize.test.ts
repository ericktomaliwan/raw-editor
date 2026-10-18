import { describe, expect, it } from "vitest";
import { EXPORT_SIZES, exportDimensions } from "./exportSize";

describe("exportDimensions", () => {
  it("keeps the full size when no long edge is chosen", () => {
    expect(exportDimensions(6000, 4000, null)).toEqual({ width: 6000, height: 4000 });
  });

  it("never enlarges", () => {
    expect(exportDimensions(6000, 4000, 6000)).toEqual({ width: 6000, height: 4000 });
    expect(exportDimensions(1200, 800, 3840)).toEqual({ width: 1200, height: 800 });
  });

  it("caps the long edge and keeps the aspect ratio", () => {
    expect(exportDimensions(6000, 4000, 2048)).toEqual({ width: 2048, height: 1365 });
    expect(exportDimensions(4000, 6000, 1080)).toEqual({ width: 720, height: 1080 });
  });

  it("never rounds a side down to zero", () => {
    expect(exportDimensions(10000, 1, 1080)).toEqual({ width: 1080, height: 1 });
  });

  it("offers sizes largest first", () => {
    expect([...EXPORT_SIZES]).toEqual([...EXPORT_SIZES].sort((a, b) => b - a));
  });
});
