import type { Adjustments } from "../adjustments";
import type { CropRect } from "../crop";
import type { ExportFormat } from "../exportFormat";
import { exportDimensions, type ExportSize } from "../exportSize";
import { encodeJpeg } from "../jpeg/encoder";
import { encodePng } from "../png/encoder";
import { resizePixels } from "../resize/resizer";
import { encodeWebp, WEBP_MAX_DIMENSION } from "../webp/encoder";
import type { Renderer } from "../webgl/renderer";
import type { RawPixels } from "../workers/pixelWorker";

export interface ExportRequest {
  adjustments: Adjustments;
  /** The part of the image to export, in image pixels (the whole image when uncropped). */
  crop: CropRect;
  format: ExportFormat;
  /** 1–100. Ignored by PNG. */
  quality: number;
  /** Cap on the saved file's long edge, or null for full size. Never enlarges. */
  longEdge: ExportSize;
}

export interface ExportResult {
  blob: Blob;
  /**
   * True when the file had to be written by the browser's built-in encoder
   * because ours (MozJPEG, OxiPNG, libwebp) couldn't run.
   */
  usedBuiltInEncoder: boolean;
  /**
   * True when a smaller export had to be scaled by the GPU (as the preview
   * is) because the Lanczos resizer couldn't run.
   */
  usedBuiltInResize: boolean;
  /** Time spent reading back and resizing the source, in ms (0 at full size). */
  resizeMs: number;
}

/** Our own encoders, each in its own worker. `quality` is 1–100. */
const ENCODERS: Record<
  ExportFormat,
  { name: string; encode: (pixels: RawPixels, quality: number) => Promise<Blob> }
> = {
  "image/jpeg": { name: "MozJPEG", encode: encodeJpeg },
  "image/png": { name: "OxiPNG", encode: (pixels) => encodePng(pixels) },
  "image/webp": { name: "libwebp", encode: encodeWebp },
};

/**
 * Render the edit of `request.crop` and encode it, at full resolution or with
 * its long edge scaled down. JPEGs go through MozJPEG, PNGs through OxiPNG and
 * WebPs through libwebp, with the browser's encoder (`canvas.toBlob`) as the
 * fallback for all three.
 *
 * The export borrows the renderer's canvas. `redrawDisplay` must put the
 * on-screen picture back; it is called right after each export render, before
 * any await, so no frame ever shows the export.
 */
export async function exportImage(
  renderer: Renderer,
  request: ExportRequest,
  redrawDisplay: () => void,
): Promise<ExportResult> {
  const { adjustments, crop, format, quality, longEdge } = request;
  const size = exportDimensions(crop.width, crop.height, longEdge);
  const resizing = size.width !== crop.width || size.height !== crop.height;
  if (
    format === "image/webp" &&
    (size.width > WEBP_MAX_DIMENSION || size.height > WEBP_MAX_DIMENSION)
  ) {
    throw new Error(
      `WebP images can be at most ${WEBP_MAX_DIMENSION} pixels on a side. Choose a smaller export size or export as JPEG or PNG.`,
    );
  }
  const readPixels = () => {
    try {
      return renderer.readPixels();
    } catch {
      return null; // e.g. not enough memory for the readback buffer
    }
  };

  // A smaller export first resamples the *unedited* crop to the output size
  // with Lanczos (in a worker), then runs the edit on that 1:1. Resampling the
  // finished picture instead would average away sharpening and grain, which
  // are sized in output pixels, and the file would no longer look like the
  // preview.
  let source: RawPixels | null = null;
  let usedBuiltInResize = false;
  let resizeMs = 0;
  if (resizing) {
    const started = performance.now();
    renderer.render(adjustments, {
      width: crop.width,
      height: crop.height,
      view: crop,
      crop,
      bypass: true,
    });
    const original = readPixels();
    redrawDisplay();
    if (original) {
      try {
        source = await resizePixels({ ...original, flipY: true }, size.width, size.height);
      } catch (e) {
        console.warn("[export] Lanczos resize unavailable, using the GPU's downscaling:", e);
      }
    }
    usedBuiltInResize = source === null;
    resizeMs = performance.now() - started;
  }

  /** Render the export picture into the canvas, then run `then` before anything redraws it. */
  const drawExport = <T>(then: () => T): T => {
    if (source) {
      return renderer.withSource(source, () => {
        renderer.render(adjustments, size);
        return then();
      });
    }
    // Without a resampled source the GPU scales the crop itself, as for the
    // preview: softer, but the same picture.
    renderer.render(adjustments, { ...size, view: crop, crop });
    return then();
  };

  // Read the render back and hand it to our encoder in its worker. The display
  // is redrawn first: the pixels are already copied.
  const encoder = ENCODERS[format];
  let blob: Blob | null = null;
  const pixels = drawExport(readPixels);
  redrawDisplay();
  if (pixels) {
    try {
      blob = await encoder.encode({ ...pixels, flipY: true }, quality);
    } catch (e) {
      console.warn(`[export] ${encoder.name} unavailable, using the browser's encoder:`, e);
    }
  }
  const usedBuiltInEncoder = blob === null;

  if (!blob) {
    // toBlob snapshots the canvas when called, so render right before it.
    const canvas = renderer.canvas;
    const result = drawExport(
      () => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, format, quality / 100)),
    );
    redrawDisplay();
    blob = await result;
  }
  if (!blob) throw new Error("Export failed — the image may be too large for this browser.");
  // A browser that can't write the format returns a PNG instead (Safari does
  // this for WebP). Don't save that under the wrong extension.
  if (blob.type !== format) {
    throw new Error("This browser can't write that format. Try exporting as JPEG or PNG.");
  }
  return { blob, usedBuiltInEncoder, usedBuiltInResize, resizeMs };
}
