"use client";

import { useState, type ReactNode } from "react";

interface SectionProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Shows a dot when the section has non-default values. */
  modified?: boolean;
  onReset?: () => void;
  actions?: ReactNode;
}

export function Section({
  title,
  children,
  defaultOpen = true,
  modified,
  onReset,
  actions,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-zinc-800">
      <div className="flex items-center gap-2 px-4 py-2.5 hover:bg-zinc-900/60">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center gap-2 text-left text-[13px] font-medium text-zinc-200"
          aria-expanded={open}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            className={`text-zinc-500 transition-transform ${open ? "rotate-90" : ""}`}
            aria-hidden
          >
            <path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          {title}
          {modified && (
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400" aria-label="modified" />
          )}
        </button>
        {actions}
        {onReset && modified && (
          <button
            type="button"
            onClick={onReset}
            className="text-[11px] text-zinc-500 hover:text-zinc-200"
            title="Reset section"
          >
            Reset
          </button>
        )}
      </div>
      {open && <div className="flex flex-col gap-3 px-4 pb-4 pt-1">{children}</div>}
    </section>
  );
}
