"use client";

import {
  DEFAULT_COLOR,
  DEFAULT_LOCAL,
  DEFAULT_LUMINANCE,
  DEFAULT_RADIAL_FEATHER,
  type Layer,
  type LocalAdjustments,
  type LocalKey,
  type LocalSliderSpec,
  isLocalDefault,
  LOCAL_COLOR,
  LOCAL_PRESENCE,
  LOCAL_TONE,
  LOCAL_WB,
} from "@/lib/layers";
import {
  type BrushMode,
  type BrushSettings,
  MAX_BRUSH_SIZE,
  MIN_BRUSH_SIZE,
} from "@/lib/masks/brush";
import {
  HUE_TRACK,
  Segmented,
  SubHeading,
  TEMPERATURE_TRACK,
  TINT_TRACK,
  ToggleButton,
} from "./controls";
import { Section } from "./Section";
import { Slider } from "./Slider";

/** A change to the layer itself; `key` merges repeats into one undo step (none = a step of its own). */
export type LayerUpdate = (update: (layer: Layer) => Layer, key?: string) => void;

interface Props {
  layer: Layer;
  disabled?: boolean;
  onUpdate: LayerUpdate;
  onDone: () => void;
  onDelete: () => void;
  showMask: boolean;
  onShowMaskChange: (show: boolean) => void;
  brushMode: BrushMode;
  onBrushModeChange: (mode: BrushMode) => void;
  brush: BrushSettings;
  onBrushChange: (patch: Partial<BrushSettings>) => void;
  /** The colour range's eyedropper is waiting for a click on the photo. */
  picking: boolean;
  onPickingChange: (picking: boolean) => void;
}

const TRACKS: Partial<Record<LocalKey, string>> = {
  temperature: TEMPERATURE_TRACK,
  tint: TINT_TRACK,
  colorHue: HUE_TRACK,
};

/**
 * The selected layer's settings, shown in place of the global adjustments:
 * its mask (shape, brush, ranges) and what it changes where the mask is.
 */
export function LayerSettings({
  layer,
  disabled,
  onUpdate,
  onDone,
  onDelete,
  showMask,
  onShowMaskChange,
  brushMode,
  onBrushModeChange,
  brush,
  onBrushChange,
  picking,
  onPickingChange,
}: Props) {
  const a = layer.adjustments;
  const id = layer.id;

  const setLocal = (patch: Partial<LocalAdjustments>, key?: string) =>
    onUpdate((l) => ({ ...l, adjustments: { ...l.adjustments, ...patch } }), key);
  const localSliders = (specs: LocalSliderSpec[]) =>
    specs.map((s) => (
      <Slider
        key={s.key}
        label={s.label}
        value={a[s.key]}
        min={s.min}
        max={s.max}
        step={s.step}
        defaultValue={DEFAULT_LOCAL[s.key]}
        track={TRACKS[s.key]}
        disabled={disabled}
        onChange={(v) => setLocal({ [s.key]: v }, `layer:${id}:adjust:${s.key}`)}
      />
    ));

  const mask = layer.mask;
  const lum = layer.luminance;
  const col = layer.color;
  const tint = a.colorSaturation > 0 ? `hsl(${a.colorHue} 80% 55%)` : "transparent";

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
        <button
          type="button"
          onClick={onDone}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          title="Back to the whole-photo adjustments (Esc)"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M7 1L3 5l4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          Done
        </button>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-200">
          {layer.name}
        </span>
        <button
          type="button"
          onClick={onDelete}
          className="text-[11px] text-zinc-500 hover:text-red-300"
          title="Delete this layer (Delete)"
        >
          Delete
        </button>
      </div>

      <Section title="Mask">
        <Slider
          label="Amount"
          value={layer.amount}
          min={0}
          max={100}
          defaultValue={100}
          disabled={disabled}
          onChange={(v) => onUpdate((l) => ({ ...l, amount: v }), `layer:${id}:amount`)}
        />
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500">Overlay</span>
          <div className="ml-auto flex rounded-md border border-zinc-800 p-0.5">
            <ToggleButton
              active={showMask}
              onClick={() => onShowMaskChange(!showMask)}
              title="Show where the layer applies, in red (O)"
            >
              Show mask
            </ToggleButton>
          </div>
        </div>

        {mask.type === "linear" && (
          <Hint>
            Drag the end handles to set where the gradient starts and ends, or the middle one to
            move it.
          </Hint>
        )}
        {mask.type === "radial" && (
          <>
            <Hint>
              Drag the centre to move the ellipse, its edge handles to resize it, and the top handle
              to turn it.
            </Hint>
            <Slider
              label="Feather"
              value={mask.feather}
              min={0}
              max={100}
              defaultValue={DEFAULT_RADIAL_FEATHER}
              disabled={disabled}
              onChange={(v) =>
                onUpdate(
                  (l) => (l.mask.type === "radial" ? { ...l, mask: { ...l.mask, feather: v } } : l),
                  `layer:${id}:feather`,
                )
              }
            />
            <Segmented
              label="Applies"
              value={mask.invert ? "outside" : "inside"}
              options={[
                ["inside", "Inside"],
                ["outside", "Outside"],
              ]}
              onChange={(v) =>
                onUpdate((l) =>
                  l.mask.type === "radial"
                    ? { ...l, mask: { ...l.mask, invert: v === "outside" } }
                    : l,
                )
              }
            />
          </>
        )}
        {mask.type === "range" && !lum && !col && (
          <Hint>
            This layer covers the whole photo. Limit it to a range of tones or colors below.
          </Hint>
        )}

        <SubHeading>Brush</SubHeading>
        <Segmented
          label={mask.type === "brush" ? "Paint" : "Refine"}
          value={brushMode}
          options={[
            ["off", "Off"],
            ["paint", "Add"],
            ["erase", "Erase"],
          ]}
          onChange={onBrushModeChange}
        />
        {brushMode !== "off" && (
          <>
            <Slider
              label="Size"
              value={Math.round(brush.size * 1000) / 10}
              min={MIN_BRUSH_SIZE * 100}
              max={MAX_BRUSH_SIZE * 100}
              step={0.1}
              defaultValue={4}
              disabled={disabled}
              onChange={(v) => onBrushChange({ size: v / 100 })}
            />
            <Slider
              label="Feather"
              value={brush.feather}
              min={0}
              max={100}
              defaultValue={60}
              disabled={disabled}
              onChange={(v) => onBrushChange({ feather: v })}
            />
            <Slider
              label="Flow"
              value={brush.flow}
              min={1}
              max={100}
              defaultValue={100}
              disabled={disabled}
              onChange={(v) => onBrushChange({ flow: v })}
            />
            <Hint>
              Paint on the photo. Hold Alt (Option) to {brushMode === "erase" ? "add" : "erase"}{" "}
              instead; <Kbd>[</Kbd> and <Kbd>]</Kbd> change the size.
            </Hint>
          </>
        )}
        {layer.strokes.length > 0 && (
          <button
            type="button"
            onClick={() => onUpdate((l) => ({ ...l, strokes: [] }))}
            className="self-start text-[11px] text-zinc-500 hover:text-zinc-200"
          >
            Clear painting ({layer.strokes.length} stroke{layer.strokes.length === 1 ? "" : "s"})
          </button>
        )}
      </Section>

      <Section
        title="Range"
        defaultOpen={mask.type === "range"}
        modified={!!lum || !!col}
        onReset={() => onUpdate((l) => ({ ...l, luminance: null, color: null }))}
      >
        <Segmented
          label="Luminance"
          value={lum ? "on" : "off"}
          options={[
            ["off", "Off"],
            ["on", "Limit"],
          ]}
          onChange={(v) =>
            onUpdate((l) => ({ ...l, luminance: v === "on" ? { ...DEFAULT_LUMINANCE } : null }))
          }
        />
        {lum && (
          <>
            <Slider
              label="From"
              value={lum.lo}
              min={0}
              max={100}
              defaultValue={DEFAULT_LUMINANCE.lo}
              track="linear-gradient(90deg,#000,#fff)"
              disabled={disabled}
              onChange={(v) => setRange("luminance", { lo: v })}
            />
            <Slider
              label="To"
              value={lum.hi}
              min={0}
              max={100}
              defaultValue={DEFAULT_LUMINANCE.hi}
              track="linear-gradient(90deg,#000,#fff)"
              disabled={disabled}
              onChange={(v) => setRange("luminance", { hi: v })}
            />
            <Slider
              label="Smoothness"
              value={lum.feather}
              min={0}
              max={100}
              defaultValue={DEFAULT_LUMINANCE.feather}
              disabled={disabled}
              onChange={(v) => setRange("luminance", { feather: v })}
            />
          </>
        )}
        <Segmented
          label="Color"
          value={col ? "on" : "off"}
          options={[
            ["off", "Off"],
            ["on", "Limit"],
          ]}
          onChange={(v) => {
            onUpdate((l) => ({ ...l, color: v === "on" ? { ...DEFAULT_COLOR } : null }));
            onPickingChange(v === "on");
          }}
        />
        {col && (
          <>
            <div className="flex items-center gap-2">
              <span
                className="size-4 shrink-0 rounded-full border border-zinc-700"
                style={{ background: `hsl(${col.hue} 80% 55%)` }}
                aria-hidden
              />
              <button
                type="button"
                onClick={() => onPickingChange(!picking)}
                aria-pressed={picking}
                className={`flex-1 rounded-md border px-2 py-1 text-[11px] ${
                  picking
                    ? "border-sky-500 bg-sky-500/15 text-sky-200"
                    : "border-zinc-800 text-zinc-300 hover:border-zinc-600"
                }`}
              >
                {picking ? "Click the photo to pick a color…" : "Pick a color from the photo"}
              </button>
            </div>
            <Slider
              label="Hue"
              value={col.hue}
              min={0}
              max={360}
              defaultValue={DEFAULT_COLOR.hue}
              track={HUE_TRACK}
              disabled={disabled}
              onChange={(v) => setRange("color", { hue: v })}
            />
            <Slider
              label="Range"
              value={col.width}
              min={0}
              max={100}
              defaultValue={DEFAULT_COLOR.width}
              disabled={disabled}
              onChange={(v) => setRange("color", { width: v })}
            />
          </>
        )}
      </Section>

      <Section
        title="Adjustments"
        modified={!isLocalDefault(a)}
        onReset={() => setLocal({ ...DEFAULT_LOCAL })}
      >
        <SubHeading>White Balance</SubHeading>
        {localSliders(LOCAL_WB)}
        <SubHeading>Tone</SubHeading>
        {localSliders(LOCAL_TONE)}
        <SubHeading>Presence</SubHeading>
        {localSliders(LOCAL_PRESENCE)}
        <div className="flex items-center justify-between pt-1">
          <SubHeading>Color</SubHeading>
          <span
            className="size-3.5 rounded-full border border-zinc-700"
            style={{ background: tint, opacity: Math.max(a.colorSaturation / 100, 0.15) }}
            aria-hidden
          />
        </div>
        {localSliders(LOCAL_COLOR)}
      </Section>
    </div>
  );

  function setRange<K extends "luminance" | "color">(
    which: K,
    patch: Partial<NonNullable<Layer[K]>>,
  ) {
    onUpdate((l) => {
      const current = l[which];
      return current ? { ...l, [which]: { ...current, ...patch } } : l;
    }, `layer:${id}:${which}`);
  }
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] leading-relaxed text-zinc-500">{children}</p>;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-zinc-700 px-1">{children}</kbd>;
}
