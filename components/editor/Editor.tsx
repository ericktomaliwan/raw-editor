"use client";

import { useCallback, useRef, useState } from "react";
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
import type { DroppedFile } from "@/lib/dropFiles";
import { isXmpFile, RAW_EXTENSIONS, stripExtension } from "@/lib/image";
import { useImportedPresets } from "@/lib/presetStore";
import { BUILTIN_PRESETS, type Preset } from "@/lib/presets";
import { formatRawMetadata } from "@/lib/raw/decoder";
import { useEditHistory } from "@/lib/useEditHistory";
import { MAX_XMP_BYTES, parseXmpPreset } from "@/lib/xmp";
import { AdjustmentsPanel } from "./AdjustmentsPanel";
import { CropPanel } from "./CropPanel";
import { DropZone } from "./DropZone";
import { ExportProgress } from "./ExportProgress";
import { HeaderActions } from "./HeaderActions";
import { useEditorShortcuts } from "./hooks/useEditorShortcuts";
import { useExport } from "./hooks/useExport";
import { useImageLoader } from "./hooks/useImageLoader";
import { useToast } from "./hooks/useToast";
import { useWindowFileDrop } from "./hooks/useWindowFileDrop";
import { ImageViewport, type ViewportHandle } from "./ImageViewport";
import { PresetsPanel } from "./PresetsPanel";
import { Toast } from "./Toast";

export function Editor() {
  const viewportRef = useRef<ViewportHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast, notify } = useToast();

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

  // ----- opening files -----
  const onImageLoaded = useCallback(() => {
    // The adjustments carry over to the new photo, but a crop is in pixels of
    // the photo it was made on, so it doesn't. Undo history starts over too:
    // its earlier steps hold crops that belong to the previous photo.
    restart((prev) => ({ ...prev, crop: null, aspect: FREE_ASPECT }));
    setCropping(false);
  }, [restart]);
  const { image, loading, openImage } = useImageLoader({
    viewportRef,
    onLoaded: onImageLoaded,
    notify,
  });

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
  const dragging = useWindowFileDrop(handleFiles);

  const exporter = useExport({ viewportRef, image, adjustments, crop, notify });

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

  useEditorShortcuts({
    cropping,
    onToggleCompare: () => setCompare((c) => !c),
    onUndo: undo,
    onRedo: redo,
    onFinishCrop: () => setCropping(false),
    onCancelCrop: cancelCrop,
  });

  // Anything the nav's Reset would undo: a changed slider or a crop.
  const edited = !isDefault(adjustments) || crop !== null;
  /** What an export would save at full size: the crop, or the whole photo. */
  const area = image ? (crop ?? fullRect(image.width, image.height)) : null;
  const rawDetails = image?.raw ? formatRawMetadata(image.raw.metadata) : "";

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
                  <span
                    className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-300"
                    title={
                      image.raw.cameraMatchEv > 0
                        ? `Brightened ${image.raw.cameraMatchEv.toFixed(1)} EV to match the camera's own rendering`
                        : undefined
                    }
                  >
                    {image.raw.preview ? "RAW preview" : "RAW"}
                  </span>
                  {rawDetails && (
                    <span className="ml-2 hidden text-zinc-500 md:inline">{rawDetails}</span>
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
          exporting={exporter.exporting}
          exportFormat={exporter.format}
          quality={exporter.quality}
          exportSize={exporter.size}
          fullLongEdge={area ? Math.max(area.width, area.height) : null}
          onOpen={() => fileInputRef.current?.click()}
          onCompareChange={setCompare}
          onReset={resetAll}
          onFormatChange={exporter.setFormat}
          onQualityChange={exporter.setQuality}
          onExportSizeChange={exporter.setSize}
          onExport={exporter.runExport}
        />
        <ExportProgress estimateMs={exporter.estimateMs} />
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
            size={area && { width: area.width, height: area.height }}
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

      <Toast toast={toast} />
    </div>
  );
}
