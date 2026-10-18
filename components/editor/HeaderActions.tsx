"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import {
  EXPORT_FORMAT_ORDER,
  EXPORT_FORMATS,
  type ExportFormat,
  QUALITY_MAX,
  QUALITY_MIN,
} from "@/lib/exportFormat";
import { EXPORT_SIZES, type ExportSize } from "@/lib/exportSize";

interface Props {
  hasImage: boolean;
  /** Something Reset would undo: an adjustment differs from its default, or the photo is cropped. */
  edited: boolean;
  /** The original (unedited) image is currently being shown. */
  compare: boolean;
  exporting: boolean;
  exportFormat: ExportFormat;
  quality: number;
  exportSize: ExportSize;
  /** Long edge of the picture an export would save at full size (the crop), or null with no image. */
  fullLongEdge: number | null;
  onOpen: () => void;
  /** Show (true) or hide (false) the original image. */
  onCompareChange: (showOriginal: boolean) => void;
  onReset: () => void;
  onFormatChange: (format: ExportFormat) => void;
  onQualityChange: (quality: number) => void;
  onExportSizeChange: (size: ExportSize) => void;
  onExport: () => Promise<void>;
}

/**
 * The header's actions: open, compare, reset and the export controls.
 *
 * Wide screens get them inline in the header bar; below the `md` breakpoint
 * (phones) they collapse behind a hamburger button. Both are rendered and CSS
 * shows one, so there is no layout jump on hydration and no resize listener.
 * The hidden one is `display: none`, which also keeps it out of the tab order.
 */
export function HeaderActions(props: Props) {
  return (
    <>
      <div className="hidden items-center gap-3 md:flex">
        <InlineActions {...props} />
      </div>
      <div className="md:hidden">
        <HamburgerMenu {...props} />
      </div>
    </>
  );
}

/** Desktop: the actions as a row of buttons in the header bar. */
function InlineActions({
  hasImage,
  edited,
  compare,
  exporting,
  exportFormat,
  quality,
  exportSize,
  fullLongEdge,
  onOpen,
  onCompareChange,
  onReset,
  onFormatChange,
  onQualityChange,
  onExportSizeChange,
  onExport,
}: Props) {
  return (
    <>
      <AboutLink className="px-1 text-xs text-zinc-400 transition-colors hover:text-white" />
      <HeaderButton onClick={onOpen}>Open</HeaderButton>
      <HeaderButton
        disabled={!hasImage}
        active={compare}
        onMouseDown={() => onCompareChange(true)}
        onMouseUp={() => onCompareChange(false)}
        onMouseLeave={() => onCompareChange(false)}
        title="Hold to see the original (or press \)"
      >
        Before
      </HeaderButton>
      <HeaderButton
        disabled={!edited}
        onClick={onReset}
        title="Reset all edits, including the crop"
      >
        Reset
      </HeaderButton>
      <div className="flex items-stretch overflow-hidden rounded-md border border-zinc-700">
        <select
          value={exportFormat}
          onChange={(e) => onFormatChange(e.target.value as ExportFormat)}
          className="bg-zinc-900 px-2 text-[11px] text-zinc-300 outline-none"
          aria-label="Export format"
        >
          <FormatOptions />
        </select>
        {EXPORT_FORMATS[exportFormat].hasQuality && (
          <QualityField variant="inline" value={quality} onCommit={onQualityChange} />
        )}
        <SizeSelect
          variant="inline"
          value={exportSize}
          fullLongEdge={fullLongEdge}
          onChange={onExportSizeChange}
        />
        <button
          type="button"
          disabled={!hasImage || exporting}
          onClick={() => void onExport()}
          className="border-l border-zinc-700 bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {exporting ? "Exporting…" : "Export"}
        </button>
      </div>
    </>
  );
}

function HeaderButton({
  active,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={`rounded-md border px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "border-sky-500/70 bg-sky-500/15 text-white"
          : "border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white"
      } ${className}`}
    />
  );
}

/**
 * Phones: the same actions behind a hamburger button.
 *
 * It's a disclosure (button + panel), not an ARIA `menu`: the panel holds form
 * controls, which a `menu` role can't contain, and plain Tab order already
 * walks from the button into the panel. Closes on Escape, on a click outside,
 * and after an action runs. (Escape inside the quality field only cancels that
 * edit: the field stops the event before it reaches the window listener.)
 */
function HamburgerMenu({
  hasImage,
  edited,
  compare,
  exporting,
  exportFormat,
  quality,
  exportSize,
  fullLongEdge,
  onOpen,
  onCompareChange,
  onReset,
  onFormatChange,
  onQualityChange,
  onExportSizeChange,
  onExport,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // While open: close when the pointer goes down anywhere outside the button +
  // panel, or on Escape. Escape is listened for globally rather than on the
  // menu itself because focus isn't reliably inside it: Safari doesn't focus a
  // button when it's clicked. It must be `window`, not `document`: React
  // handles events at the document, so a `stopPropagation()` in a component
  // (the quality field uses one) only shields listeners further out than that.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  /** Run an action, then get the panel out of the way. */
  const act = (fn: () => void) => () => {
    fn();
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls={panelId}
        className={`grid h-8 w-8 place-items-center rounded-md border transition-colors ${
          open
            ? "border-zinc-500 bg-zinc-800 text-white"
            : "border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white"
        }`}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          {open ? <path d="M4 4l8 8M12 4l-8 8" /> : <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />}
        </svg>
      </button>

      {open && (
        <div
          id={panelId}
          className="absolute right-0 top-full z-40 mt-2 w-64 rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 shadow-2xl shadow-black/60"
        >
          <MenuItem onClick={act(onOpen)}>Open photo…</MenuItem>
          <MenuItem
            disabled={!hasImage}
            onClick={act(() => onCompareChange(!compare))}
            aria-pressed={compare}
            title="Switch between the original and your edit"
            trailing={
              <span className="flex items-center gap-2">
                {compare && <CheckIcon />}
                <kbd className="rounded border border-zinc-700 px-1 text-[10px] text-zinc-500">
                  \
                </kbd>
              </span>
            }
          >
            Show original
          </MenuItem>
          <MenuItem disabled={!edited} onClick={act(onReset)}>
            Reset all edits
          </MenuItem>

          <div className="my-1.5 h-px bg-zinc-800" />

          <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Export
          </div>
          <label className="flex items-center justify-between gap-3 px-2.5 py-1.5 text-xs text-zinc-300">
            Format
            <select
              value={exportFormat}
              onChange={(e) => onFormatChange(e.target.value as ExportFormat)}
              className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-zinc-500"
            >
              <FormatOptions />
            </select>
          </label>
          {EXPORT_FORMATS[exportFormat].hasQuality && (
            <QualityField variant="row" value={quality} onCommit={onQualityChange} />
          )}
          <SizeSelect
            variant="row"
            value={exportSize}
            fullLongEdge={fullLongEdge}
            onChange={onExportSizeChange}
          />
          <div className="px-1 pb-1 pt-1.5">
            <button
              type="button"
              disabled={!hasImage || exporting}
              // Stay open while encoding so the progress label is visible.
              onClick={() => void onExport().then(() => setOpen(false))}
              className="w-full rounded-md bg-zinc-100 px-3 py-2 text-xs font-medium text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {exporting ? "Exporting…" : "Export"}
            </button>
          </div>

          <div className="my-1.5 h-px bg-zinc-800" />
          <AboutLink
            onClick={() => setOpen(false)}
            className="flex w-full items-center rounded-md px-2.5 py-2 text-xs text-zinc-200 hover:bg-zinc-800 focus-visible:bg-zinc-800 focus-visible:outline-none"
          />
        </div>
      )}
    </div>
  );
}

/** The format menu's choices, shared by both layouts. */
function FormatOptions() {
  return EXPORT_FORMAT_ORDER.map((format) => (
    <option key={format} value={format}>
      {EXPORT_FORMATS[format].label}
    </option>
  ));
}

/**
 * Link to the About page. Opens in a new tab on purpose: the photo and edits
 * live only in this page's memory, so navigating away would discard them.
 */
function AboutLink(props: Omit<React.ComponentProps<typeof Link>, "href" | "target" | "children">) {
  return (
    <Link href="/about" target="_blank" {...props}>
      About
    </Link>
  );
}

function MenuItem({
  trailing,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { trailing?: React.ReactNode }) {
  return (
    <button
      type="button"
      {...props}
      className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-800 focus-visible:bg-zinc-800 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <span>{children}</span>
      {trailing}
    </button>
  );
}

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-sky-400"
      aria-hidden="true"
    >
      <path d="M2.5 6.5l2.5 2.5 4.5-5.5" />
    </svg>
  );
}

/**
 * Export size: full, or a long edge in pixels. Sizes that wouldn't shrink the
 * current picture are disabled (exports are never enlarged); if the chosen one
 * becomes such a size, say after a tighter crop, the export is simply full size.
 */
function SizeSelect({
  variant,
  value,
  fullLongEdge,
  onChange,
}: {
  variant: "inline" | "row";
  value: ExportSize;
  fullLongEdge: number | null;
  onChange: (size: ExportSize) => void;
}) {
  const hint = "Export size: the long edge of the saved file, in pixels";
  const select = (
    <select
      value={value ?? "full"}
      onChange={(e) => onChange(e.target.value === "full" ? null : Number(e.target.value))}
      className={
        variant === "inline"
          ? "border-l border-zinc-700 bg-zinc-900 px-2 text-[11px] text-zinc-300 outline-none"
          : "rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-zinc-500"
      }
      aria-label={variant === "inline" ? hint : undefined}
      title={hint}
    >
      <option value="full">{fullLongEdge ? `Full (${fullLongEdge} px)` : "Full size"}</option>
      {EXPORT_SIZES.map((edge) => (
        <option key={edge} value={edge} disabled={fullLongEdge !== null && edge >= fullLongEdge}>
          {edge} px
        </option>
      ))}
    </select>
  );
  if (variant === "inline") return select;
  return (
    <label
      className="flex items-center justify-between gap-3 px-2.5 py-1.5 text-xs text-zinc-300"
      title={hint}
    >
      Size
      {select}
    </label>
  );
}

/**
 * JPEG / WebP quality entry (1–100). Typing is free-form; the value is committed on
 * blur or Enter, rounded and clamped into range. Anything that isn't a number
 * is discarded and the previous value comes back. Escape cancels the edit.
 *
 * `inline` sits inside the header's export group; `row` is a labelled line in
 * the hamburger panel.
 */
function QualityField({
  variant,
  value,
  onCommit,
}: {
  variant: "inline" | "row";
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const commit = () => {
    if (draft !== null && !cancelled.current) {
      const v = parseFloat(draft);
      if (Number.isFinite(v)) {
        onCommit(Math.min(QUALITY_MAX, Math.max(QUALITY_MIN, Math.round(v))));
      }
    }
    cancelled.current = false;
    setDraft(null);
  };
  const hint = `Quality, ${QUALITY_MIN}–${QUALITY_MAX}. Lower numbers give a smaller file.`;
  return (
    <label
      className={
        variant === "inline"
          ? "flex items-center gap-1 border-l border-zinc-700 bg-zinc-900 pl-2 pr-1 text-[11px] text-zinc-500"
          : "flex items-center justify-between gap-3 px-2.5 py-1.5 text-xs text-zinc-300"
      }
      title={hint}
    >
      Quality
      <input
        type="text"
        inputMode="numeric"
        maxLength={5}
        className={
          variant === "inline"
            ? "w-7 bg-transparent text-right tabular-nums text-zinc-200 outline-none focus:text-white"
            : "w-14 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-right text-[11px] tabular-nums text-zinc-200 outline-none focus:border-zinc-500 focus:text-white"
        }
        value={draft ?? String(value)}
        onFocus={(e) => {
          setDraft(String(value));
          e.target.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            // Cancel the edit only; don't let it also close the menu.
            e.stopPropagation();
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
        aria-label={hint}
      />
    </label>
  );
}
