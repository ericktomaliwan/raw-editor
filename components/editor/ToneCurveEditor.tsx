"use client";

import { useEffect, useRef, useState } from "react";
import type { Adjustments, CurvePoint } from "@/lib/adjustments";
import {
  curvePath,
  editableCurve,
  insertCurvePoint,
  isIdentity,
  moveCurvePoint,
  nearestCurvePoint,
  removeCurvePoint,
  storedCurve,
} from "@/lib/curve";

interface Props {
  adjustments: Adjustments;
  /** A point moved. Changes with the same `gesture` merge into one undo step. */
  onChange: (patch: Partial<Adjustments>, gesture: string) => void;
  /** A point removed or a curve cleared: an undo step of its own. */
  onDiscreteChange: (patch: Partial<Adjustments>) => void;
  disabled?: boolean;
}

const CHANNELS = [
  { key: "toneCurve", label: "RGB", color: "#e4e4e7" },
  { key: "toneCurveRed", label: "Red", color: "#ef4444" },
  { key: "toneCurveGreen", label: "Green", color: "#22c55e" },
  { key: "toneCurveBlue", label: "Blue", color: "#3b82f6" },
] as const;

/** Room around the 0..255 plot, so a point in a corner can be grabbed from any side. */
const PAD = 8;
const VIEW_SIZE = 255 + PAD * 2;
const GRID_LINES = [0.25, 0.5, 0.75].map((f) => f * 255);
/** How close to a point a press must land to grab it, in CSS pixels. */
const GRAB_RADIUS_PX = { mouse: 10, touch: 20 };
/** Movement below this, in CSS pixels, is a shaky click and not a drag. */
const DRAG_THRESHOLD_PX = 3;
const DOUBLE_PRESS_MS = 350;

/**
 * The draggable point curve: press empty space to add a point, drag a point to
 * move it, double-click it (or Delete) to remove it, arrow keys to nudge it.
 *
 * Pointer events sit on the root with capture, so a point keeps following the
 * pointer outside the graph, and a press grabs the nearest point within reach
 * instead of needing to land on its small dot. Double presses are detected here
 * because `dblclick` isn't dependable on touch screens.
 */
export function ToneCurveEditor({ adjustments, onChange, onDiscreteChange, disabled }: Props) {
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>(CHANNELS[0]);
  const [selected, setSelected] = useState<number | null>(null);
  const selectedRef = useRef<SVGCircleElement>(null);
  // Everything a drag needs is captured when it starts, so each move is
  // computed from the original point, not from the previous frame's result.
  const drag = useRef<{
    pointerId: number;
    gesture: string;
    start: CurvePoint[];
    index: number;
    clientX: number;
    clientY: number;
    scale: number;
    moved: boolean;
  } | null>(null);
  const lastPress = useRef<{ index: number; at: number } | null>(null);

  const stored = adjustments[channel.key];
  const points = editableCurve(stored);
  const active = selected === null ? undefined : points[selected];

  // Keep keyboard focus on the point being worked on, including one a press just added.
  useEffect(() => {
    selectedRef.current?.focus({ preventScroll: true });
  }, [selected]);

  const commit = (next: CurvePoint[], gesture: string) => {
    if (JSON.stringify(next) === JSON.stringify(points)) return;
    onChange({ [channel.key]: storedCurve(next) }, gesture);
  };

  const remove = (index: number) => {
    const next = removeCurvePoint(points, index);
    if (next === points) return false;
    onDiscreteChange({ [channel.key]: storedCurve(next) });
    setSelected(index - 1);
    return true;
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    const box = e.currentTarget.getBoundingClientRect();
    if (!box.width) return;
    const scale = VIEW_SIZE / box.width;
    const x = (e.clientX - box.left) * scale - PAD;
    const y = 255 - ((e.clientY - box.top) * scale - PAD);
    const radius =
      (e.pointerType === "touch" ? GRAB_RADIUS_PX.touch : GRAB_RADIUS_PX.mouse) * scale;
    // The press time tells this drag apart from the last one, even on the same channel.
    const gesture = `drag-${e.timeStamp}`;

    let start = points;
    let index = nearestCurvePoint(points, x, y, radius);
    if (index === -1) {
      const inserted = insertCurvePoint(points, x, y);
      if (!inserted) return;
      start = inserted.points;
      index = inserted.index;
      lastPress.current = null;
      commit(start, gesture);
    } else {
      const last = lastPress.current;
      const isDouble = last?.index === index && e.timeStamp - last.at < DOUBLE_PRESS_MS;
      lastPress.current = isDouble ? null : { index, at: e.timeStamp };
      if (isDouble && remove(index)) return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      pointerId: e.pointerId,
      gesture,
      start,
      index,
      clientX: e.clientX,
      clientY: e.clientY,
      scale,
      moved: false,
    };
    setSelected(index);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.clientX;
    const dy = e.clientY - d.clientY;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    d.moved = true;
    lastPress.current = null;
    const [x, y] = d.start[d.index];
    commit(moveCurvePoint(d.start, d.index, x + dx * d.scale, y - dy * d.scale), d.gesture);
  };

  const end = (e: React.PointerEvent) => {
    if (drag.current?.pointerId === e.pointerId) drag.current = null;
  };

  // Keyboard: arrows nudge the focused point (Shift for bigger steps), Delete removes it.
  const onPointKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove(index);
      return;
    }
    const dir: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, 1],
      ArrowDown: [0, -1],
    };
    const d = dir[e.key];
    if (!d) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const [x, y] = points[index];
    commit(moveCurvePoint(points, index, x + d[0] * step, y + d[1] * step), `nudge-${index}`);
  };

  return (
    <div
      className={`mx-auto flex w-full max-w-80 flex-col gap-2 ${
        disabled ? "pointer-events-none opacity-40" : ""
      }`}
    >
      <div className="flex rounded-md border border-zinc-800 p-0.5">
        {CHANNELS.map((c) => (
          <button
            key={c.key}
            type="button"
            disabled={disabled}
            aria-pressed={c.key === channel.key}
            onClick={() => {
              setChannel(c);
              setSelected(null);
            }}
            className={`flex-1 rounded px-2 py-1 text-[11px] ${
              c.key === channel.key ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <svg
        viewBox={`${-PAD} ${-PAD} ${VIEW_SIZE} ${VIEW_SIZE}`}
        role="group"
        aria-label={`${channel.label} tone curve. Arrow keys move a point, Shift plus arrow keys move it further, Delete removes it.`}
        // touch-none: on a touch screen the drag must move the point, not scroll the panel.
        className="block aspect-square w-full cursor-crosshair touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        // A press focuses its point itself; the browser's default would then take that focus away.
        onMouseDown={(e) => e.preventDefault()}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSelected(null);
        }}
      >
        <rect width={255} height={255} className="fill-zinc-900/60 stroke-zinc-800" />
        {GRID_LINES.map((v) => (
          <path key={v} d={`M${v} 0V255M0 ${v}H255`} className="stroke-zinc-800" />
        ))}
        <path d="M0 255L255 0" className="stroke-zinc-700" />

        {/* The other channels' curves, faintly: they change the picture from any tab. */}
        {CHANNELS.filter((c) => c.key !== channel.key && !isIdentity(adjustments[c.key])).map(
          (c) => (
            <path
              key={c.key}
              d={curvePath(adjustments[c.key])}
              fill="none"
              stroke={c.color}
              strokeOpacity={0.6}
            />
          ),
        )}

        <path d={curvePath(points)} fill="none" stroke={channel.color} strokeWidth={1.5} />

        {points.map(([x, y], i) => (
          <circle
            key={i}
            ref={i === selected ? selectedRef : undefined}
            cx={x}
            cy={255 - y}
            r={i === selected ? 5 : 4}
            fill={i === selected ? channel.color : "#09090b"}
            stroke={channel.color}
            strokeWidth={1.5}
            className="cursor-grab outline-none focus-visible:stroke-sky-400"
            tabIndex={disabled ? undefined : 0}
            role="slider"
            aria-label="Curve point"
            aria-valuemin={0}
            aria-valuemax={255}
            aria-valuenow={Math.round(y)}
            aria-valuetext={`Input ${Math.round(x)}, output ${Math.round(y)}`}
            onFocus={() => setSelected(i)}
            onKeyDown={(e) => onPointKeyDown(e, i)}
          />
        ))}
      </svg>

      <div className="flex min-h-4 items-center justify-between gap-2 text-[11px] text-zinc-500">
        {active ? (
          <span className="tabular-nums text-zinc-300">
            Input {Math.round(active[0])} · Output {Math.round(active[1])}
          </span>
        ) : (
          <span>Click to add, drag to move, double-click to remove</span>
        )}
        {stored.length > 0 && (
          <button
            type="button"
            className="text-zinc-300 hover:text-white"
            title={`Clear the ${channel.label} curve`}
            onClick={() => {
              onDiscreteChange({ [channel.key]: [] });
              setSelected(null);
            }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
