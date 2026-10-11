import { useCallback, useReducer } from "react";
import type { Adjustments } from "./adjustments";
import type { AspectChoice, CropRect } from "./crop";

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
}

/** How many steps back you can go. Snapshots are small (about 1 KB each). */
const LIMIT = 100;

/**
 * Changes tagged with the same key that arrive within this window of each
 * other become one undo step. A slider drag fires on every frame, so the gap
 * between its events is far below this and the whole drag undoes at once;
 * pausing longer than this on the same slider starts a new step.
 */
const COALESCE_MS = 800;

interface History {
  past: EditState[];
  present: EditState;
  future: EditState[];
  /** Key and time of the last change, for coalescing. */
  lastKey: string | undefined;
  lastAt: number;
}

type Action =
  | { type: "apply"; update: (prev: EditState) => EditState; key: string | undefined; at: number }
  | { type: "restart"; update: (prev: EditState) => EditState }
  | { type: "undo" }
  | { type: "redo" };

const same = (a: EditState, b: EditState) => a === b || JSON.stringify(a) === JSON.stringify(b);

function reducer(h: History, action: Action): History {
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
      return { past: [], present: action.update(h.present), future: [], lastKey: undefined, lastAt: 0 };
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
  const [history, dispatch] = useReducer(
    reducer,
    undefined,
    (): History => ({ past: [], present: initial(), future: [], lastKey: undefined, lastAt: 0 }),
  );

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
