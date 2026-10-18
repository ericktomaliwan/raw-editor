import { EXPORT_FORMATS, type ExportFormat } from "../exportFormat";
import { stripExtension } from "../image";

/**
 * Name for an exported file: "IMG_1234.dng" -> "IMG_1234-edited.jpg", with the
 * pixel size added when the export was scaled down ("IMG_1234-edited-2048x1365.jpg").
 */
export function exportFileName(
  imageName: string,
  format: ExportFormat,
  scaledTo: { width: number; height: number } | null,
): string {
  const suffix = scaledTo ? `-${scaledTo.width}x${scaledTo.height}` : "";
  return `${stripExtension(imageName)}-edited${suffix}.${EXPORT_FORMATS[format].extension}`;
}

/** Save a blob as a download, the way a link with a `download` attribute does. */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
