/**
 * Layers: local adjustments. Each layer is a mask (where) plus its own small
 * set of settings (what). On every pixel the shader adds each layer's
 * settings, weighted by its mask, to the global value of the same setting.
 * Layers add up, so their order never changes the result.
 *
 * Geometry is stored independently of resolution:
 * - positions are image uv, 0..1 across the image's width and height;
 * - lengths (radii, brush size) are fractions of the image's long edge, so a
 *   circle stays round on a non-square photo.
 */

import type { CropRect } from "./crop";

/** Most layers a photo can have: one shader slot and one brush slice each. */
export const MAX_LAYERS = 8;

/**
 * The settings a layer can change: Lightroom's local set. Names and ranges match
 * the global fields in adjustments.ts, except sharpness, which goes negative
 * (it softens) and the colour tint, which is local only.
 */
export interface LocalAdjustments {
  temperature: number; // -100..100
  tint: number; // -100..100
  exposure: number; // -5..5 (EV)
  contrast: number; // -100..100
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  texture: number;
  clarity: number;
  dehaze: number;
  saturation: number;
  sharpness: number; // -100..100: below 0 removes sharpening, then softens
  colorHue: number; // 0..360
  colorSaturation: number; // 0..100
}

export type LocalKey = keyof LocalAdjustments;

export const DEFAULT_LOCAL: LocalAdjustments = {
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
  saturation: 0,
  sharpness: 0,
  colorHue: 0,
  colorSaturation: 0,
};

export interface LocalSliderSpec {
  key: LocalKey;
  label: string;
  min: number;
  max: number;
  step?: number;
}

export const LOCAL_WB: LocalSliderSpec[] = [
  { key: "temperature", label: "Temp", min: -100, max: 100 },
  { key: "tint", label: "Tint", min: -100, max: 100 },
];
export const LOCAL_TONE: LocalSliderSpec[] = [
  { key: "exposure", label: "Exposure", min: -5, max: 5, step: 0.01 },
  { key: "contrast", label: "Contrast", min: -100, max: 100 },
  { key: "highlights", label: "Highlights", min: -100, max: 100 },
  { key: "shadows", label: "Shadows", min: -100, max: 100 },
  { key: "whites", label: "Whites", min: -100, max: 100 },
  { key: "blacks", label: "Blacks", min: -100, max: 100 },
];
export const LOCAL_PRESENCE: LocalSliderSpec[] = [
  { key: "texture", label: "Texture", min: -100, max: 100 },
  { key: "clarity", label: "Clarity", min: -100, max: 100 },
  { key: "dehaze", label: "Dehaze", min: -100, max: 100 },
  { key: "saturation", label: "Saturation", min: -100, max: 100 },
  { key: "sharpness", label: "Sharpness", min: -100, max: 100 },
];
export const LOCAL_COLOR: LocalSliderSpec[] = [
  { key: "colorHue", label: "Color Hue", min: 0, max: 360 },
  { key: "colorSaturation", label: "Color Strength", min: 0, max: 100 },
];

// ---------- masks ----------

/** Full effect on the (x0, y0) side, fading to none at (x1, y1). Points in uv. */
export interface LinearMask {
  type: "linear";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** An ellipse: full effect inside, fading out over `feather` towards its edge. */
export interface RadialMask {
  type: "radial";
  /** Centre, in uv. */
  cx: number;
  cy: number;
  /** Semi-axes, as fractions of the long edge, before rotation. */
  rx: number;
  ry: number;
  /** Rotation in radians, clockwise on screen. */
  angle: number;
  feather: number; // 0..100
  invert: boolean;
}

/** Nothing until painted: the brush strokes are the whole mask. */
export interface BrushMask {
  type: "brush";
}

/** The whole photo, narrowed only by the layer's luminance and colour ranges. */
export interface RangeMask {
  type: "range";
}

export type MaskShape = LinearMask | RadialMask | BrushMask | RangeMask;
export type MaskType = MaskShape["type"];

export interface LuminanceRange {
  lo: number; // 0..100
  hi: number; // 0..100
  feather: number; // 0..100
}

export interface ColorRange {
  hue: number; // 0..360
  width: number; // 0..100
}

export interface BrushStroke {
  /** Erasing strokes take the mask away, from the shape as well as from painting. */
  erase: boolean;
  /** Radius, as a fraction of the long edge. */
  size: number;
  feather: number; // 0..100
  flow: number; // 1..100
  /** u0, v0, u1, v1, … in uv. */
  points: number[];
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  /** How strongly the layer's settings apply, 0..100. */
  amount: number;
  mask: MaskShape;
  /** Painting on top of the shape. Shared by reference between undo steps. */
  strokes: BrushStroke[];
  /** Limits the layer to a band of brightness in the original photo, or null. */
  luminance: LuminanceRange | null;
  /** Limits the layer to a range of hues in the original photo, or null. */
  color: ColorRange | null;
  adjustments: LocalAdjustments;
}

/** What the "Add layer" buttons offer. Two of them start as range-only layers. */
export type LayerKind = "linear" | "radial" | "brush" | "luminance" | "color";

export const LAYER_KINDS: { kind: LayerKind; label: string }[] = [
  { kind: "linear", label: "Linear" },
  { kind: "radial", label: "Radial" },
  { kind: "brush", label: "Brush" },
  { kind: "luminance", label: "Luminance" },
  { kind: "color", label: "Color" },
];

const KIND_NAMES: Record<LayerKind, string> = {
  linear: "Linear gradient",
  radial: "Radial gradient",
  brush: "Brush",
  luminance: "Luminance range",
  color: "Color range",
};

export const DEFAULT_LUMINANCE: LuminanceRange = { lo: 60, hi: 100, feather: 20 };
export const DEFAULT_COLOR: ColorRange = { hue: 210, width: 40 };
export const DEFAULT_RADIAL_FEATHER = 50;

/** Next free "<kind name> n", counting up from 1. */
export function nextLayerName(kind: LayerKind, layers: readonly Layer[]): string {
  const base = KIND_NAMES[kind];
  const used = new Set(layers.map((l) => l.name));
  let n = 1;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export function newLayerId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `layer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * A new layer, placed on the part of the photo in view (`view`, in image
 * pixels): a linear gradient over the top half of the view (a sky), starting
 * a little way in so its handle isn't on the edge (above the start is full
 * effect anyway); a radial gradient in the middle of the view.
 */
export function createLayer(
  kind: LayerKind,
  {
    id,
    name,
    view,
    imageWidth,
    imageHeight,
  }: { id: string; name: string; view: CropRect; imageWidth: number; imageHeight: number },
): Layer {
  const long = Math.max(imageWidth, imageHeight);
  const cx = (view.x + view.width / 2) / imageWidth;
  const cy = (view.y + view.height / 2) / imageHeight;
  let mask: MaskShape;
  switch (kind) {
    case "linear":
      mask = {
        type: "linear",
        x0: cx,
        y0: (view.y + view.height * 0.1) / imageHeight,
        x1: cx,
        y1: cy,
      };
      break;
    case "radial":
      mask = {
        type: "radial",
        cx,
        cy,
        rx: (view.width * 0.3) / long,
        ry: (view.height * 0.3) / long,
        angle: 0,
        feather: DEFAULT_RADIAL_FEATHER,
        invert: false,
      };
      break;
    case "brush":
      mask = { type: "brush" };
      break;
    case "luminance":
    case "color":
      mask = { type: "range" };
      break;
  }
  return {
    id,
    name,
    visible: true,
    amount: 100,
    mask,
    strokes: [],
    luminance: kind === "luminance" ? { ...DEFAULT_LUMINANCE } : null,
    color: kind === "color" ? { ...DEFAULT_COLOR } : null,
    adjustments: { ...DEFAULT_LOCAL },
  };
}

export function isLocalDefault(adj: LocalAdjustments): boolean {
  return (Object.keys(DEFAULT_LOCAL) as LocalKey[]).every((k) => adj[k] === DEFAULT_LOCAL[k]);
}

// ---------- shader uniforms ----------

/** Shader codes for each mask type (u_maskB.x). */
export const MASK_CODE: Record<MaskType, number> = { range: 0, linear: 1, radial: 2, brush: 3 };

export interface LayerUniforms {
  count: number;
  /** Mask geometry in long-edge units (linear: start, end; radial: centre, semi-axes). */
  maskA: Float32Array;
  /** (type code, angle, feather 0..1, invert 0/1). */
  maskB: Float32Array;
  /** Luminance range: (lo, hi, feather, on), 0..1. */
  rangeL: Float32Array;
  /** Colour range: (hue 0..1, width as hue distance, on, has brush strokes). */
  rangeC: Float32Array;
  /** Settings, scaled by the layer's amount (and zero while it's hidden). */
  localA: Float32Array; // temperature, tint, exposure (EV), contrast
  localB: Float32Array; // highlights, shadows, whites, blacks
  localC: Float32Array; // texture, clarity, dehaze, saturation
  localD: Float32Array; // sharpness, colour hue 0..1, colour saturation, 0
}

/** Hue distance (0..0.5 of the hue circle) at which a colour range has faded out. */
export function colorRangeWidth(width: number): number {
  return 0.03 + 0.27 * (width / 100);
}

/**
 * Pack layers into the shader's uniform arrays, one vec4 per layer per array,
 * in the layers' own order: layer i is shader slot i, and brush slice i.
 * Hidden layers keep their slot (their mask can still be shown) but apply nothing.
 */
export function packLayerUniforms(
  layers: readonly Layer[],
  imageWidth: number,
  imageHeight: number,
): LayerUniforms {
  const size = MAX_LAYERS * 4;
  const out: LayerUniforms = {
    count: Math.min(layers.length, MAX_LAYERS),
    maskA: new Float32Array(size),
    maskB: new Float32Array(size),
    rangeL: new Float32Array(size),
    rangeC: new Float32Array(size),
    localA: new Float32Array(size),
    localB: new Float32Array(size),
    localC: new Float32Array(size),
    localD: new Float32Array(size),
  };
  const long = Math.max(imageWidth, imageHeight, 1);
  const sx = imageWidth / long;
  const sy = imageHeight / long;
  const set = (arr: Float32Array, i: number, a: number, b: number, c: number, d: number) => {
    arr[i * 4] = a;
    arr[i * 4 + 1] = b;
    arr[i * 4 + 2] = c;
    arr[i * 4 + 3] = d;
  };

  for (let i = 0; i < out.count; i++) {
    const layer = layers[i];
    const m = layer.mask;
    if (m.type === "linear") {
      set(out.maskA, i, m.x0 * sx, m.y0 * sy, m.x1 * sx, m.y1 * sy);
      set(out.maskB, i, MASK_CODE.linear, 0, 0, 0);
    } else if (m.type === "radial") {
      set(out.maskA, i, m.cx * sx, m.cy * sy, m.rx, m.ry);
      set(out.maskB, i, MASK_CODE.radial, m.angle, m.feather / 100, m.invert ? 1 : 0);
    } else {
      set(out.maskB, i, MASK_CODE[m.type], 0, 0, 0);
    }
    const lum = layer.luminance;
    if (lum) {
      set(
        out.rangeL,
        i,
        Math.min(lum.lo, lum.hi) / 100,
        Math.max(lum.lo, lum.hi) / 100,
        lum.feather / 100,
        1,
      );
    }
    const col = layer.color;
    set(
      out.rangeC,
      i,
      col ? (((col.hue % 360) + 360) % 360) / 360 : 0,
      col ? colorRangeWidth(col.width) : 0,
      col ? 1 : 0,
      layer.strokes.length > 0 ? 1 : 0,
    );

    const k = layer.visible ? layer.amount / 100 : 0;
    const a = layer.adjustments;
    const n = (v: number) => (v / 100) * k;
    set(out.localA, i, n(a.temperature), n(a.tint), a.exposure * k, n(a.contrast));
    set(out.localB, i, n(a.highlights), n(a.shadows), n(a.whites), n(a.blacks));
    set(out.localC, i, n(a.texture), n(a.clarity), n(a.dehaze), n(a.saturation));
    set(
      out.localD,
      i,
      n(a.sharpness),
      (((a.colorHue % 360) + 360) % 360) / 360,
      n(a.colorSaturation),
      0,
    );
  }
  return out;
}

/**
 * The hue (0..360) a colour range should select for a picked colour (0..255
 * RGB), or null when the colour is too grey to have a meaningful hue.
 */
export function pickedHue(r: number, g: number, b: number): number | null {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  // Same test as the shader's: below this saturation a pixel is never selected.
  if (max === 0 || chroma / max < 0.08) return null;
  let h: number;
  if (max === r) h = ((g - b) / chroma) % 6;
  else if (max === g) h = (b - r) / chroma + 2;
  else h = (r - g) / chroma + 4;
  return Math.round((((h * 60) % 360) + 360) % 360);
}
