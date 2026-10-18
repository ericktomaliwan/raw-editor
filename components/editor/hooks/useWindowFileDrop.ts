import { useEffect, useState } from "react";
import { collectDroppedFiles, type DroppedFile } from "@/lib/dropFiles";

/**
 * Window-level drag & drop, so a photo or preset can be dropped anywhere.
 * Returns whether files are being dragged over the window.
 *
 * Always cancels the default for dragover/drop: if the browser is allowed to
 * handle a dropped file itself it navigates to it, which for a RAW/DNG means
 * downloading it. `dataTransfer.types` is not reliable mid-drag in every
 * browser, so preventDefault is never gated on it; only our own handling is.
 * (app/layout.tsx has an inline script doing the same before hydration.)
 */
export function useWindowFileDrop(onFiles: (files: DroppedFile[]) => void): boolean {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => {
      const types = e.dataTransfer?.types;
      return !!types && (Array.from(types).includes("Files") || types.length === 0);
    };
    const onEnter = (e: DragEvent) => {
      e.preventDefault();
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = hasFiles(e) ? "copy" : "none";
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const dt = e.dataTransfer;
      if (!dt) return;
      // Collect synchronously: entries are only readable during the event.
      void collectDroppedFiles(dt).then((dropped) => {
        if (dropped.length) onFiles(dropped);
      });
    };
    // Capture phase so nothing deeper in the tree can swallow the events.
    window.addEventListener("dragenter", onEnter, true);
    window.addEventListener("dragover", onOver, true);
    window.addEventListener("dragleave", onLeave, true);
    window.addEventListener("drop", onDrop, true);
    return () => {
      window.removeEventListener("dragenter", onEnter, true);
      window.removeEventListener("dragover", onOver, true);
      window.removeEventListener("dragleave", onLeave, true);
      window.removeEventListener("drop", onDrop, true);
    };
  }, [onFiles]);

  return dragging;
}
