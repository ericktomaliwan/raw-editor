"use client";

import { ASPECT_PRESETS, type AspectChoice, aspectLabel, canRotateAspect } from "@/lib/crop";
import { Section } from "./Section";

interface Props {
  /** No photo is open. */
  disabled: boolean;
  /** The crop box is on screen and being edited. */
  cropping: boolean;
  /** A crop smaller than the whole image is in effect. */
  cropped: boolean;
  /** Pixel size of the picture as it will be exported, or null with no photo. */
  size: { width: number; height: number } | null;
  aspect: AspectChoice;
  onStart: () => void;
  onDone: () => void;
  onCancel: () => void;
  onReset: () => void;
  onAspectChange: (choice: AspectChoice) => void;
}

/**
 * Side-panel controls for the crop tool: start/finish, the aspect-ratio
 * presets, and the resulting size. The dragging itself happens on the image
 * (CropOverlay); picking a ratio here starts cropping if it isn't on already.
 */
export function CropPanel({
  disabled,
  cropping,
  cropped,
  size,
  aspect,
  onStart,
  onDone,
  onCancel,
  onReset,
  onAspectChange,
}: Props) {
  const selected = ASPECT_PRESETS.find((p) => p.id === aspect.id) ?? ASPECT_PRESETS[0];
  const rotatable = canRotateAspect(selected);

  return (
    <Section
      title="Crop"
      modified={cropped}
      onReset={onReset}
      actions={
        <button
          type="button"
          disabled={disabled}
          onClick={cropping ? onDone : onStart}
          aria-pressed={cropping}
          className={`rounded border px-2 py-0.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            cropping
              ? "border-sky-500/70 bg-sky-500/15 text-white hover:bg-sky-500/25"
              : "border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white"
          }`}
        >
          {cropping ? "Done" : "Edit crop"}
        </button>
      }
    >
      <div className="flex flex-wrap gap-1" role="group" aria-label="Aspect ratio">
        {ASPECT_PRESETS.map((preset) => {
          const active = preset.id === aspect.id;
          return (
            <button
              key={preset.id}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onAspectChange({ id: preset.id, portrait: aspect.portrait })}
              className={`rounded-md border px-2 py-1 text-[11px] tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                active
                  ? "border-sky-500/70 bg-sky-500/15 text-white"
                  : "border-zinc-800 bg-zinc-900/50 text-zinc-300 hover:border-zinc-600 hover:text-white"
              }`}
            >
              {aspectLabel(preset, aspect.portrait)}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="tabular-nums text-zinc-400">
          {size ? (
            <>
              {size.width} × {size.height} px
            </>
          ) : (
            "No photo open"
          )}
        </span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            disabled={disabled || !rotatable}
            onClick={() => onAspectChange({ id: aspect.id, portrait: !aspect.portrait })}
            title="Switch the ratio between landscape and portrait"
            className="rounded border border-zinc-800 px-2 py-0.5 text-zinc-300 hover:border-zinc-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Rotate ratio
          </button>
          {cropping && (
            <button
              type="button"
              onClick={onCancel}
              title="Discard the changes made since you started cropping (Esc)"
              className="rounded border border-zinc-800 px-2 py-0.5 text-zinc-300 hover:border-zinc-600 hover:text-white"
            >
              Cancel
            </button>
          )}
        </span>
      </div>

      {cropping && (
        <p className="text-[11px] leading-relaxed text-zinc-600">
          Drag the corners or edges on the photo to resize, or drag inside the box to move it. Press
          Enter when you&apos;re done.
        </p>
      )}
    </Section>
  );
}
