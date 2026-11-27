"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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
import { isXmpFile, RAW_EXTENSIONS, sampleColor, stripExtension } from "@/lib/image";
import {
  type BrushStroke,
  createLayer,
  type Layer,
  type LayerKind,
  MAX_LAYERS,
  newLayerId,
  nextLayerName,
  pickedHue,
} from "@/lib/layers";
import {
  type BrushMode,
  type BrushSettings,
  DEFAULT_BRUSH,
  stepBrushSize,
} from "@/lib/masks/brush";
import type { UV } from "@/lib/masks/geometry";
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
import { useMediaQuery } from "./hooks/useMediaQuery";
import { useToast } from "./hooks/useToast";
import { useWindowFileDrop } from "./hooks/useWindowFileDrop";
import { ImageViewport, type ViewportHandle } from "./ImageViewport";
import { LayerSettings } from "./LayerSettings";
import { LayersPanel } from "./LayersPanel";
import { MaskOverlay } from "./MaskOverlay";
import { PresetsPanel } from "./PresetsPanel";
import { Toast } from "./Toast";

export function Editor() {
  const viewportRef = useRef<ViewportHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast, notify } = useToast();

  // The edit itself (adjustments, active preset, crop, crop ratio, layers)
  // lives in an undo/redo history; every change goes through `apply`. The crop
  // and the layers are fields of their own, apart from `adjustments`, on
  // purpose: a preset replaces the adjustments wholesale and must not throw
  // away a crop or a layer. (The nav's Reset clears all of them explicitly.)
  const { edit, apply, restart, undo, redo } = useEditHistory(() => ({
    adjustments: createDefaultAdjustments(),
    activePresetId: null,
    crop: null, // in pixels of the working image; null = the whole image
    aspect: FREE_ASPECT,
    layers: [],
  }));
  const { adjustments, activePresetId, crop, aspect, layers } = edit;
  const [importedPresets, persistPresets] = useImportedPresets();
  const [compare, setCompare] = useState(false);
  const [cropping, setCropping] = useState(false);
  /** The crop as it was when cropping started, for Cancel / Escape. */
  const cropAtEntry = useRef<CropRect | null>(null);

  // Layer UI state. Not part of the edit: undo never changes what you're
  // looking at. If an undo removes the selected layer, the panel goes back to
  // the global adjustments (and a redo brings the layer back selected).
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [showMask, setShowMask] = useState(false);
  const [brushMode, setBrushMode] = useState<BrushMode>("off");
  const [brush, setBrush] = useState<BrushSettings>(DEFAULT_BRUSH);
  const [picking, setPicking] = useState(false);
  /** The stroke being painted: drawn, but not in the history until the pointer lifts. */
  const [pendingStroke, setPendingStroke] = useState<BrushStroke | null>(null);
  const selectedIndex = layers.findIndex((l) => l.id === selectedLayerId);
  const selectedLayer = selectedIndex >= 0 ? layers[selectedIndex] : null;

  // ----- opening files -----
  const onImageLoaded = useCallback(() => {
    // The adjustments carry over to the new photo, but a crop is in pixels of
    // the photo it was made on, so it doesn't. Undo history starts over too:
    // its earlier steps hold crops that belong to the previous photo.
    // Layers go too: their masks were drawn on the previous photo.
    restart((prev) => ({ ...prev, crop: null, aspect: FREE_ASPECT, layers: [] }));
    setCropping(false);
    setSelectedLayerId(null);
    setPendingStroke(null);
    setPicking(false);
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
        const saved = persistPresets((prev) => [...prev, ...added]);
        const imported = `Imported ${added.length} preset${added.length === 1 ? "" : "s"}${
          added.length === 1 ? `: ${added[0].name}` : ""
        }`;
        notify(
          saved
            ? imported
            : `${imported}. This browser won't let them be saved, so they'll be gone when you close this tab.`,
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

  const exporter = useExport({ viewportRef, image, adjustments, layers, crop, notify });

  // ----- adjustments -----
  const patchAdjustments = (patch: Partial<Adjustments>, key?: string) =>
    apply(
      (prev) => ({ ...prev, adjustments: { ...prev.adjustments, ...patch }, activePresetId: null }),
      key,
    );
  // Keyed by which settings changed, so dragging one slider is one undo step,
  // and moving on to another slider starts the next. A curve holds many points
  // in one setting, so its drags add a `gesture` to stay separate steps.
  const updateAdjustments = (patch: Partial<Adjustments>, gesture?: string) =>
    patchAdjustments(
      patch,
      `adjust:${Object.keys(patch).sort().join(",")}${gesture ? `:${gesture}` : ""}`,
    );
  /** A section's Reset: a discrete action, so no key and an undo step of its own. */
  const resetAdjustments = (patch: Partial<Adjustments>) => patchAdjustments(patch);
  /** The nav's Reset: back to the photo as it was opened, crop and layers included. */
  const resetAll = () => {
    apply(() => ({
      adjustments: createDefaultAdjustments(),
      activePresetId: null,
      crop: null,
      aspect: FREE_ASPECT,
      layers: [],
    }));
    setCropping(false);
    selectLayer(null);
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
    selectLayer(null);
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

  // ----- layers -----
  /** Select a layer (null: back to the global adjustments), with the tool that suits it. */
  function selectLayer(id: string | null) {
    const layer = id === null ? null : layers.find((l) => l.id === id);
    setSelectedLayerId(layer ? layer.id : null);
    setBrushMode(layer?.mask.type === "brush" ? "paint" : "off");
    setPicking(false);
    setPendingStroke(null);
    if (layer) setCropping(false);
  }
  const updateLayer = (id: string, update: (layer: Layer) => Layer, key?: string) =>
    apply(
      (prev) => ({ ...prev, layers: prev.layers.map((l) => (l.id === id ? update(l) : l)) }),
      key,
    );
  const addLayer = (kind: LayerKind) => {
    if (!image || layers.length >= MAX_LAYERS) return;
    const layer = createLayer(kind, {
      id: newLayerId(),
      name: nextLayerName(kind, layers),
      // Placed on what's in view: the crop, or the whole photo.
      view: crop ?? fullRect(image.width, image.height),
      imageWidth: image.width,
      imageHeight: image.height,
    });
    apply((prev) =>
      prev.layers.length >= MAX_LAYERS ? prev : { ...prev, layers: [...prev.layers, layer] },
    );
    setSelectedLayerId(layer.id);
    setBrushMode(kind === "brush" ? "paint" : "off");
    setPicking(kind === "color");
    setPendingStroke(null);
    setCropping(false);
  };
  const deleteLayer = (id: string) => {
    apply((prev) => ({ ...prev, layers: prev.layers.filter((l) => l.id !== id) }));
    if (id === selectedLayerId) selectLayer(null);
  };
  const commitStroke = (stroke: BrushStroke) => {
    // The same stroke object that was being drawn, so nothing is drawn twice.
    if (selectedLayer) {
      updateLayer(selectedLayer.id, (l) => ({ ...l, strokes: [...l.strokes, stroke] }));
    }
    setPendingStroke(null);
  };
  const pickColor = ([u, v]: UV) => {
    if (!image || !selectedLayer) return;
    const rgb = sampleColor(image.bitmap, u * image.width, v * image.height);
    const hue = rgb && pickedHue(...rgb);
    if (hue === null || hue === undefined) {
      notify("That spot has almost no color. Pick a more colorful one.", "info");
      return;
    }
    updateLayer(selectedLayer.id, (l) => (l.color ? { ...l, color: { ...l.color, hue } } : l));
    setPicking(false);
  };
  /** Layers as drawn: the stroke being painted is shown on its layer before it's kept. */
  const shownLayers = useMemo(() => {
    if (!pendingStroke || !selectedLayerId) return layers;
    return layers.map((l) =>
      l.id === selectedLayerId ? { ...l, strokes: [...l.strokes, pendingStroke] } : l,
    );
  }, [layers, pendingStroke, selectedLayerId]);

  useEditorShortcuts({
    cropping,
    layerSelected: selectedLayer !== null,
    brushActive: selectedLayer !== null && brushMode !== "off",
    onToggleCompare: () => setCompare((c) => !c),
    onUndo: undo,
    onRedo: redo,
    onFinishCrop: () => setCropping(false),
    onCancelCrop: cancelCrop,
    onEscapeLayer: () => (picking ? setPicking(false) : selectLayer(null)),
    onDeleteLayer: () => selectedLayer && deleteLayer(selectedLayer.id),
    onToggleMask: () => setShowMask((v) => !v),
    onBrushSize: (up) => setBrush((b) => ({ ...b, size: stepBrushSize(b.size, up) })),
  });

  // Wide screens get a third column, on the left, for everything about layers,
  // and the right sidebar keeps the global adjustments. Narrower screens have
  // one sidebar, where a selected layer's settings stand in for the global
  // adjustments until it's deselected. (Three columns need about 1280px for
  // the photo to keep a useful size.)
  const wide = useMediaQuery("(min-width: 80rem)");
  const layersPanel = (
    <LayersPanel
      layers={layers}
      selectedId={selectedLayer?.id ?? null}
      disabled={!image}
      collapsible={!wide}
      onAdd={addLayer}
      onSelect={(id) => selectLayer(id === selectedLayerId ? null : id)}
      onToggleVisible={(id) => updateLayer(id, (l) => ({ ...l, visible: !l.visible }))}
      onDelete={deleteLayer}
      onDeleteAll={() => {
        apply((prev) => ({ ...prev, layers: [] }));
        selectLayer(null);
      }}
    />
  );
  const layerSettings = selectedLayer && (
    <LayerSettings
      key={selectedLayer.id}
      layer={selectedLayer}
      disabled={!image}
      onUpdate={(update, key) => updateLayer(selectedLayer.id, update, key)}
      onDone={() => selectLayer(null)}
      onDelete={() => deleteLayer(selectedLayer.id)}
      showMask={showMask}
      onShowMaskChange={setShowMask}
      brushMode={brushMode}
      onBrushModeChange={(mode) => {
        setBrushMode(mode);
        if (mode !== "off") setPicking(false);
      }}
      brush={brush}
      onBrushChange={(patch) => setBrush((b) => ({ ...b, ...patch }))}
      picking={picking}
      onPickingChange={(on) => {
        setPicking(on);
        if (on) setBrushMode("off");
      }}
    />
  );
  const adjustmentsPanel = (
    <AdjustmentsPanel
      adjustments={adjustments}
      onChange={updateAdjustments}
      onReset={resetAdjustments}
      disabled={!image}
    />
  );

  // Anything the nav's Reset would undo: a changed slider, a crop or a layer.
  const edited = !isDefault(adjustments) || crop !== null || layers.length > 0;
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
      <div
        className={`grid min-h-0 flex-1 ${
          wide
            ? "grid-cols-[288px_minmax(0,1fr)_340px]"
            : "grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]"
        }`}
      >
        {wide && (
          <aside
            className="min-h-0 overflow-y-auto border-r border-zinc-800 bg-zinc-950"
            aria-label="Layers"
          >
            {layersPanel}
            {layerSettings ??
              (layers.length > 0 && (
                <p className="px-4 py-3 text-[11px] leading-relaxed text-zinc-500">
                  Select a layer to move its mask and change its settings.
                </p>
              ))}
          </aside>
        )}
        <main className="relative min-h-[50vh] bg-[#111113] p-6 lg:min-h-0">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.03),transparent_70%)]" />
          <ImageViewport
            ref={viewportRef}
            image={image}
            adjustments={adjustments}
            layers={shownLayers}
            showMask={showMask ? selectedIndex : -1}
            compare={compare}
            crop={crop}
            cropping={cropping}
            cropRatio={cropRatio}
            onCropChange={changeCrop}
            onError={notify}
            overlay={
              image &&
              selectedLayer && (
                <MaskOverlay
                  imageWidth={image.width}
                  imageHeight={image.height}
                  view={crop ?? fullRect(image.width, image.height)}
                  layer={selectedLayer}
                  brush={brushMode === "off" ? null : { ...brush, erase: brushMode === "erase" }}
                  picking={picking}
                  onMaskChange={(mask, gesture) =>
                    updateLayer(
                      selectedLayer.id,
                      (l) => ({ ...l, mask }),
                      `layer:${selectedLayer.id}:mask:${gesture}`,
                    )
                  }
                  onStrokeChange={setPendingStroke}
                  onStrokeEnd={commitStroke}
                  onPick={pickColor}
                />
              )
            }
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
                  Drop to replace the photo (adjustments are kept)
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
          {wide ? (
            adjustmentsPanel
          ) : (
            <>
              {layersPanel}
              {layerSettings || adjustmentsPanel}
            </>
          )}
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
