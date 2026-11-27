"use client";

import { LAYER_KINDS, type Layer, type LayerKind, MAX_LAYERS } from "@/lib/layers";
import { Section } from "./Section";

interface Props {
  layers: readonly Layer[];
  selectedId: string | null;
  disabled?: boolean;
  onAdd: (kind: LayerKind) => void;
  onSelect: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onDelete: (id: string) => void;
  /** The section's Reset: remove every layer. */
  onDeleteAll: () => void;
  /** False when the panel is a column of its own, where folding it away makes no sense. */
  collapsible?: boolean;
}

/** The list of layers (local adjustments) and the buttons that add one. */
export function LayersPanel({
  layers,
  selectedId,
  disabled,
  onAdd,
  onSelect,
  onToggleVisible,
  onDelete,
  onDeleteAll,
  collapsible = true,
}: Props) {
  const full = layers.length >= MAX_LAYERS;
  return (
    <Section
      title="Layers"
      modified={layers.length > 0}
      onReset={onDeleteAll}
      collapsible={collapsible}
    >
      {layers.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-zinc-500">
          Adjust part of the photo: add a gradient, paint with a brush, or pick out a range of tones
          or colors.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5" aria-label="Layers">
          {layers.map((layer) => {
            const selected = layer.id === selectedId;
            return (
              <li
                key={layer.id}
                className={`flex items-center gap-1 rounded-md pr-1 ${
                  selected ? "bg-zinc-800" : "hover:bg-zinc-900"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onToggleVisible(layer.id)}
                  aria-pressed={layer.visible}
                  aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`}
                  title={layer.visible ? "Hide layer" : "Show layer"}
                  className="grid size-7 shrink-0 place-items-center text-zinc-400 hover:text-zinc-100"
                >
                  <EyeIcon open={layer.visible} />
                </button>
                <button
                  type="button"
                  onClick={() => onSelect(layer.id)}
                  aria-current={selected ? "true" : undefined}
                  className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-xs ${
                    layer.visible ? "text-zinc-200" : "text-zinc-500"
                  }`}
                >
                  <MaskIcon type={iconFor(layer)} />
                  <span className="truncate">{layer.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(layer.id)}
                  aria-label={`Delete ${layer.name}`}
                  title="Delete layer"
                  className="grid size-6 shrink-0 place-items-center rounded text-zinc-500 hover:bg-zinc-700 hover:text-zinc-100"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                    <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          Add layer
        </span>
        <div className="grid grid-cols-5 gap-1">
          {LAYER_KINDS.map(({ kind, label }) => (
            <button
              key={kind}
              type="button"
              disabled={disabled || full}
              onClick={() => onAdd(kind)}
              title={full ? `A photo can have up to ${MAX_LAYERS} layers` : `Add a ${label} layer`}
              className="flex flex-col items-center gap-1 rounded-md border border-zinc-800 px-1 py-1.5 text-[10px] text-zinc-300 hover:border-zinc-600 hover:text-white disabled:pointer-events-none disabled:opacity-40"
            >
              <MaskIcon type={kind} />
              {label}
            </button>
          ))}
        </div>
        {full && (
          <p className="text-[11px] text-zinc-500">
            That&apos;s the most layers a photo can have ({MAX_LAYERS}).
          </p>
        )}
      </div>
    </Section>
  );
}

/** A range-only layer shows which range it uses. */
function iconFor(layer: Layer): LayerKind {
  if (layer.mask.type !== "range") return layer.mask.type;
  return layer.color && !layer.luminance ? "color" : "luminance";
}

function MaskIcon({ type }: { type: LayerKind }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 14 14",
    "aria-hidden": true,
    className: "shrink-0 text-zinc-400",
  } as const;
  switch (type) {
    case "linear":
      return (
        <svg {...common}>
          <rect x="1.5" y="1.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" />
          <rect x="2" y="2" width="10" height="3" fill="currentColor" />
          <rect x="2" y="5.5" width="10" height="2.5" fill="currentColor" fillOpacity="0.55" />
          <rect x="2" y="8.5" width="10" height="2" fill="currentColor" fillOpacity="0.2" />
        </svg>
      );
    case "radial":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" />
          <circle cx="7" cy="7" r="2.5" fill="currentColor" />
        </svg>
      );
    case "brush":
      return (
        <svg {...common}>
          <path
            d="M2 11c2 0 3-1 3-2.5S6.5 6 8 6l4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
    case "luminance":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" />
          <path d="M7 1.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" />
        </svg>
      );
    case "color":
      return (
        <svg {...common}>
          <circle cx="5" cy="5.5" r="3.5" fill="#ef4444" fillOpacity="0.8" />
          <circle cx="9" cy="5.5" r="3.5" fill="#22c55e" fillOpacity="0.8" />
          <circle cx="7" cy="9" r="3.5" fill="#3b82f6" fillOpacity="0.8" />
        </svg>
      );
  }
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <path
        d="M1 7s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      {open ? (
        <circle cx="7" cy="7" r="1.8" fill="currentColor" />
      ) : (
        <path d="M2 12L12 2" stroke="currentColor" strokeWidth="1.2" />
      )}
    </svg>
  );
}
