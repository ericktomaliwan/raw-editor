/**
 * The export formats, and everything the rest of the app needs to know about
 * each one. Add a format here first; the header's menus, the file name, the
 * progress estimate and the quality field all read from this table.
 */
export type ExportFormat = "image/jpeg" | "image/png" | "image/webp";

export interface ExportFormatInfo {
  /** Shown in the format menus and in messages. */
  label: string;
  /** File extension of the saved file, without the dot. */
  extension: string;
  /** Whether the quality setting applies. PNG is lossless, so it doesn't. */
  hasQuality: boolean;
  /**
   * Rough export time in milliseconds per output megapixel on a fast laptop.
   * It only paces the progress bar, and only until this session has timed a
   * real export in that format (see lib/export/estimate.ts). PNG is the slow
   * one: its encoder searches for the smallest file. WebP's encode is about
   * 115 ms per megapixel on its own.
   */
  estimateMsPerMegapixel: number;
}

export const EXPORT_FORMATS: Record<ExportFormat, ExportFormatInfo> = {
  "image/jpeg": { label: "JPEG", extension: "jpg", hasQuality: true, estimateMsPerMegapixel: 150 },
  "image/png": { label: "PNG", extension: "png", hasQuality: false, estimateMsPerMegapixel: 800 },
  "image/webp": { label: "WebP", extension: "webp", hasQuality: true, estimateMsPerMegapixel: 200 },
};

/** The formats in the order the menus list them. */
export const EXPORT_FORMAT_ORDER: readonly ExportFormat[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

/** Export quality for the formats that have one, as the familiar 1–100 scale. Lower = smaller file. */
export const QUALITY_MIN = 1;
export const QUALITY_MAX = 100;
export const QUALITY_DEFAULT = 92;
