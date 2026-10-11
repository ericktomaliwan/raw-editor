"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Adjustments,
  applyPreset,
  createDefaultAdjustments,
  isDefault,
} from "@/lib/adjustments";
import { collectDroppedFiles, type DroppedFile } from "@/lib/dropFiles";
import {
  isRawFile,
  isXmpFile,
  type LoadedImage,
  loadImageFile,
  RAW_EXTENSIONS,
  stripExtension,
} from "@/lib/image";
import { formatRawMetadata } from "@/lib/raw/decoder";
import { useImportedPresets } from "@/lib/presetStore";
import { MAX_XMP_BYTES, parseXmpPreset, type Preset } from "@/lib/xmp";
import { AdjustmentsPanel } from "./AdjustmentsPanel";
import { DropZone } from "./DropZone";
import { type ExportFormat, HeaderActions, JPEG_QUALITY_DEFAULT } from "./HeaderActions";
import { ImageViewport, type ViewportHandle } from "./ImageViewport";
import { PresetsPanel } from "./PresetsPanel";

export function Editor() {
  const viewportRef = useRef<ViewportHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const builtInJpegNoticeShown = useRef(false);

  const [image, setImage] = useState<LoadedImage | null>(null);
  const [adjustments, setAdjustments] = useState<Adjustments>(createDefaultAdjustments);
  const [importedPresets, persistPresets] = useImportedPresets();
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState<string | null>(null); // status text while decoding
  const [exporting, setExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("image/jpeg");
  const [jpegQuality, setJpegQuality] = useState(JPEG_QUALITY_DEFAULT);
  const [toast, setToast] = useState<{ message: string; kind: "error" | "info" } | null>(null);

  // ----- toast -----
  const notify = useCallback((message: string, kind: "error" | "info" = "error") => {
    setToast({ message, kind });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  // ----- file handling -----
  const openImage = useCallback(
    async (file: File) => {
      const raw = isRawFile(file);
      setLoading(raw ? "Decoding RAW…" : "Loading…");
      try {
        const max = viewportRef.current?.maxTextureSize ?? 4096;
        const loaded = await loadImageFile(file, max, {
          onStatus: raw ? (s) => setLoading(s) : undefined,
        });
        setImage((prev) => {
          prev?.bitmap.close();
          return loaded;
        });
        if (loaded.raw?.preview) {
          notify(
            "Sensor data couldn't be decoded, so the embedded preview is being edited instead.",
            "info",
          );
        } else if (loaded.width !== loaded.sourceWidth) {
          notify(
            `Image downscaled to ${loaded.width}×${loaded.height} to fit this GPU's texture limit.`,
            "info",
          );
        }
      } catch (e) {
        notify(e instanceof Error ? e.message : "Couldn't open that file.");
      } finally {
        setLoading(null);
      }
    },
    [notify],
  );

  const importPresetFiles = useCallback(
    async (files: DroppedFile[]) => {
      const added: Preset[] = [];
      const failed: string[] = [];
      for (const { file, folder } of files) {
        try {
          // Checked before reading so an oversized file is never pulled into memory.
          if (file.size > MAX_XMP_BYTES) throw new Error("Preset file is too large.");
          const text = await file.text();
          // A dropped folder supplies the group when the preset doesn't carry one.
          added.push(parseXmpPreset(text, stripExtension(file.name), folder));
        } catch {
          failed.push(file.name);
        }
      }
      if (added.length) {
        persistPresets((prev) => [...prev, ...added]);
        notify(
          `Imported ${added.length} preset${added.length === 1 ? "" : "s"}${
            added.length === 1 ? `: ${added[0].name}` : ""
          }`,
          "info",
        );
      }
      if (failed.length) {
        // File names are arbitrary and a folder drop can fail in bulk: keep the toast bounded.
        const shown = failed.slice(0, 3).map((n) => (n.length > 60 ? `${n.slice(0, 60)}…` : n));
        const more = failed.length - shown.length;
        notify(
          `Couldn't read ${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""} — not a supported .xmp preset.`,
        );
      }
    },
    [persistPresets, notify],
  );

  const handleFiles = useCallback(
    (dropped: DroppedFile[]) => {
      const xmp = dropped.filter(({ file }) => isXmpFile(file));
      const images = dropped.filter(({ file }) => !isXmpFile(file));
      if (xmp.length) void importPresetFiles(xmp);
      if (images.length) void openImage(images[0].file);
      if (images.length > 1) notify("Only one image at a time — opened the first one.", "info");
    },
    [importPresetFiles, openImage, notify],
  );

  // Window-level drag & drop so a photo can be dropped anywhere.
  //
  // Always cancel the default for dragover/drop: if the browser is allowed to
  // handle a dropped file itself it navigates to it, which for a RAW/DNG means
  // downloading it. `dataTransfer.types` is not reliable mid-drag in every
  // browser, so don't gate preventDefault on it — only gate our own handling.
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
        if (dropped.length) handleFiles(dropped);
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
  }, [handleFiles]);

  // Keyboard: "\" toggles before/after.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (e.key === "\\") {
        e.preventDefault();
        setCompare((c) => !c);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ----- adjustments -----
  const updateAdjustments = (patch: Partial<Adjustments>) => {
    setAdjustments((prev) => ({ ...prev, ...patch }));
    setActivePresetId(null);
  };
  const resetAll = () => {
    setAdjustments(createDefaultAdjustments());
    setActivePresetId(null);
  };
  const applyPresetToImage = (preset: Preset) => {
    // Presets are applied on a clean slate rather than stacked on current edits.
    setAdjustments(applyPreset(createDefaultAdjustments(), preset.adjustments));
    setActivePresetId(preset.id);
  };

  // ----- export -----
  const exportImage = async () => {
    if (!image || !viewportRef.current) return;
    setExporting(true);
    try {
      // The quality field only applies to JPEG; WebP keeps its fixed setting and
      // PNG is lossless (the encoder ignores the value).
      const quality = exportFormat === "image/jpeg" ? jpegQuality / 100 : 0.92;
      const { blob, usedBuiltInJpegEncoder } = await viewportRef.current.exportBlob(
        exportFormat,
        quality,
      );
      // The export still succeeds, just less tightly compressed. Say so once.
      if (usedBuiltInJpegEncoder && !builtInJpegNoticeShown.current) {
        builtInJpegNoticeShown.current = true;
        notify(
          "The optimised JPEG encoder couldn't run here, so the browser's own encoder was used. Files may be larger.",
          "info",
        );
      }
      const ext =exportFormat === "image/png" ? "png" : exportFormat === "image/webp" ? "webp" : "jpg";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${stripExtension(image.name)}-edited.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  const edited = !isDefault(adjustments);

  return (
    <div className="flex h-dvh flex-col bg-zinc-950 text-zinc-200">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-800 px-4">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded bg-zinc-100 text-[11px] font-bold text-zinc-900">
            R
          </span>
          <span className="text-sm font-semibold tracking-tight">RAW Editor</span>
        </div>
        <div className="mx-2 h-5 w-px bg-zinc-800" />
        <div className="min-w-0 flex-1 truncate text-xs text-zinc-400">
          {image ? (
            <>
              <span className="text-zinc-200">{image.name}</span>
              <span className="mx-2 text-zinc-600">·</span>
              {image.sourceWidth} × {image.sourceHeight}
              {image.raw && (
                <>
                  <span className="mx-2 text-zinc-600">·</span>
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-300">
                    {image.raw.preview ? "RAW preview" : "RAW"}
                  </span>
                  {formatRawMetadata(image.raw.metadata) && (
                    <span className="ml-2 hidden text-zinc-500 md:inline">
                      {formatRawMetadata(image.raw.metadata)}
                    </span>
                  )}
                </>
              )}
              {loading && <span className="ml-2 text-zinc-500">{loading}</span>}
            </>
          ) : (
            (loading ?? "No image open")
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept={`image/*,.xmp,${RAW_EXTENSIONS.map((e) => `.${e}`).join(",")}`}
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) handleFiles(files.map((file) => ({ file, path: file.name })));
            e.target.value = "";
          }}
        />
        <HeaderActions
          hasImage={!!image}
          edited={edited}
          compare={compare}
          exporting={exporting}
          exportFormat={exportFormat}
          jpegQuality={jpegQuality}
          onOpen={() => fileInputRef.current?.click()}
          onCompareChange={setCompare}
          onReset={resetAll}
          onFormatChange={setExportFormat}
          onQualityChange={setJpegQuality}
          onExport={exportImage}
        />
      </header>

      {/* Workspace */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]">
        <main className="relative min-h-[50vh] bg-[#111113] p-6 lg:min-h-0">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.03),transparent_70%)]" />
          <ImageViewport
            ref={viewportRef}
            image={image}
            adjustments={adjustments}
            compare={compare}
            onError={notify}
          >
            {!image && !loading && (
              <DropZone active={dragging} onBrowse={() => fileInputRef.current?.click()} />
            )}
            {loading && (
              <div
                className={`pointer-events-none absolute inset-0 flex items-center justify-center ${
                  image ? "bg-zinc-950/40 backdrop-blur-[1px]" : ""
                }`}
                role="status"
                aria-live="polite"
              >
                <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/90 px-5 py-3 text-sm text-zinc-200 shadow-xl">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-200" />
                  <span>{loading}</span>
                </div>
              </div>
            )}
            {image && dragging && !loading && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-sky-500/10 backdrop-blur-[1px]">
                <div className="rounded-xl border-2 border-dashed border-sky-400 bg-zinc-950/80 px-6 py-4 text-sm text-sky-200">
                  Drop to replace the photo (edits are kept)
                </div>
              </div>
            )}
          </ImageViewport>
        </main>

        <aside className="min-h-0 overflow-y-auto border-t border-zinc-800 bg-zinc-950 lg:border-l lg:border-t-0">
          <PresetsPanel
            presets={importedPresets}
            activeId={activePresetId}
            onApply={applyPresetToImage}
            onImportFiles={(files) =>
              void importPresetFiles(files.map((file) => ({ file, path: file.name })))
            }
            onRemove={(id) => persistPresets((prev) => prev.filter((p) => p.id !== id))}
            disabled={!image}
          />
          <AdjustmentsPanel adjustments={adjustments} onChange={updateAdjustments} disabled={!image} />
          <div className="px-4 py-3 text-[11px] leading-relaxed text-zinc-600">
            Double-click any slider to reset it.{" "}
            {/* The compare control differs by layout: a hold button on wide screens,
                a menu entry behind the hamburger on phones. */}
            <span className="hidden md:inline">
              Hold the Before button or press{" "}
              <kbd className="rounded border border-zinc-700 px-1">\</kbd> to compare with the original.
            </span>
            <span className="md:hidden">
              Choose Show original in the menu to compare with the original.
            </span>
          </div>
        </aside>
      </div>

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg border px-4 py-2 text-xs shadow-xl ${
            toast.kind === "error"
              ? "border-red-900/60 bg-red-950/90 text-red-200"
              : "border-zinc-700 bg-zinc-900/95 text-zinc-200"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
