/**
 * Editing model. Field names and ranges intentionally mirror the XMP
 * camera-raw-settings schema so that .xmp presets map onto them 1:1.
 */

export type CurvePoint = [x: number, y: number]; // 0..255

export const HSL_CHANNELS = [
  "red",
  "orange",
  "yellow",
  "green",
  "aqua",
  "blue",
  "purple",
  "magenta",
] as const;
export type HslChannel = (typeof HSL_CHANNELS)[number];

/** Hue centre (degrees) of each HSL mixer band. */
export const HSL_HUES: Record<HslChannel, number> = {
  red: 0,
  orange: 30,
  yellow: 60,
  green: 120,
  aqua: 180,
  blue: 240,
  purple: 275,
  magenta: 315,
};

export type HslTriple = Record<HslChannel, number>; // each -100..100

export interface Adjustments {
  // Basic — white balance
  temperature: number; // -100..100
  tint: number; // -100..100
  // Basic — tone
  exposure: number; // -5..5 (EV)
  contrast: number; // -100..100
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  // Basic — presence
  texture: number;
  clarity: number;
  dehaze: number;
  vibrance: number;
  saturation: number;
  // Parametric tone curve
  parametricShadows: number;
  parametricDarks: number;
  parametricLights: number;
  parametricHighlights: number;
  // Point curves (empty array == identity)
  toneCurve: CurvePoint[];
  toneCurveRed: CurvePoint[];
  toneCurveGreen: CurvePoint[];
  toneCurveBlue: CurvePoint[];
  // HSL
  hslHue: HslTriple;
  hslSaturation: HslTriple;
  hslLuminance: HslTriple;
  // Color grading / split toning
  shadowHue: number; // 0..360
  shadowSaturation: number; // 0..100
  midtoneHue: number;
  midtoneSaturation: number;
  highlightHue: number;
  highlightSaturation: number;
  globalHue: number;
  globalSaturation: number;
  gradingBalance: number; // -100..100
  // Calibration (camera primaries), -100..100
  shadowTint: number; // green (-) .. magenta (+) in the shadows
  calRedHue: number;
  calRedSaturation: number;
  calGreenHue: number;
  calGreenSaturation: number;
  calBlueHue: number;
  calBlueSaturation: number;
  // Detail
  sharpness: number; // 0..150
  // Effects
  vignette: number; // -100..100
  fade: number; // 0..100, matte look: lifted blacks, softened whites
  grain: number; // 0..100
  // B&W
  grayscale: boolean;
}

const zeroHsl = (): HslTriple => ({
  red: 0,
  orange: 0,
  yellow: 0,
  green: 0,
  aqua: 0,
  blue: 0,
  purple: 0,
  magenta: 0,
});

export const DEFAULT_ADJUSTMENTS: Adjustments = {
  temperature: 0,
  tint: 0,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  texture: 0,
  clarity: 0,
  dehaze: 0,
  vibrance: 0,
  saturation: 0,
  parametricShadows: 0,
  parametricDarks: 0,
  parametricLights: 0,
  parametricHighlights: 0,
  toneCurve: [],
  toneCurveRed: [],
  toneCurveGreen: [],
  toneCurveBlue: [],
  hslHue: zeroHsl(),
  hslSaturation: zeroHsl(),
  hslLuminance: zeroHsl(),
  shadowHue: 0,
  shadowSaturation: 0,
  midtoneHue: 0,
  midtoneSaturation: 0,
  highlightHue: 0,
  highlightSaturation: 0,
  globalHue: 0,
  globalSaturation: 0,
  gradingBalance: 0,
  shadowTint: 0,
  calRedHue: 0,
  calRedSaturation: 0,
  calGreenHue: 0,
  calGreenSaturation: 0,
  calBlueHue: 0,
  calBlueSaturation: 0,
  sharpness: 0,
  vignette: 0,
  fade: 0,
  grain: 0,
  grayscale: false,
};

export function createDefaultAdjustments(): Adjustments {
  return structuredClone(DEFAULT_ADJUSTMENTS);
}

/** Numeric slider keys (used for generic slider rendering). */
export type NumericKey = {
  [K in keyof Adjustments]: Adjustments[K] extends number ? K : never;
}[keyof Adjustments];

export interface SliderSpec {
  key: NumericKey;
  label: string;
  min: number;
  max: number;
  step?: number;
}

export const BASIC_WB: SliderSpec[] = [
  { key: "temperature", label: "Temp", min: -100, max: 100 },
  { key: "tint", label: "Tint", min: -100, max: 100 },
];

export const BASIC_TONE: SliderSpec[] = [
  { key: "exposure", label: "Exposure", min: -5, max: 5, step: 0.01 },
  { key: "contrast", label: "Contrast", min: -100, max: 100 },
  { key: "highlights", label: "Highlights", min: -100, max: 100 },
  { key: "shadows", label: "Shadows", min: -100, max: 100 },
  { key: "whites", label: "Whites", min: -100, max: 100 },
  { key: "blacks", label: "Blacks", min: -100, max: 100 },
];

export const BASIC_PRESENCE: SliderSpec[] = [
  { key: "texture", label: "Texture", min: -100, max: 100 },
  { key: "clarity", label: "Clarity", min: -100, max: 100 },
  { key: "dehaze", label: "Dehaze", min: -100, max: 100 },
  { key: "vibrance", label: "Vibrance", min: -100, max: 100 },
  { key: "saturation", label: "Saturation", min: -100, max: 100 },
];

export const PARAMETRIC_CURVE: SliderSpec[] = [
  { key: "parametricHighlights", label: "Highlights", min: -100, max: 100 },
  { key: "parametricLights", label: "Lights", min: -100, max: 100 },
  { key: "parametricDarks", label: "Darks", min: -100, max: 100 },
  { key: "parametricShadows", label: "Shadows", min: -100, max: 100 },
];

export const CALIBRATION_SHADOWS: SliderSpec[] = [
  { key: "shadowTint", label: "Shadow Tint", min: -100, max: 100 },
];
export const CALIBRATION_RED: SliderSpec[] = [
  { key: "calRedHue", label: "Hue", min: -100, max: 100 },
  { key: "calRedSaturation", label: "Saturation", min: -100, max: 100 },
];
export const CALIBRATION_GREEN: SliderSpec[] = [
  { key: "calGreenHue", label: "Hue", min: -100, max: 100 },
  { key: "calGreenSaturation", label: "Saturation", min: -100, max: 100 },
];
export const CALIBRATION_BLUE: SliderSpec[] = [
  { key: "calBlueHue", label: "Hue", min: -100, max: 100 },
  { key: "calBlueSaturation", label: "Saturation", min: -100, max: 100 },
];

export const DETAIL: SliderSpec[] = [
  { key: "sharpness", label: "Sharpening", min: 0, max: 150 },
];

export const EFFECTS: SliderSpec[] = [
  { key: "vignette", label: "Vignette", min: -100, max: 100 },
  { key: "fade", label: "Fade", min: 0, max: 100 },
  { key: "grain", label: "Grain", min: 0, max: 100 },
];

/** Merge a partial preset over a base, deep-merging the HSL triples. */
export function applyPreset(
  base: Adjustments,
  preset: Partial<Adjustments>,
): Adjustments {
  const next: Adjustments = { ...base, ...preset };
  if (preset.hslHue) next.hslHue = { ...base.hslHue, ...preset.hslHue };
  if (preset.hslSaturation)
    next.hslSaturation = { ...base.hslSaturation, ...preset.hslSaturation };
  if (preset.hslLuminance)
    next.hslLuminance = { ...base.hslLuminance, ...preset.hslLuminance };
  return next;
}

/**
 * Valid range of every numeric field. Typed as a full Record so adding a field
 * to `Adjustments` without a range is a compile error.
 */
const NUMERIC_RANGES: Record<NumericKey, readonly [min: number, max: number]> = {
  temperature: [-100, 100],
  tint: [-100, 100],
  exposure: [-5, 5],
  contrast: [-100, 100],
  highlights: [-100, 100],
  shadows: [-100, 100],
  whites: [-100, 100],
  blacks: [-100, 100],
  texture: [-100, 100],
  clarity: [-100, 100],
  dehaze: [-100, 100],
  vibrance: [-100, 100],
  saturation: [-100, 100],
  parametricShadows: [-100, 100],
  parametricDarks: [-100, 100],
  parametricLights: [-100, 100],
  parametricHighlights: [-100, 100],
  shadowHue: [0, 360],
  shadowSaturation: [0, 100],
  midtoneHue: [0, 360],
  midtoneSaturation: [0, 100],
  highlightHue: [0, 360],
  highlightSaturation: [0, 100],
  globalHue: [0, 360],
  globalSaturation: [0, 100],
  gradingBalance: [-100, 100],
  shadowTint: [-100, 100],
  calRedHue: [-100, 100],
  calRedSaturation: [-100, 100],
  calGreenHue: [-100, 100],
  calGreenSaturation: [-100, 100],
  calBlueHue: [-100, 100],
  calBlueSaturation: [-100, 100],
  sharpness: [0, 150],
  vignette: [-100, 100],
  fade: [0, 100],
  grain: [0, 100],
};

/** Hues are angles: out-of-range values wrap instead of clamping. */
const HUE_KEYS: ReadonlySet<NumericKey> = new Set([
  "shadowHue",
  "midtoneHue",
  "highlightHue",
  "globalHue",
]);
const CURVE_KEYS = ["toneCurve", "toneCurveRed", "toneCurveGreen", "toneCurveBlue"] as const;
const HSL_KEYS = ["hslHue", "hslSaturation", "hslLuminance"] as const;

/** Far more than any real point curve needs; the LUT is only 256 entries wide. */
export const MAX_CURVE_POINTS = 64;

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Rebuild a (partial) adjustment set from data we don't control: a parsed
 * .xmp file or whatever is sitting in localStorage. Only known fields with the
 * right type survive, numbers are forced into range and curves are bounded, so
 * nothing malformed can reach React or the shader uniforms.
 */
export function sanitizeAdjustments(input: unknown): Partial<Adjustments> {
  const out: Partial<Adjustments> = {};
  if (!isRecord(input)) return out;

  for (const key of Object.keys(NUMERIC_RANGES) as NumericKey[]) {
    const v = input[key];
    if (!isFiniteNumber(v)) continue;
    const [lo, hi] = NUMERIC_RANGES[key];
    out[key] = HUE_KEYS.has(key) && (v < lo || v > hi) ? ((v % 360) + 360) % 360 : clampTo(v, lo, hi);
  }

  for (const key of CURVE_KEYS) {
    const v = input[key];
    if (!Array.isArray(v)) continue;
    const points: CurvePoint[] = [];
    for (const p of v) {
      if (points.length >= MAX_CURVE_POINTS) break;
      if (Array.isArray(p) && isFiniteNumber(p[0]) && isFiniteNumber(p[1])) {
        points.push([clampTo(p[0], 0, 255), clampTo(p[1], 0, 255)]);
      }
    }
    out[key] = points;
  }

  for (const key of HSL_KEYS) {
    const v = input[key];
    if (!isRecord(v)) continue;
    // Partial on purpose: applyPreset() fills the missing channels from the base.
    const triple: Partial<HslTriple> = {};
    for (const ch of HSL_CHANNELS) {
      const c = v[ch];
      if (isFiniteNumber(c)) triple[ch] = clampTo(c, -100, 100);
    }
    out[key] = triple as HslTriple;
  }

  if (typeof input.grayscale === "boolean") out.grayscale = input.grayscale;
  return out;
}

export function isDefault(adj: Adjustments): boolean {
  return JSON.stringify(adj) === JSON.stringify(DEFAULT_ADJUSTMENTS);
}
