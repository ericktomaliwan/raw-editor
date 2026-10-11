"use client";

import { useRef, useState } from "react";
import { type CropHandle, type CropRect, moveRect, resizeRect } from "@/lib/crop";

interface Props {
  imageWidth: number;
  imageHeight: number;
  /** Current crop, in image pixels. */
  rect: CropRect;
  /** Width / height to hold while resizing, or null for a free crop. */
  ratio: number | null;
  onChange: (rect: CropRect) => void;
}

type ResizeHandle = Exclude<CropHandle, "move">;

/** Hit areas for resizing: where each sits on the box, and its cursor. */
const HANDLES: { id: ResizeHandle; className: string }[] = [
  // Edges first so the corners, listed after, sit on top where they overlap.
  { id: "n", className: "inset-x-3 -top-2 h-4 cursor-ns-resize" },
  { id: "s", className: "inset-x-3 -bottom-2 h-4 cursor-ns-resize" },
  { id: "w", className: "inset-y-3 -left-2 w-4 cursor-ew-resize" },
  { id: "e", className: "inset-y-3 -right-2 w-4 cursor-ew-resize" },
  { id: "nw", className: "-left-3 -top-3 size-7 cursor-nwse-resize" },
  { id: "ne", className: "-right-3 -top-3 size-7 cursor-nesw-resize" },
  { id: "sw", className: "-bottom-3 -left-3 size-7 cursor-nesw-resize" },
  { id: "se", className: "-bottom-3 -right-3 size-7 cursor-nwse-resize" },
];

/** The visible corner brackets and edge ticks (decoration only). */
const MARKS = [
  "left-0 top-0 size-4 border-l-2 border-t-2",
  "right-0 top-0 size-4 border-r-2 border-t-2",
  "bottom-0 left-0 size-4 border-b-2 border-l-2",
  "bottom-0 right-0 size-4 border-b-2 border-r-2",
  "left-1/2 top-0 h-0 w-5 -translate-x-1/2 border-t-2",
  "bottom-0 left-1/2 h-0 w-5 -translate-x-1/2 border-b-2",
  "left-0 top-1/2 h-5 w-0 -translate-y-1/2 border-l-2",
  "right-0 top-1/2 h-5 w-0 -translate-y-1/2 border-r-2",
];

/**
 * The draggable crop box, laid exactly over the canvas while the whole image
 * is on screen. Drag a corner or edge to resize, drag inside to move. The
 * pixel size of the crop is shown on the box and updates as you drag.
 *
 * All positions are percentages of the image, so the overlay needs no layout
 * measurement to draw; it only measures itself at the start of a drag to
 * convert pointer movement into image pixels.
 */
export function CropOverlay({ imageWidth, imageHeight, rect, ratio, onChange }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  // Everything a drag needs is captured when it starts, so each move is
  // computed from the original crop, not from the previous frame's result.
  const drag = useRef<{
    handle: CropHandle;
    start: CropRect;
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  const commit = (next: CropRect) => {
    if (
      next.x !== rect.x ||
      next.y !== rect.y ||
      next.width !== rect.width ||
      next.height !== rect.height
    ) {
      onChange(next);
    }
  };

  // Called from the handlers below with the event (not curried: a function
  // that returns a handler would be run during render, where refs are off limits).
  const begin = (handle: CropHandle, e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = rootRef.current;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height) return;
    // Capture on the root so the drag keeps tracking outside the box and the image.
    el.setPointerCapture(e.pointerId);
    drag.current = {
      handle,
      start: rect,
      x: e.clientX,
      y: e.clientY,
      scaleX: imageWidth / box.width,
      scaleY: imageHeight / box.height,
    };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) * d.scaleX;
    const dy = (e.clientY - d.y) * d.scaleY;
    commit(
      d.handle === "move"
        ? moveRect(d.start, dx, dy, imageWidth, imageHeight)
        : resizeRect(d.start, d.handle, dx, dy, ratio, imageWidth, imageHeight),
    );
  };

  const end = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    rootRef.current?.releasePointerCapture(e.pointerId);
  };

  // Keyboard: arrows move the crop, Shift+arrows resize it from the bottom-right corner.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const dir: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const d = dir[e.key];
    if (!d) return;
    e.preventDefault();
    const step = Math.max(1, Math.round(Math.max(imageWidth, imageHeight) / 100));
    commit(
      e.shiftKey
        ? resizeRect(rect, "se", d[0] * step, d[1] * step, ratio, imageWidth, imageHeight)
        : moveRect(rect, d[0] * step, d[1] * step, imageWidth, imageHeight),
    );
  };

  const pct = (v: number, total: number) => `${(v / total) * 100}%`;

  return (
    <div
      ref={rootRef}
      // touch-none: on a touch screen the drag must move the crop, not scroll the page.
      className="absolute inset-0 touch-none select-none overflow-hidden"
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div
        role="group"
        aria-label={`Crop area, ${rect.width} by ${rect.height} pixels. Arrow keys move it, Shift plus arrow keys resize it.`}
        tabIndex={0}
        onPointerDown={(e) => begin("move", e)}
        onKeyDown={onKeyDown}
        className="absolute cursor-move outline outline-1 outline-white/90 focus-visible:outline-2 focus-visible:outline-sky-400"
        style={{
          left: pct(rect.x, imageWidth),
          top: pct(rect.y, imageHeight),
          width: pct(rect.width, imageWidth),
          height: pct(rect.height, imageHeight),
          // One huge shadow dims everything outside the box; the root clips it to the image.
          boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.6)",
        }}
      >
        {/* Rule-of-thirds guides */}
        <div className="pointer-events-none absolute inset-y-0 left-1/3 w-1/3 border-x border-white/25" />
        <div className="pointer-events-none absolute inset-x-0 top-1/3 h-1/3 border-y border-white/25" />

        {MARKS.map((className) => (
          <div key={className} className={`pointer-events-none absolute border-white ${className}`} />
        ))}

        {/* Live size of the crop, in pixels of the exported image. */}
        <div
          data-crop-size
          className={`pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white ${
            dragging ? "bg-sky-600" : "bg-black/75"
          }`}
        >
          {rect.width} × {rect.height}
        </div>

        {HANDLES.map(({ id, className }) => (
          <div
            key={id}
            data-crop-handle={id}
            onPointerDown={(e) => begin(id, e)}
            className={`absolute ${className}`}
          />
        ))}
      </div>
    </div>
  );
}
