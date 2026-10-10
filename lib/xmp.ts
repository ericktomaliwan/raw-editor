import {
  type Adjustments,
  type CurvePoint,
  HSL_CHANNELS,
  type HslTriple,
} from "./adjustments";

export interface Preset {
  id: string;
  name: string;
  group?: string;
  adjustments: Partial<Adjustments>;
  source: "imported";
}

const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

/**
 * Edit settings live in the "camera-raw-settings" XMP schema, conventionally
 * bound to the `crs:` prefix. Match on either so the full namespace URI never
 * needs to be hard-coded.
 */
function isEditSetting(node: Attr | Element): boolean {
  return (
    node.prefix === "crs" ||
    (node.namespaceURI?.includes("camera-raw-settings") ?? false) ||
    (node.nodeName.startsWith("crs:") && !node.namespaceURI)
  );
}

/**
 * Parse an .xmp preset (camera-raw-settings schema) into our adjustment model.
 * Handles both attribute-style (`crs:Exposure2012="+0.50"`) and
 * element-style (`<crs:Exposure2012>+0.50</crs:Exposure2012>`) encodings,
 * plus rdf:Seq tone curves and rdf:Alt localized names.
 */
export function parseXmpPreset(
  xml: string,
  fallbackName = "Imported preset",
  fallbackGroup?: string,
): Preset {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parseError = doc.getElementsByTagName("parsererror")[0];
  if (parseError) {
    throw new Error("Not a valid XMP file.");
  }

  const values = new Map<string, string>();
  const curves = new Map<string, CurvePoint[]>();

  const descriptions = Array.from(doc.getElementsByTagNameNS(RDF_NS, "Description"));
  if (descriptions.length === 0) {
    // Some exporters omit the namespace declaration; fall back to tag names.
    descriptions.push(...Array.from(doc.getElementsByTagName("rdf:Description")));
  }
  if (descriptions.length === 0) {
    throw new Error("No rdf:Description found in XMP.");
  }

  for (const desc of descriptions) {
    for (const attr of Array.from(desc.attributes)) {
      if (isEditSetting(attr)) {
        values.set(attr.localName || attr.name.replace(/^crs:/, ""), attr.value);
      }
    }
    for (const child of Array.from(desc.children)) {
      if (!isEditSetting(child)) continue;
      const local = child.localName || child.tagName.replace(/^crs:/, "");
      const seqItems = child.getElementsByTagNameNS(RDF_NS, "li");
      const items = seqItems.length ? seqItems : child.getElementsByTagName("rdf:li");
      if (items.length) {
        if (local.startsWith("ToneCurve")) {
          curves.set(local, parseCurve(Array.from(items).map((li) => li.textContent ?? "")));
        } else {
          // rdf:Alt localized string (e.g. crs:Name) — take first entry.
          values.set(local, items[0].textContent?.trim() ?? "");
        }
      } else if (child.textContent) {
        values.set(local, child.textContent.trim());
      }
    }
  }

  const num = (key: string): number | undefined => {
    const v = values.get(key);
    if (v === undefined || v === "") return undefined;
    const f = parseFloat(v);
    return Number.isFinite(f) ? f : undefined;
  };
  const first = (...keys: string[]) => {
    for (const k of keys) {
      const v = num(k);
      if (v !== undefined) return v;
    }
    return undefined;
  };

  const adj: Partial<Adjustments> = {};
  const set = <K extends keyof Adjustments>(key: K, v: Adjustments[K] | undefined) => {
    if (v !== undefined) adj[key] = v;
  };
  const clampN = (v: number | undefined, lo: number, hi: number) =>
    v === undefined ? undefined : Math.max(lo, Math.min(hi, v));

  // --- White balance ---
  // Presets built for non-raw files carry relative Incremental* values.
  // Raw presets carry absolute Kelvin (only meaningful when WhiteBalance is Custom).
  const incTemp = num("IncrementalTemperature");
  if (incTemp !== undefined) {
    set("temperature", clampN(incTemp, -100, 100));
  } else {
    const wb = values.get("WhiteBalance");
    const kelvin = num("Temperature");
    if (kelvin !== undefined && (wb === undefined || wb === "Custom")) {
      set("temperature", clampN(kelvinToSlider(kelvin), -100, 100));
    }
  }
  const incTint = num("IncrementalTint");
  if (incTint !== undefined) set("tint", clampN(incTint, -100, 100));
  else {
    const tint = num("Tint");
    const wb = values.get("WhiteBalance");
    if (tint !== undefined && (wb === undefined || wb === "Custom"))
      set("tint", clampN(tint * (100 / 150), -100, 100));
  }

  // --- Tone ---
  set("exposure", clampN(first("Exposure2012", "Exposure"), -5, 5));
  set("contrast", clampN(first("Contrast2012", "Contrast"), -100, 100));
  set("highlights", clampN(first("Highlights2012", "HighlightRecovery"), -100, 100));
  set("shadows", clampN(first("Shadows2012", "FillLight"), -100, 100));
  set("whites", clampN(num("Whites2012"), -100, 100));
  set("blacks", clampN(first("Blacks2012"), -100, 100));
  set("texture", clampN(num("Texture"), -100, 100));
  set("clarity", clampN(first("Clarity2012", "Clarity"), -100, 100));
  set("dehaze", clampN(num("Dehaze"), -100, 100));
  set("vibrance", clampN(num("Vibrance"), -100, 100));
  set("saturation", clampN(num("Saturation"), -100, 100));

  // --- Parametric curve ---
  set("parametricShadows", clampN(num("ParametricShadows"), -100, 100));
  set("parametricDarks", clampN(num("ParametricDarks"), -100, 100));
  set("parametricLights", clampN(num("ParametricLights"), -100, 100));
  set("parametricHighlights", clampN(num("ParametricHighlights"), -100, 100));

  // --- Point curves ---
  const curve = (...keys: string[]) => {
    for (const k of keys) {
      const c = curves.get(k);
      if (c && c.length) return c;
    }
    return undefined;
  };
  set("toneCurve", curve("ToneCurvePV2012", "ToneCurve"));
  set("toneCurveRed", curve("ToneCurvePV2012Red", "ToneCurveRed"));
  set("toneCurveGreen", curve("ToneCurvePV2012Green", "ToneCurveGreen"));
  set("toneCurveBlue", curve("ToneCurvePV2012Blue", "ToneCurveBlue"));

  // --- HSL ---
  const hsl = (prefix: string): HslTriple | undefined => {
    const out: Partial<HslTriple> = {};
    let any = false;
    for (const ch of HSL_CHANNELS) {
      const key = prefix + ch.charAt(0).toUpperCase() + ch.slice(1);
      const v = num(key);
      if (v !== undefined) {
        out[ch] = Math.max(-100, Math.min(100, v));
        any = true;
      }
    }
    return any ? (out as HslTriple) : undefined;
  };
  set("hslHue", hsl("HueAdjustment"));
  set("hslSaturation", hsl("SaturationAdjustment"));
  set("hslLuminance", hsl("LuminanceAdjustment"));

  // --- Color grading / split toning ---
  set("shadowHue", first("SplitToningShadowHue", "ColorGradeShadowHue"));
  set("shadowSaturation", clampN(first("SplitToningShadowSaturation", "ColorGradeShadowSat"), 0, 100));
  set("highlightHue", first("SplitToningHighlightHue", "ColorGradeHighlightHue"));
  set(
    "highlightSaturation",
    clampN(first("SplitToningHighlightSaturation", "ColorGradeHighlightSat"), 0, 100),
  );
  set("midtoneHue", num("ColorGradeMidtoneHue"));
  set("midtoneSaturation", clampN(num("ColorGradeMidtoneSat"), 0, 100));
  set("globalHue", num("ColorGradeGlobalHue"));
  set("globalSaturation", clampN(num("ColorGradeGlobalSat"), 0, 100));
  set("gradingBalance", clampN(first("SplitToningBalance", "ColorGradeBlending"), -100, 100));

  // --- Calibration (camera primaries) ---
  set("shadowTint", clampN(num("ShadowTint"), -100, 100));
  set("calRedHue", clampN(num("RedHue"), -100, 100));
  set("calRedSaturation", clampN(num("RedSaturation"), -100, 100));
  set("calGreenHue", clampN(num("GreenHue"), -100, 100));
  set("calGreenSaturation", clampN(num("GreenSaturation"), -100, 100));
  set("calBlueHue", clampN(num("BlueHue"), -100, 100));
  set("calBlueSaturation", clampN(num("BlueSaturation"), -100, 100));

  // --- Detail / effects ---
  set("sharpness", clampN(num("Sharpness"), 0, 150));
  set("vignette", clampN(first("PostCropVignetteAmount", "VignetteAmount"), -100, 100));
  set("grain", clampN(num("GrainAmount"), 0, 100));

  const gray = values.get("ConvertToGrayscale");
  if (gray !== undefined) set("grayscale", /^true$/i.test(gray));

  const name = values.get("Name")?.trim() || fallbackName;
  const group = values.get("Group")?.trim() || fallbackGroup?.trim() || undefined;

  if (Object.keys(adj).length === 0) {
    throw new Error("This XMP file doesn't contain any supported edit settings.");
  }

  return {
    id: `imported-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    group,
    adjustments: adj,
    source: "imported",
  };
}

function parseCurve(items: string[]): CurvePoint[] {
  const pts: CurvePoint[] = [];
  for (const s of items) {
    const [x, y] = s.split(",").map((v) => parseFloat(v.trim()));
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push([x, y]);
  }
  return pts;
}

/** Map an absolute Kelvin white balance onto our relative -100..100 slider. */
function kelvinToSlider(kelvin: number): number {
  // Kelvin temperature scales are non-linear; 5500K ≈ neutral daylight.
  const neutral = 5500;
  if (kelvin >= neutral) return ((kelvin - neutral) / (50000 - neutral)) * 100 * 2.5;
  return -((neutral - kelvin) / (neutral - 2000)) * 100;
}
