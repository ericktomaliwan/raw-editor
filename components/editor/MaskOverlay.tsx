"use client";

import { useRef, useState } from "react";
import type { CropRect } from "@/lib/crop";
import type { BrushStroke, Layer, LinearMask, MaskShape, RadialMask } from "@/lib/layers";
import { addStrokePoint, type BrushSettings } from "@/lib/masks/brush";
import {
  clientToUv,
  isoOf,
  linearEnd,
  linearGuides,
  linearMid,
  linearStart,
  moveLinear,
  moveLinearEnd,
  moveRadial,
  type RadialHandle,
  radialHandles,
  resizeRadial,
  rotateRadial,
  type UV,
  uvToPercent,
} from "@/lib/masks/geometry";

interface Props {
  imageWidth: number;
  imageHeight: number;
  /** The part of the image on screen, in image pixels. */
  view: CropRect;
  layer: Layer;
  /** Set while the brush is on: dragging paints with it instead of moving handles. */
  brush: (BrushSettings & { erase: boolean }) | null;
  /** The colour range eyedropper is waiting for a click. */
  picking: boolean;
  /** A handle moved. Changes with the same `gesture` are one undo step. */
  onMaskChange: (mask: MaskShape, gesture: string) => void;
  /** The stroke being painted, every time it grows; null when it's abandoned. */
  onStrokeChange: (stroke: BrushStroke | null) => void;
  /** The pointer was lifted: keep the stroke. */
  onStrokeEnd: (stroke: BrushStroke) => void;
  onPick: (uv: UV) => void;
}

type HandleId = "start" | "end" | "move" | "center" | "rotate" | RadialHandle;

type Drag =
  | { kind: "handle"; handle: HandleId; start: MaskShape; startUv: UV; gesture: string }
  | { kind: "paint"; stroke: BrushStroke };

/**
 * The selected layer's mask, drawn over the photo: the gradient guides and
 * their handles, the brush cursor while painting, a crosshair while picking a
 * colour. Laid exactly over the canvas, like the crop overlay.
 *
 * Guides are drawn in an SVG whose coordinates are image pixels (the view
 * rect is its viewBox); handles are HTML, positioned in percentages.
 */
export function MaskOverlay({
  imageWidth: W,
  imageHeight: H,
  view,
  layer,
  brush,
  picking,
  onMaskChange,
  onStrokeChange,
  onStrokeEnd,
  onPick,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  /** Brush cursor: position over the root and radius, in CSS pixels. */
  const [cursor, setCursor] = useState<{ x: number; y: number; r: number } | null>(null);

  const iso = isoOf(W, H);
  const long = Math.max(W, H);
  const mask = layer.mask;
  const editing = !brush && !picking; // handles take the pointer

  const toUv = (e: { clientX: number; clientY: number }): UV | null => {
    const el = rootRef.current;
    if (!el) return null;
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    return clientToUv(e.clientX, e.clientY, box, view, W, H);
  };

  const trackCursor = (e: React.PointerEvent) => {
    const el = rootRef.current;
    if (!brush || !el || e.pointerType === "touch") return;
    const box = el.getBoundingClientRect();
    setCursor({
      x: e.clientX - box.left,
      y: e.clientY - box.top,
      r: ((brush.size * long) / view.width) * box.width,
    });
  };

  const beginHandle = (handle: HandleId, e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const p = toUv(e);
    if (!p) return;
    e.preventDefault();
    e.stopPropagation();
    rootRef.current?.setPointerCapture(e.pointerId);
    drag.current = {
      kind: "handle",
      handle,
      start: mask,
      startUv: p,
      gesture: `drag-${e.timeStamp}`,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const p = toUv(e);
    if (!p) return;
    if (picking) {
      e.preventDefault();
      onPick(p);
      return;
    }
    if (!brush) return;
    e.preventDefault();
    rootRef.current?.setPointerCapture(e.pointerId);
    const stroke: BrushStroke = {
      // Alt (Option) flips the brush between adding and erasing for this stroke.
      erase: brush.erase !== e.altKey,
      size: brush.size,
      feather: brush.feather,
      flow: brush.flow,
      points: addStrokePoint([], p[0], p[1], brush.size, iso.sx, iso.sy),
    };
    drag.current = { kind: "paint", stroke };
    onStrokeChange(stroke);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    trackCursor(e);
    const d = drag.current;
    if (!d) return;
    if (d.kind === "paint") {
      // Every position since the last frame, so fast strokes stay smooth.
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
      let points = d.stroke.points;
      for (const ev of events.length ? events : [e]) {
        const p = toUv(ev);
        if (p) points = addStrokePoint(points, p[0], p[1], d.stroke.size, iso.sx, iso.sy);
      }
      if (points !== d.stroke.points) {
        d.stroke = { ...d.stroke, points };
        onStrokeChange(d.stroke);
      }
      return;
    }
    const p = toUv(e);
    if (!p) return;
    const next = dragMask(d.start, d.handle, p, d.startUv);
    if (next) onMaskChange(next, d.gesture);
  };

  const end = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    rootRef.current?.releasePointerCapture(e.pointerId);
    if (d.kind === "paint") {
      if (e.type === "pointercancel") onStrokeChange(null);
      else onStrokeEnd(d.stroke);
    }
  };

  function dragMask(start: MaskShape, handle: HandleId, p: UV, from: UV): MaskShape | null {
    const du = p[0] - from[0];
    const dv = p[1] - from[1];
    if (start.type === "linear") {
      if (handle === "move") return moveLinear(start, du, dv);
      if (handle === "start" || handle === "end") return moveLinearEnd(start, handle, p, iso);
    } else if (start.type === "radial") {
      if (handle === "center") return moveRadial(start, du, dv);
      if (handle === "rotate") return rotateRadial(start, p, iso);
      if (handle === "left" || handle === "right" || handle === "top" || handle === "bottom") {
        return resizeRadial(start, handle, p, iso);
      }
    }
    return null;
  }

  /** Arrow keys on the move handle nudge the whole mask, by 1% of the view. */
  const onHandleKey = (e: React.KeyboardEvent) => {
    const dir: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const k = dir[e.key];
    if (!k) return;
    e.preventDefault();
    const du = (k[0] * view.width) / 100 / W;
    const dv = (k[1] * view.height) / 100 / H;
    const gesture = "nudge";
    if (mask.type === "linear") onMaskChange(moveLinear(mask, du, dv), gesture);
    else if (mask.type === "radial") onMaskChange(moveRadial(mask, du, dv), gesture);
  };

  const at = (p: UV) => uvToPercent(p, view, W, H);
  const px = (p: UV): [number, number] => [p[0] * W, p[1] * H];

  return (
    <div
      ref={rootRef}
      // touch-none: on a touch screen a drag must paint or move, not scroll the page.
      // Not clipped, so a handle on (or past) the photo's edge can still be grabbed;
      // the SVG clips the guide lines to the photo itself.
      className={`absolute inset-0 touch-none select-none ${
        picking ? "cursor-crosshair" : brush ? "cursor-none" : ""
      }`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerLeave={() => setCursor(null)}
    >
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        {mask.type === "linear" && <LinearGuides mask={mask} iso={iso} px={px} />}
        {mask.type === "radial" && <RadialGuides mask={mask} long={long} W={W} H={H} iso={iso} />}
      </svg>

      {editing && mask.type === "linear" && (
        <>
          <Handle
            id="start"
            at={at(linearStart(mask))}
            label="Gradient start"
            onDown={beginHandle}
          />
          <Handle id="end" at={at(linearEnd(mask))} label="Gradient end" onDown={beginHandle} />
          <Handle
            id="move"
            at={at(linearMid(mask))}
            label="Move the gradient (arrow keys nudge it)"
            onDown={beginHandle}
            onKeyDown={onHandleKey}
            large
          />
        </>
      )}
      {editing && mask.type === "radial" && (
        <RadialHandles mask={mask} iso={iso} at={at} onDown={beginHandle} onKey={onHandleKey} />
      )}

      {brush && cursor && (
        <div
          className="pointer-events-none absolute rounded-full border border-white mix-blend-difference"
          style={{
            left: cursor.x - cursor.r,
            top: cursor.y - cursor.r,
            width: cursor.r * 2,
            height: cursor.r * 2,
          }}
        >
          <div
            className="absolute rounded-full border border-dashed border-white/70"
            style={{ inset: `${(brush.feather / 100) * cursor.r}px` }}
          />
        </div>
      )}
    </div>
  );
}

function LinearGuides({
  mask,
  iso,
  px,
}: {
  mask: LinearMask;
  iso: ReturnType<typeof isoOf>;
  px: (p: UV) => [number, number];
}) {
  const lines = linearGuides(mask, iso);
  return (
    <>
      {lines.map(([a, b], i) => {
        const [x1, y1] = px(a);
        const [x2, y2] = px(b);
        return (
          <g key={i}>
            <line
              {...{ x1, y1, x2, y2 }}
              stroke="rgb(0 0 0 / 0.45)"
              strokeWidth={3}
              vectorEffect="non-scaling-stroke"
            />
            <line
              {...{ x1, y1, x2, y2 }}
              stroke="white"
              strokeWidth={1.25}
              strokeDasharray={i === 1 ? "6 4" : undefined}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
    </>
  );
}

function RadialGuides({
  mask,
  long,
  W,
  H,
  iso,
}: {
  mask: RadialMask;
  long: number;
  W: number;
  H: number;
  iso: ReturnType<typeof isoOf>;
}) {
  const cx = mask.cx * W;
  const cy = mask.cy * H;
  const rotate = `rotate(${(mask.angle * 180) / Math.PI} ${cx} ${cy})`;
  const inner = 1 - mask.feather / 100;
  const h = radialHandles(mask, iso);
  return (
    <>
      <ellipse
        {...{ cx, cy, rx: mask.rx * long, ry: mask.ry * long }}
        transform={rotate}
        fill="none"
        stroke="rgb(0 0 0 / 0.45)"
        strokeWidth={3}
        vectorEffect="non-scaling-stroke"
      />
      <ellipse
        {...{ cx, cy, rx: mask.rx * long, ry: mask.ry * long }}
        transform={rotate}
        fill="none"
        stroke="white"
        strokeWidth={1.25}
        vectorEffect="non-scaling-stroke"
      />
      {inner > 0.02 && inner < 0.98 && (
        <ellipse
          {...{ cx, cy, rx: mask.rx * long * inner, ry: mask.ry * long * inner }}
          transform={rotate}
          fill="none"
          stroke="white"
          strokeOpacity={0.6}
          strokeWidth={1}
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <line
        x1={h.top[0] * W}
        y1={h.top[1] * H}
        x2={h.rotate[0] * W}
        y2={h.rotate[1] * H}
        stroke="white"
        strokeOpacity={0.8}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    </>
  );
}

function RadialHandles({
  mask,
  iso,
  at,
  onDown,
  onKey,
}: {
  mask: RadialMask;
  iso: ReturnType<typeof isoOf>;
  at: (p: UV) => { left: string; top: string };
  onDown: (id: HandleId, e: React.PointerEvent) => void;
  onKey: (e: React.KeyboardEvent) => void;
}) {
  const h = radialHandles(mask, iso);
  const sides: [RadialHandle, string][] = [
    ["left", "Resize the width"],
    ["right", "Resize the width"],
    ["top", "Resize the height"],
    ["bottom", "Resize the height"],
  ];
  return (
    <>
      {sides.map(([id, label]) => (
        <Handle key={id} id={id} at={at(h[id])} label={label} onDown={onDown} />
      ))}
      <Handle id="rotate" at={at(h.rotate)} label="Rotate" onDown={onDown} round />
      <Handle
        id="center"
        at={at(h.center)}
        label="Move the ellipse (arrow keys nudge it)"
        onDown={onDown}
        onKeyDown={onKey}
        large
      />
    </>
  );
}

function Handle({
  id,
  at,
  label,
  onDown,
  onKeyDown,
  large,
  round,
}: {
  id: HandleId;
  at: { left: string; top: string };
  label: string;
  onDown: (id: HandleId, e: React.PointerEvent) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  large?: boolean;
  round?: boolean;
}) {
  return (
    <div
      data-mask-handle={id}
      role={onKeyDown ? "button" : undefined}
      tabIndex={onKeyDown ? 0 : undefined}
      aria-label={label}
      title={label}
      onPointerDown={(e) => onDown(id, e)}
      onKeyDown={onKeyDown}
      // A 28px hit area around a small visible dot.
      className={`absolute grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
        id === "move" || id === "center"
          ? "cursor-move"
          : id === "rotate"
            ? "cursor-grab"
            : "cursor-pointer"
      }`}
      style={at}
    >
      <span
        className={`block rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.5)] ${
          large ? "size-3.5 bg-sky-500" : round ? "size-2.5 bg-white" : "size-2.5 bg-zinc-900"
        }`}
      />
    </div>
  );
}
