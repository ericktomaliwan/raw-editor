"use client";

interface Props {
  active: boolean;
  onBrowse: () => void;
}

export function DropZone({ active, onBrowse }: Props) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-8">
      <button
        type="button"
        onClick={onBrowse}
        className={`flex max-w-md flex-col items-center gap-4 rounded-2xl border-2 border-dashed px-12 py-14 text-center transition-colors ${
          active
            ? "border-sky-400 bg-sky-500/10"
            : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-600"
        }`}
      >
        <svg
          width="44"
          height="44"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={active ? "text-sky-300" : "text-zinc-500"}
          aria-hidden
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
        <div>
          <div className="text-base font-medium text-zinc-200">
            {active ? "Release to open" : "Drop a photo to start editing"}
          </div>
          <div className="mt-1 text-sm text-zinc-500">
            or <span className="text-zinc-300 underline underline-offset-2">browse</span> for a
            DNG, camera RAW, JPEG, PNG, WebP, AVIF or TIFF
          </div>
        </div>
        <div className="text-[11px] text-zinc-600">
          Everything runs locally in your browser — nothing is uploaded.
        </div>
      </button>
    </div>
  );
}
