"use client";

/** Small controls shared by the adjustment and layer panels. */

export const HUE_TRACK =
  "linear-gradient(90deg,#f00 0%,#ff0 17%,#0f0 33%,#0ff 50%,#00f 67%,#f0f 83%,#f00 100%)";

export const TEMPERATURE_TRACK = "linear-gradient(90deg,#3b82f6,#a1a1aa,#f59e0b)";
export const TINT_TRACK = "linear-gradient(90deg,#22c55e,#a1a1aa,#d946ef)";

export function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
      {children}
    </div>
  );
}

export function ToggleButton({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`rounded px-2.5 py-0.5 text-[11px] ${
        active ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}

/** A row of mutually exclusive ToggleButtons. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-zinc-500">{label}</span>
      <div
        className="ml-auto flex rounded-md border border-zinc-800 p-0.5"
        role="group"
        aria-label={label}
      >
        {options.map(([v, text]) => (
          <ToggleButton key={v} active={value === v} onClick={() => onChange(v)}>
            {text}
          </ToggleButton>
        ))}
      </div>
    </div>
  );
}
