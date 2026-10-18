"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Adjustments,
  applyPreset,
  createDefaultAdjustments,
  isDefault,
} from "@/lib/adjustments";
import {
  applyAspect,
  type AspectChoice,
  type CropRect,
  FREE_ASPECT,
  fullRect,
  isFullRect,
  resolveAspect,
} from "@/lib/crop";
import { collectDroppedFiles, type DroppedFile } from "@/lib/dropFiles";
import { exportDimensions, type ExportSize } from "@/lib/exportSize";
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
import { BUILTIN_PRESETS } from "@/lib/presets";
import { useEditHistory } from "@/lib/useEditHistory";
import { MAX_XMP_BYTES, parseXmpPreset, type Preset } from "@/lib/xmp";
import { AdjustmentsPanel } from "./AdjustmentsPanel";
import { CropPanel } from "./CropPanel";
import { DropZone } from "./DropZone";
import { ExportProgress } from "./ExportProgress";
import { type ExportFormat, HeaderActions, hasQuality, QUALITY_DEFAULT } from "./HeaderActions";
import { ImageViewport, type ViewportHandle } from "./ImageViewport";
import { PresetsPanel } from "./PresetsPanel";

/** Input types that hold no text, so Cmd/Ctrl+Z on them can mean "undo the edit". */
const NON_TEXT_INPUTS = new Set([
  "range",
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "file",
  "color",
]);

/**
 * Rough export time in milliseconds per megapixel on a fast laptop. It only
 * paces the progress bar, and only until this session has timed a real export
 * in that format. PNG is the slow one: its encoder searches for the smallest
 * file. WebP's encode is about 115 ms per megapixel on its own.
 */
const EXPORT_MS_PER_MEGAPIXEL: Record<ExportFormat, number> = {
  "image/jpeg": 150,
  "image/png": 800,
  "image/webp": 200,
};

const FORMAT_LABELS: Record<ExportFormat, string> = {
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/webp": "WebP",
};
/**
 * Extra time for a smaller export, per megapixel of the *full-size* crop: the
 * source readback plus the Lanczos resize (about 60 ms/MP on its own).
 */
const RESIZE_MS_PER_MEGAPIXEL = 80;
/** Floor for the estimate, so the bar is still seen to move on a tiny image. */
const EXPORT_ESTIMATE_MIN_MS = 400;

export function Editor() {
  const viewportRef = useRef<ViewportHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const builtInEncoderNoticeShown = useRef(false);
  const builtInResizeNoticeShown = useRef(false);

  const [image, setImage] = useState<LoadedImage | null>(null);
  // The edit itself (adjustments, active preset, crop, crop ratio) lives in an
  // undo/redo history; every change goes through `apply`. The crop is its own
  // field, apart from `adjustments`, on purpose: a preset replaces the
  // adjustments wholesale and must not throw away a crop. (The nav's Reset
  // clears both explicitly.)
  const { edit, apply, restart, undo, redo } = useEditHistory(() => ({
    adjustments: createDefaultAdjustments(),
    activePresetId: null,
    crop: null, // in pixels of the working image; null = the whole image
    aspect: FREE_ASPECT,
  }));
  const { adjustments, activePresetId, crop, aspect } = edit;
  const [importedPresets, persistPresets] = useImportedPresets();
  const [compare, setCompare] = useState(false);
  const [cropping, setCropping] = useState(false);
  /** The crop as it was when cropping started, for Cancel / Escape. */
  const cropAtEntry = useRef<CropRect | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState<string | null>(null); // status text while decoding
  /** Expected duration (ms) of the export in progress, which paces the progress bar; null when idle. */
  const [exportEstimate, setExportEstimate] = useState<number | null>(null);
  /** Measured ms per megapixel of the last export in each format, for the next estimate. */
  const exportRates = useRef<Partial<Record<ExportFormat, number>>>({});
  /** Measured ms per full-size megapixel of the last resize, for the next estimate. */
  const resizeRate = useRef<number | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("image/jpeg");
  const [quality, setQuality] = useState(QUALITY_DEFAULT);
  const [exportSize, setExportSize] = useState<ExportSize>(null);
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
        // The adjustments carry over to the new photo, but a crop is in pixels of
        // the photo it was made on, so it doesn't. Undo history starts over too:
        // its earlier steps hold crops that belong to the previous photo.
        restart((prev) => ({ ...prev, crop: null, aspect: FREE_ASPECT }));
        setCropping(false);
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
    [notify, restart],
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
    apply(
      (prev) => ({ ...prev, adjustments: { ...prev.adjustments, ...patch }, activePresetId: null }),
      // Keyed by which settings changed, so dragging one slider is one undo
      // step, and moving on to another slider starts the next.
      `adjust:${Object.keys(patch).sort().join(",")}`,
    );
  };
  /** The nav's Reset: back to the photo as it was opened, crop included. */
  const resetAll = () => {
    apply(() => ({
      adjustments: createDefaultAdjustments(),
      activePresetId: null,
      crop: null,
      aspect: FREE_ASPECT,
    }));
    setCropping(false);
  };
  const applyPresetToImage = (preset: Preset) => {
    // Presets are applied on a clean slate rather than stacked on current edits.
    apply((prev) => ({
      ...prev,
      adjustments: applyPreset(createDefaultAdjustments(), preset.adjustments),
      activePresetId: preset.id,
    }));
  };

  // ----- crop -----
  const cropRatio = image ? resolveAspect(aspect, image.width, image.height) : null;
  const changeCrop = (rect: CropRect) => {
    if (!image) return;
    const next = isFullRect(rect, image.width, image.height) ? null : rect;
    // Keyed so one drag of the crop box is one undo step.
    apply((prev) => ({ ...prev, crop: next }), "crop");
  };
  const startCrop = () => {
    if (!image || cropping) return;
    cropAtEntry.current = crop;
    setCropping(true);
  };
  const cancelCrop = () => {
    const entry = cropAtEntry.current; // read here: `apply` callbacks must not touch refs
    apply((prev) => ({ ...prev, crop: entry }));
    setCropping(false);
  };
  const resetCrop = () => {
    apply((prev) => ({ ...prev, crop: null, aspect: FREE_ASPECT }));
  };
  const chooseAspect = (choice: AspectChoice) => {
    if (!image) {
      apply((prev) => ({ ...prev, aspect: choice }));
      return;
    }
    // Picking a shape is a request to crop: show the box if it isn't up yet.
    startCrop();
    const { width, height } = image;
    const ratio = resolveAspect(choice, width, height);
    // The ratio and the reshaped crop change together, as a single undo step.
    apply((prev) => {
      if (ratio === null) return { ...prev, aspect: choice };
      const reshaped = applyAspect(prev.crop ?? fullRect(width, height), ratio, width, height);
      return {
        ...prev,
        aspect: choice,
        crop: isFullRect(reshaped, width, height) ? null : reshaped,
      };
    });
  };

  // While cropping: Enter finishes, Escape puts the crop back as it was.
  useEffect(() => {
    if (!cropping) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      if (e.key === "Escape") {
        const entry = cropAtEntry.current;
        apply((prev) => ({ ...prev, crop: entry }));
        setCropping(false);
      } else if (e.key === "Enter" && tag !== "BUTTON" && tag !== "A") {
        // (On a button or link, Enter belongs to that control.)
        e.preventDefault();
        setCropping(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cropping, apply]);

  // Undo / redo: Cmd+Z and Cmd+Shift+Z on a Mac, Ctrl+Z and Ctrl+Y (or
  // Ctrl+Shift+Z) elsewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const isUndo = key === "z" && !e.shiftKey;
      const isRedo = (key === "z" && e.shiftKey) || (key === "y" && e.ctrlKey && !e.metaKey);
      if (!isUndo && !isRedo) return;
      // While typing in a text field, the shortcut belongs to the field: it
      // undoes the typing. (Sliders are inputs too, but not text ones.)
      const t = e.target;
      if (t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable))
        return;
      if (t instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(t.type)) return;
      e.preventDefault();
      if (isUndo) undo();
      else redo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // ----- export -----
  const exportImage = async () => {
    if (!image || !viewportRef.current) return;
    const fullW = crop?.width ?? image.width;
    const fullH = crop?.height ?? image.height;
    const size = exportDimensions(fullW, fullH, exportSize);
    const resizing = size.width !== fullW || size.height !== fullH;
    const fullMegapixels = (fullW * fullH) / 1e6;
    const megapixels = (size.width * size.height) / 1e6;
    const rate = exportRates.current[exportFormat] ?? EXPORT_MS_PER_MEGAPIXEL[exportFormat];
    const resizeEstimate = resizing
      ? fullMegapixels * (resizeRate.current ?? RESIZE_MS_PER_MEGAPIXEL)
      : 0;
    setExportEstimate(Math.max(EXPORT_ESTIMATE_MIN_MS, megapixels * rate + resizeEstimate));
    const started = performance.now();
    try {
      // The quality field applies to JPEG and WebP; PNG is lossless (the
      // encoder ignores the value).
      const { blob, usedBuiltInEncoder, usedBuiltInResize, resizeMs } =
        await viewportRef.current.exportBlob(
          exportFormat,
          hasQuality(exportFormat) ? quality / 100 : 1,
          exportSize,
        );
      exportRates.current[exportFormat] = (performance.now() - started - resizeMs) / megapixels;
      if (resizing && !usedBuiltInResize) resizeRate.current = resizeMs / fullMegapixels;
      if (usedBuiltInResize && !builtInResizeNoticeShown.current) {
        builtInResizeNoticeShown.current = true;
        notify(
          "The high-quality resizer couldn't run here, so the photo was scaled the way the preview is. It may look a little softer.",
          "info",
        );
      }
      // The export still succeeds, just less tightly compressed. Say so once.
      if (usedBuiltInEncoder && !builtInEncoderNoticeShown.current) {
        builtInEncoderNoticeShown.current = true;
        notify(
          `The optimised ${FORMAT_LABELS[exportFormat]} encoder couldn't run here, so the browser's own encoder was used. Files may be larger.`,
          "info",
        );
      }
      const ext =
        exportFormat === "image/png" ? "png" : exportFormat === "image/webp" ? "webp" : "jpg";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const suffix = resizing ? `-${size.width}x${size.height}` : "";
      a.download = `${stripExtension(image.name)}-edited${suffix}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExportEstimate(null);
    }
  };

  // Anything the nav's Reset would undo: a changed slider or a crop.
  const edited = !isDefault(adjustments) || crop !== null;

  return (
    <div className="flex h-dvh flex-col bg-zinc-950 text-zinc-200">
      {/* Header */}
      <header className="relative flex h-12 shrink-0 items-center gap-3 border-b border-zinc-800 px-4">
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
          exporting={exportEstimate !== null}
          exportFormat={exportFormat}
          quality={quality}
          exportSize={exportSize}
          fullLongEdge={
            image ? Math.max(crop?.width ?? image.width, crop?.height ?? image.height) : null
          }
          onOpen={() => fileInputRef.current?.click()}
          onCompareChange={setCompare}
          onReset={resetAll}
          onFormatChange={setExportFormat}
          onQualityChange={setQuality}
          onExportSizeChange={setExportSize}
          onExport={exportImage}
        />
        <ExportProgress estimateMs={exportEstimate} />
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
            crop={crop}
            cropping={cropping}
            cropRatio={cropRatio}
            onCropChange={changeCrop}
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
            presets={[...BUILTIN_PRESETS, ...importedPresets]}
            activeId={activePresetId}
            onApply={applyPresetToImage}
            onImportFiles={(files) =>
              void importPresetFiles(files.map((file) => ({ file, path: file.name })))
            }
            onRemove={(id) => persistPresets((prev) => prev.filter((p) => p.id !== id))}
            disabled={!image}
          />
          <CropPanel
            disabled={!image}
            cropping={cropping}
            cropped={crop !== null}
            size={
              image
                ? { width: crop?.width ?? image.width, height: crop?.height ?? image.height }
                : null
            }
            aspect={aspect}
            onStart={startCrop}
            onDone={() => setCropping(false)}
            onCancel={cancelCrop}
            onReset={resetCrop}
            onAspectChange={chooseAspect}
          />
          <AdjustmentsPanel
            adjustments={adjustments}
            onChange={updateAdjustments}
            disabled={!image}
          />
          <div className="px-4 py-3 text-[11px] leading-relaxed text-zinc-600">
            Double-click any slider to reset it.{" "}
            {/* The compare control differs by layout: a hold button on wide screens,
                a menu entry behind the hamburger on phones. */}
            <span className="hidden md:inline">
              Hold the Before button or press{" "}
              <kbd className="rounded border border-zinc-700 px-1">\</kbd> to compare with the
              original. Undo with <kbd className="rounded border border-zinc-700 px-1">⌘Z</kbd> or{" "}
              <kbd className="rounded border border-zinc-700 px-1">Ctrl+Z</kbd>.
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
