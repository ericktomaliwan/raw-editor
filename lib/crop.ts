/**
 * Crop geometry. Pure functions, no DOM, so the rules can be reasoned about
 * (and tested) apart from the pointer handling in CropOverlay.
 *
 * A crop is a rectangle in whole pixels of the working image (LoadedImage
 * width/height), which is exactly what the export produces. Keeping it in
 * pixels, not fractions, means the size shown while dragging is the size of
 * the file you get.
 */

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Which part of the crop box a drag grabbed. */
export type CropHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "move";

/** Smallest crop, in image pixels (smaller images clamp to their own size). */
const MIN_SIZE = 16;

export function fullRect(imageWidth: number, imageHeight: number): CropRect {
  return { x: 0, y: 0, width: imageWidth, height: imageHeight };
}

export function isFullRect(r: CropRect, imageWidth: number, imageHeight: number): boolean {
  return r.x === 0 && r.y === 0 && r.width === imageWidth && r.height === imageHeight;
}

// ---------- aspect ratio presets ----------

export interface AspectPreset {
  id: string;
  /** Shown instead of the "w:h" label, e.g. "Square". */
  name?: string;
  /** Landscape form; `null` for the two special entries. */
  ratio: { w: number; h: number } | null;
}

/** "free" = no constraint; "original" = the photo's own proportions. */
export const ASPECT_PRESETS: AspectPreset[] = [
  { id: "free", name: "Free", ratio: null },
  { id: "original", name: "Original", ratio: null },
  { id: "1:1", name: "Square", ratio: { w: 1, h: 1 } },
  { id: "5:4", ratio: { w: 5, h: 4 } },
  { id: "4:3", ratio: { w: 4, h: 3 } },
  { id: "3:2", ratio: { w: 3, h: 2 } },
  { id: "16:9", ratio: { w: 16, h: 9 } },
];

export interface AspectChoice {
  id: string;
  /** Use the preset turned on its side (16:9 becomes 9:16). */
  portrait: boolean;
}

export const FREE_ASPECT: AspectChoice = { id: "free", portrait: false };

/** Whether turning it on its side means anything (not for Free, Original or Square). */
export function canRotateAspect(preset: AspectPreset): boolean {
  return preset.ratio !== null && preset.ratio.w !== preset.ratio.h;
}

export function aspectLabel(preset: AspectPreset, portrait: boolean): string {
  if (preset.name) return preset.name;
  const { w, h } = preset.ratio!;
  return portrait ? `${h}:${w}` : `${w}:${h}`;
}

/** Width / height to hold while resizing, or null for a free crop. */
export function resolveAspect(
  choice: AspectChoice,
  imageWidth: number,
  imageHeight: number,
): number | null {
  const preset = ASPECT_PRESETS.find((p) => p.id === choice.id);
  if (!preset || preset.id === "free") return null;
  if (preset.id === "original") return imageWidth / imageHeight;
  const { w, h } = preset.ratio!;
  return choice.portrait && canRotateAspect(preset) ? h / w : w / h;
}

// ---------- geometry ----------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Round a width to whole pixels and derive the matching height for `ratio`,
 * never exceeding the space available in either direction.
 */
function sizeForRatio(width: number, ratio: number, maxWidth: number, maxHeight: number) {
  let w = Math.min(width, maxWidth, maxHeight * ratio);
  w = Math.max(1, Math.round(w));
  let h = Math.max(1, Math.round(w / ratio));
  if (h > maxHeight) {
    h = Math.max(1, Math.floor(maxHeight));
    w = Math.max(1, Math.min(Math.round(h * ratio), Math.floor(maxWidth)));
  }
  if (w > maxWidth) w = Math.max(1, Math.floor(maxWidth));
  return { w, h };
}

/**
 * Reshape a crop to an aspect ratio. Keeps its centre and its width where
 * possible, shrinking only as far as the image bounds require (and growing a
 * sliver of a crop up to the minimum size). Starting from the full image this
 * gives the largest centred crop of that shape.
 */
export function applyAspect(
  rect: CropRect,
  ratio: number,
  imageWidth: number,
  imageHeight: number,
): CropRect {
  const minWidth = Math.max(
    Math.min(MIN_SIZE, imageWidth),
    Math.min(MIN_SIZE, imageHeight) * ratio,
  );
  const { w, h } = sizeForRatio(Math.max(rect.width, minWidth), ratio, imageWidth, imageHeight);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return {
    x: clamp(Math.round(cx - w / 2), 0, imageWidth - w),
    y: clamp(Math.round(cy - h / 2), 0, imageHeight - h),
    width: w,
    height: h,
  };
}

/** Slide the crop without changing its size; it stops at the image edges. */
export function moveRect(
  start: CropRect,
  dx: number,
  dy: number,
  imageWidth: number,
  imageHeight: number,
): CropRect {
  return {
    ...start,
    x: clamp(Math.round(start.x + dx), 0, imageWidth - start.width),
    y: clamp(Math.round(start.y + dy), 0, imageHeight - start.height),
  };
}

/**
 * Resize by dragging a corner or an edge. `dx`/`dy` are how far the pointer
 * has moved since the drag began, in image pixels, and `start` is the crop at
 * that moment (so the result never drifts from accumulated rounding).
 *
 * The side opposite the handle stays put. With a ratio, a corner follows
 * whichever axis the pointer has pulled further, and an edge grows the other
 * dimension equally on both sides. The crop never leaves the image, never
 * flips inside out, and never drops below a minimum size.
 */
export function resizeRect(
  start: CropRect,
  handle: Exclude<CropHandle, "move">,
  dx: number,
  dy: number,
  ratio: number | null,
  imageWidth: number,
  imageHeight: number,
): CropRect {
  const minW = Math.min(MIN_SIZE, imageWidth);
  const minH = Math.min(MIN_SIZE, imageHeight);
  const east = handle.includes("e");
  const west = handle.includes("w");
  const north = handle.includes("n");
  const south = handle.includes("s");
  const left = start.x;
  const right = start.x + start.width;
  const top = start.y;
  const bottom = start.y + start.height;

  if (ratio === null) {
    const l = west ? clamp(Math.round(left + dx), 0, right - minW) : left;
    const r = east ? clamp(Math.round(right + dx), left + minW, imageWidth) : right;
    const t = north ? clamp(Math.round(top + dy), 0, bottom - minH) : top;
    const b = south ? clamp(Math.round(bottom + dy), top + minH, imageHeight) : bottom;
    return { x: l, y: t, width: r - l, height: b - t };
  }

  // Smallest width that keeps both dimensions at or above the minimum.
  const minWidth = Math.max(minW, minH * ratio);
  const horizontal = east || west;
  const vertical = north || south;

  if (horizontal && vertical) {
    // Corner: the opposite corner is the anchor.
    const ax = east ? left : right;
    const ay = south ? top : bottom;
    const wantW = east ? right + dx - ax : ax - (left + dx);
    const wantH = south ? bottom + dy - ay : ay - (top + dy);
    const availW = east ? imageWidth - ax : ax;
    const availH = south ? imageHeight - ay : ay;
    const { w, h } = sizeForRatio(Math.max(wantW, wantH * ratio, minWidth), ratio, availW, availH);
    return { x: east ? ax : ax - w, y: south ? ay : ay - h, width: w, height: h };
  }

  if (horizontal) {
    // Left or right edge: height follows, centred on the crop's middle row.
    const ax = east ? left : right;
    const cy = top + start.height / 2;
    const wantW = east ? right + dx - ax : ax - (left + dx);
    const availW = east ? imageWidth - ax : ax;
    const availH = 2 * Math.min(cy, imageHeight - cy);
    const { w, h } = sizeForRatio(Math.max(wantW, minWidth), ratio, availW, availH);
    return {
      x: east ? ax : ax - w,
      y: clamp(Math.round(cy - h / 2), 0, imageHeight - h),
      width: w,
      height: h,
    };
  }

  // Top or bottom edge: width follows, centred on the crop's middle column.
  const ay = south ? top : bottom;
  const cx = left + start.width / 2;
  const wantH = south ? bottom + dy - ay : ay - (top + dy);
  const availH = south ? imageHeight - ay : ay;
  const availW = 2 * Math.min(cx, imageWidth - cx);
  const { w, h } = sizeForRatio(Math.max(wantH * ratio, minWidth), ratio, availW, availH);
  return {
    x: clamp(Math.round(cx - w / 2), 0, imageWidth - w),
    y: south ? ay : ay - h,
    width: w,
    height: h,
  };
}
