import { useCallback, useReducer } from "react";
import type { Adjustments } from "./adjustments";
import type { AspectChoice, CropRect } from "./crop";
import type { Layer } from "./layers";

/**
 * Everything about an edit that undo/redo steps through. UI state that isn't
 * part of the edit (which panel is open, whether the crop box is showing, the
 * export format) deliberately stays out, so undo never changes what you were
 * looking at, only what you did.
 */
export interface EditState {
  adjustments: Adjustments;
  /** The preset whose settings are currently applied untouched, if any. */
  activePresetId: string | null;
  /** Crop in image pixels; null = whole image. */
  crop: CropRect | null;
  aspect: AspectChoice;
  /** Local adjustments, in shader slot order. */
  layers: Layer[];
}

/**
 * How many steps back you can go. Snapshots share everything that didn't
 * change (brush strokes most of all), so each step costs little more than the
 * settings it changed.
 */
export const LIMIT = 100;

/**
 * Changes tagged with the same key that arrive within this window of each
 * other become one undo step. A slider drag fires on every frame, so the gap
 * between its events is far below this and the whole drag undoes at once;
 * pausing longer than this on the same slider starts a new step.
 */
export const COALESCE_MS = 800;

export interface History {
  past: EditState[];
  present: EditState;
  future: EditState[];
  /** Key and time of the last change, for coalescing. */
  lastKey: string | undefined;
  lastAt: number;
}

export type HistoryAction =
  | { type: "apply"; update: (prev: EditState) => EditState; key: string | undefined; at: number }
  | { type: "restart"; update: (prev: EditState) => EditState }
  | { type: "undo" }
  | { type: "redo" };

/**
 * Deep equality for plain data (objects, arrays, primitives). Parts that are
 * the same object are equal without being walked, which keeps comparing two
 * snapshots cheap: an edit copies only what it changes, so long brush strokes
 * are usually the same arrays in both.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    if (a.length !== bb.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameValue(a[i], bb[i])) return false;
    return true;
  }
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (!Object.hasOwn(b, k)) return false;
    if (!sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
      return false;
    }
  }
  return true;
}

const same = (a: EditState, b: EditState) => sameValue(a, b);

/** Exported for tests; components use the hook below. */
export function historyReducer(h: History, action: HistoryAction): History {
  switch (action.type) {
    case "apply": {
      const next = action.update(h.present);
      if (same(next, h.present)) return h; // nothing changed: no empty undo steps
      const continuing =
        action.key !== undefined && action.key === h.lastKey && action.at - h.lastAt < COALESCE_MS;
      return {
        // When continuing a gesture, the top of `past` is already the state from
        // before the gesture began, so it is left alone.
        past: continuing ? h.past : [...h.past, h.present].slice(-LIMIT),
        present: next,
        future: [], // a new change discards anything that was undone
        lastKey: action.key,
        lastAt: action.at,
      };
    }
    case "undo": {
      if (h.past.length === 0) return h;
      return {
        past: h.past.slice(0, -1),
        present: h.past[h.past.length - 1],
        future: [h.present, ...h.future],
        lastKey: undefined, // the next change is always a fresh step
        lastAt: 0,
      };
    }
    case "redo": {
      if (h.future.length === 0) return h;
      return {
        past: [...h.past, h.present],
        present: h.future[0],
        future: h.future.slice(1),
        lastKey: undefined,
        lastAt: 0,
      };
    }
    case "restart":
      return {
        past: [],
        present: action.update(h.present),
        future: [],
        lastKey: undefined,
        lastAt: 0,
      };
  }
}

/**
 * Edit state with undo/redo history.
 *
 * `apply(update, key?)` makes a change. Give continuous gestures (a slider
 * drag, a crop drag) a `key` so the whole gesture becomes one step; leave it
 * out for discrete actions (applying a preset, a reset), which always get a
 * step of their own.
 *
 * `restart(update)` replaces the state and clears the history, for when
 * earlier steps no longer make sense (a different photo was opened).
 *
 * `update` functions run inside the reducer, i.e. during render: keep them
 * pure, and read any refs before calling `apply`, not inside the function.
 */
export function useEditHistory(initial: () => EditState) {
  const [history, dispatch] = useReducer(historyReducer, undefined, (): History => ({
    past: [],
    present: initial(),
    future: [],
    lastKey: undefined,
    lastAt: 0,
  }));

  const apply = useCallback((update: (prev: EditState) => EditState, key?: string) => {
    // The timestamp is taken here, in the event handler, so the reducer stays pure.
    dispatch({ type: "apply", update, key, at: Date.now() });
  }, []);
  const restart = useCallback((update: (prev: EditState) => EditState) => {
    dispatch({ type: "restart", update });
  }, []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);

  return {
    edit: history.present,
    apply,
    restart,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}
