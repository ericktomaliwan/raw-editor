"use client";

import { useId, useRef, useState } from "react";

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  onChange: (value: number) => void;
  /** Optional gradient shown behind the track (CSS background). */
  track?: string;
  disabled?: boolean;
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  defaultValue = 0,
  onChange,
  track,
  disabled,
}: SliderProps) {
  const id = useId();
  const decimals = step < 1 ? Math.max(0, -Math.floor(Math.log10(step))) : 0;
  const display = value > 0 && min < 0 ? `+${value.toFixed(decimals)}` : value.toFixed(decimals);
  const isDefault = Math.abs(value - defaultValue) < step / 2;
  const pct = ((value - min) / (max - min)) * 100;
  const zeroPct = ((defaultValue - min) / (max - min)) * 100;

  return (
    <div
      className={`group flex flex-col gap-1 ${disabled ? "opacity-40 pointer-events-none" : ""}`}
    >
      <div className="flex items-center justify-between text-xs">
        <label
          htmlFor={id}
          className="text-zinc-400 group-hover:text-zinc-200 select-none"
          onDoubleClick={() => onChange(defaultValue)}
          title="Double-click to reset"
        >
          {label}
        </label>
        <ValueField
          label={label}
          display={display}
          muted={isDefault}
          onCommit={(v) => onChange(Math.max(min, Math.min(max, v)))}
        />
      </div>
      <div className="relative h-4 flex items-center">
        <div
          className="absolute inset-x-0 h-[3px] rounded-full bg-zinc-800"
          style={track ? { background: track } : undefined}
        />
        {!track && (
          <div
            className="absolute h-[3px] rounded-full bg-zinc-400"
            style={{
              left: `${Math.min(pct, zeroPct)}%`,
              width: `${Math.abs(pct - zeroPct)}%`,
            }}
          />
        )}
        {min < 0 && !track && (
          <div className="absolute h-2 w-px bg-zinc-600" style={{ left: `${zeroPct}%` }} />
        )}
        <input
          id={id}
          type="range"
          className="slider absolute inset-x-0 w-full"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          onDoubleClick={() => onChange(defaultValue)}
        />
      </div>
    </div>
  );
}

/**
 * Editable numeric readout. A text input (not type=number) so signed
 * "+12" values display, with edits committed on blur / Enter.
 */
function ValueField({
  label,
  display,
  muted,
  onCommit,
}: {
  label: string;
  display: string;
  muted: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const commit = () => {
    if (draft !== null && !cancelled.current) {
      const v = parseFloat(draft);
      if (Number.isFinite(v)) onCommit(v);
    }
    cancelled.current = false;
    setDraft(null);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      className={`w-14 bg-transparent text-right tabular-nums outline-none focus:text-white ${
        muted ? "text-zinc-500" : "text-zinc-200"
      }`}
      value={draft ?? display}
      onFocus={(e) => {
        setDraft(display);
        e.target.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      aria-label={`${label} value`}
    />
  );
}
