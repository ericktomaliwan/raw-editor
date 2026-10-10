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

export function isDefault(adj: Adjustments): boolean {
  return JSON.stringify(adj) === JSON.stringify(DEFAULT_ADJUSTMENTS);
}
