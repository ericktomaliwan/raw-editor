interface Props {
  /** How long the running export is expected to take, or null when none is running. */
  estimateMs: number | null;
}

/**
 * Thin bar along the bottom edge of the header while an export runs.
 *
 * It shows an estimate, not a measurement: each encoder is a single call that
 * reports nothing until it returns. The bar covers 90% in the estimated time
 * and creeps after that, so a slow export never looks finished early; when the
 * export ends it fills and fades out.
 *
 * The motion is a CSS animation on `transform` (see `.export-progress` in
 * app/globals.css), so it needs no re-renders and keeps moving while the main
 * thread is busy with the full-size render.
 */
export function ExportProgress({ estimateMs }: Props) {
  const active = estimateMs !== null;
  return (
    <div
      role="progressbar"
      aria-label="Exporting"
      aria-hidden={!active}
      className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 overflow-hidden"
    >
      <div
        className={`h-full origin-left bg-zinc-100 ${
          active ? "export-progress" : "opacity-0 transition-opacity duration-500"
        }`}
        // Four times the estimate: the keyframes spend the first quarter
        // reaching 90% and the rest creeping towards the end.
        style={active ? { animationDuration: `${Math.round(estimateMs * 4)}ms` } : undefined}
      />
    </div>
  );
}
