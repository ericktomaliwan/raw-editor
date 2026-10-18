import { EXPORT_FORMATS, type ExportFormat } from "../exportFormat";
import type { ExportResult } from "./exportImage";

interface Size {
  width: number;
  height: number;
}

/**
 * Extra time for a smaller export, per megapixel of the *full-size* crop: the
 * source readback plus the Lanczos resize (about 60 ms/MP on its own).
 */
const RESIZE_MS_PER_MEGAPIXEL = 80;
/** Floor for the estimate, so the progress bar is still seen to move on a tiny image. */
const MIN_ESTIMATE_MS = 400;

const megapixels = ({ width, height }: Size) => (width * height) / 1e6;
const isResize = (full: Size, output: Size) =>
  full.width !== output.width || full.height !== output.height;

/**
 * Guesses how long an export will take, to pace the progress bar (which shows
 * an estimate, not real progress: no encoder reports any). It starts from the
 * per-format defaults in EXPORT_FORMATS and learns from every finished export,
 * per format, for the rest of the session.
 */
export class ExportEstimator {
  /** Measured ms per output megapixel of the last export in each format. */
  private rates: Partial<Record<ExportFormat, number>> = {};
  /** Measured ms per full-size megapixel of the last Lanczos resize. */
  private resizeRate: number | null = null;

  /** Expected ms to export a `full`-size crop as `format` at `output` size. */
  estimate(format: ExportFormat, full: Size, output: Size): number {
    const rate = this.rates[format] ?? EXPORT_FORMATS[format].estimateMsPerMegapixel;
    const resize = isResize(full, output)
      ? megapixels(full) * (this.resizeRate ?? RESIZE_MS_PER_MEGAPIXEL)
      : 0;
    return Math.max(MIN_ESTIMATE_MS, megapixels(output) * rate + resize);
  }

  /** Learn from a finished export that took `totalMs` in all. */
  record(
    format: ExportFormat,
    full: Size,
    output: Size,
    totalMs: number,
    result: Pick<ExportResult, "resizeMs" | "usedBuiltInResize">,
  ) {
    this.rates[format] = (totalMs - result.resizeMs) / megapixels(output);
    // A GPU fallback "resize" took no real time, so it says nothing about the next one.
    if (isResize(full, output) && !result.usedBuiltInResize) {
      this.resizeRate = result.resizeMs / megapixels(full);
    }
  }
}
