/**
 * Export size: the long edge of the saved file, in pixels, or null for the
 * photo's (or crop's) own size. Exports are only ever made smaller.
 */
export type ExportSize = number | null;

/** Long-edge choices offered next to "Full size", largest first. */
export const EXPORT_SIZES = [3840, 2560, 2048, 1600, 1080] as const;

/**
 * Pixel size of an export of a `width` x `height` picture with its long edge
 * capped at `longEdge`. Aspect ratio is kept; nothing is enlarged.
 */
export function exportDimensions(
  width: number,
  height: number,
  longEdge: ExportSize,
): { width: number; height: number } {
  const largest = Math.max(width, height);
  if (longEdge === null || longEdge >= largest) return { width, height };
  const scale = longEdge / largest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
