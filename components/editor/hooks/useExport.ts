import { type RefObject, useRef, useState } from "react";
import type { Adjustments } from "@/lib/adjustments";
import { type CropRect, fullRect } from "@/lib/crop";
import { downloadBlob, exportFileName } from "@/lib/export/download";
import { ExportEstimator } from "@/lib/export/estimate";
import { EXPORT_FORMATS, type ExportFormat, QUALITY_DEFAULT } from "@/lib/exportFormat";
import { exportDimensions, type ExportSize } from "@/lib/exportSize";
import type { LoadedImage } from "@/lib/image";
import type { ViewportHandle } from "../ImageViewport";
import type { Notify } from "./useToast";

/**
 * The export settings (format, quality, size: UI state, not part of the
 * undoable edit) and running an export: the progress estimate, the one-time
 * notices when a fallback was used, and the download.
 */
export function useExport({
  viewportRef,
  image,
  adjustments,
  crop,
  notify,
}: {
  viewportRef: RefObject<ViewportHandle | null>;
  image: LoadedImage | null;
  adjustments: Adjustments;
  /** In image pixels; null = the whole image. */
  crop: CropRect | null;
  notify: Notify;
}) {
  const [format, setFormat] = useState<ExportFormat>("image/jpeg");
  const [quality, setQuality] = useState(QUALITY_DEFAULT);
  const [size, setSize] = useState<ExportSize>(null);
  /** Expected duration (ms) of the export in progress, which paces the progress bar; null when idle. */
  const [estimateMs, setEstimateMs] = useState<number | null>(null);
  /** Created on first export, kept for the session (it learns from each export). */
  const estimator = useRef<ExportEstimator | null>(null);
  /** Each fallback notice is shown once per session: the export still works. */
  const noticesShown = useRef({ encoder: false, resize: false });

  const runExport = async () => {
    const viewport = viewportRef.current;
    if (!image || !viewport) return;
    const area = crop ?? fullRect(image.width, image.height);
    const output = exportDimensions(area.width, area.height, size);
    const scaled = output.width !== area.width || output.height !== area.height;
    const timer = (estimator.current ??= new ExportEstimator());
    setEstimateMs(timer.estimate(format, area, output));
    const started = performance.now();
    try {
      const result = await viewport.exportImage({
        adjustments,
        crop: area,
        format,
        // PNG is lossless; its encoder ignores the value.
        quality: EXPORT_FORMATS[format].hasQuality ? quality : 100,
        longEdge: size,
      });
      timer.record(format, area, output, performance.now() - started, result);
      if (result.usedBuiltInResize && !noticesShown.current.resize) {
        noticesShown.current.resize = true;
        notify(
          "The high-quality resizer couldn't run here, so the photo was scaled the way the preview is. It may look a little softer.",
          "info",
        );
      }
      if (result.usedBuiltInEncoder && !noticesShown.current.encoder) {
        noticesShown.current.encoder = true;
        notify(
          `The optimised ${EXPORT_FORMATS[format].label} encoder couldn't run here, so the browser's own encoder was used. Files may be larger.`,
          "info",
        );
      }
      downloadBlob(result.blob, exportFileName(image.name, format, scaled ? output : null));
    } catch (e) {
      notify(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setEstimateMs(null);
    }
  };

  return {
    format,
    setFormat,
    quality,
    setQuality,
    size,
    setSize,
    estimateMs,
    exporting: estimateMs !== null,
    runExport,
  };
}
