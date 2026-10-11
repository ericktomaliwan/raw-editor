"use client";

import { useRef, useState, type DragEvent } from "react";
import type { Preset } from "@/lib/xmp";
import { Section } from "./Section";

interface Props {
  presets: Preset[];
  activeId: string | null;
  onApply: (preset: Preset) => void;
  onImportFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
}

export function PresetsPanel({
  presets,
  activeId,
  onApply,
  onImportFiles,
  onRemove,
  disabled,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // Built-in presets get their own block at the top. They are kept apart by
  // source, not by group name, so an imported pack that happens to be called
  // "Built-in" can't merge into it.
  const builtin = presets.filter((p) => p.source === "builtin");
  const imported = presets.filter((p) => p.source !== "builtin");

  // Imported: group by the preset's own group name (carried in the .xmp), in import order.
  const groups = new Map<string, Preset[]>();
  for (const p of imported) {
    const g = p.group?.trim() || "Imported";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(p);
  }
  const ordered: { key: string; label: string; items: Preset[] }[] = [
    ...(builtin.length ? [{ key: "builtin", label: "Built-in", items: builtin }] : []),
    ...[...groups.entries()].map(([label, items]) => ({ key: `imported:${label}`, label, items })),
  ];

  // Actual file handling happens in the window-level drop handler (Editor),
  // which routes .xmp files to the preset importer. This only drives the hover UI.
  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) setDragging(true);
  };

  return (
    <Section
      title="Presets"
      actions={
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:border-zinc-500 hover:text-white"
        >
          Import .xmp
        </button>
      }
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xmp,application/rdf+xml,text/xml,application/xml"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onImportFiles(files);
          e.target.value = "";
        }}
      />
      <div
        onDragOver={onDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={() => setDragging(false)}
        className={`-mx-1 flex flex-col gap-3 rounded-md px-1 transition-colors ${
          dragging ? "bg-sky-500/10 outline outline-1 outline-sky-500/60" : ""
        }`}
      >
        {ordered.map(({ key, label, items }) => (
          <div key={key} className="flex flex-col gap-1">
            <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              {label}
            </div>
            <div className="grid grid-cols-2 gap-1">
              {items.map((p) => {
                const active = p.id === activeId;
                return (
                  <div key={p.id} className="group/preset relative">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onApply(p)}
                      title={p.name}
                      className={`w-full truncate rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors disabled:opacity-40 ${
                        active
                          ? "border-sky-500/70 bg-sky-500/15 text-white"
                          : "border-zinc-800 bg-zinc-900/50 text-zinc-300 hover:border-zinc-600 hover:text-white"
                      }`}
                    >
                      {p.name}
                    </button>
                    {/* Only the user's own presets can be removed. */}
                    {p.source === "imported" && (
                      <button
                        type="button"
                        onClick={() => onRemove(p.id)}
                        className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-zinc-700 text-[10px] text-zinc-200 hover:bg-red-600 group-hover/preset:flex"
                        title="Remove preset"
                        aria-label={`Remove ${p.name}`}
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {imported.length === 0 ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-md border border-dashed border-zinc-800 px-3 py-4 text-center text-[11px] leading-relaxed text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
          >
            Add your own. Drop <span className="text-zinc-400">.xmp</span> files or a folder
            here, or click to import.
          </button>
        ) : (
          <p className="text-[11px] leading-relaxed text-zinc-600">
            Drop <span className="text-zinc-500">.xmp</span> files or a folder here to add more.
          </p>
        )}
      </div>
    </Section>
  );
}
