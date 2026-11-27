import { describe, expect, it } from "vitest";
import { createDefaultAdjustments } from "./adjustments";
import { FREE_ASPECT } from "./crop";
import { createLayer } from "./layers";
import {
  COALESCE_MS,
  type EditState,
  type History,
  historyReducer,
  type HistoryAction,
  LIMIT,
  sameValue,
} from "./useEditHistory";

const initial: EditState = {
  adjustments: createDefaultAdjustments(),
  activePresetId: null,
  crop: null,
  aspect: FREE_ASPECT,
  layers: [],
};
const start = (): History => ({
  past: [],
  present: initial,
  future: [],
  lastKey: undefined,
  lastAt: 0,
});

const setExposure = (exposure: number, key?: string, at = 0): HistoryAction => ({
  type: "apply",
  update: (prev) => ({ ...prev, adjustments: { ...prev.adjustments, exposure } }),
  key,
  at,
});
const run = (h: History, ...actions: HistoryAction[]) => actions.reduce(historyReducer, h);
const exposure = (h: History) => h.present.adjustments.exposure;

describe("historyReducer", () => {
  it("undoes and redoes a change", () => {
    const h = run(start(), setExposure(1));
    expect(exposure(h)).toBe(1);
    const undone = run(h, { type: "undo" });
    expect(exposure(undone)).toBe(0);
    expect(exposure(run(undone, { type: "redo" }))).toBe(1);
  });

  it("ignores undo and redo with nothing to step to", () => {
    const h = start();
    expect(run(h, { type: "undo" })).toBe(h);
    expect(run(h, { type: "redo" })).toBe(h);
  });

  it("drops a change that changes nothing", () => {
    const h = start();
    expect(run(h, setExposure(0))).toBe(h);
  });

  it("merges a continuous gesture into one step", () => {
    const h = run(
      start(),
      setExposure(1, "drag", 1000),
      setExposure(2, "drag", 1000 + COALESCE_MS - 1),
    );
    expect(h.past).toHaveLength(1);
    expect(exposure(run(h, { type: "undo" }))).toBe(0);
  });

  it("starts a new step after a pause, or for a different key, or with no key", () => {
    expect(
      run(start(), setExposure(1, "a", 0), setExposure(2, "a", COALESCE_MS)).past,
    ).toHaveLength(2);
    expect(run(start(), setExposure(1, "a", 0), setExposure(2, "b", 1)).past).toHaveLength(2);
    expect(
      run(start(), setExposure(1, undefined, 0), setExposure(2, undefined, 1)).past,
    ).toHaveLength(2);
  });

  it("doesn't merge into a gesture that was undone", () => {
    const h = run(
      start(),
      setExposure(1, "a", 0),
      setExposure(2, "a", 100),
      { type: "undo" },
      setExposure(3, "a", 200),
    );
    expect(exposure(run(h, { type: "undo" }))).toBe(0);
  });

  it("clears the redo stack on a new change", () => {
    const h = run(start(), setExposure(1), { type: "undo" }, setExposure(2));
    expect(h.future).toEqual([]);
    expect(exposure(run(h, { type: "redo" }))).toBe(2);
  });

  it(`keeps at most ${LIMIT} steps`, () => {
    const actions = Array.from({ length: LIMIT + 5 }, (_, i) => setExposure((i + 1) / 100));
    expect(run(start(), ...actions).past).toHaveLength(LIMIT);
  });

  it("restart applies the update and forgets the history", () => {
    const h = run(
      start(),
      setExposure(1),
      setExposure(2),
      { type: "undo" },
      {
        type: "restart",
        update: (prev) => ({ ...prev, crop: null }),
      },
    );
    expect(h.past).toEqual([]);
    expect(h.future).toEqual([]);
    expect(exposure(h)).toBe(1);
  });
});

describe("layers in the history", () => {
  const layer = createLayer("brush", {
    id: "a",
    name: "Brush 1",
    view: { x: 0, y: 0, width: 100, height: 100 },
    imageWidth: 100,
    imageHeight: 100,
  });
  const addLayer: HistoryAction = {
    type: "apply",
    update: (prev) => ({ ...prev, layers: [...prev.layers, layer] }),
    key: undefined,
    at: 0,
  };
  const stroke = { erase: false, size: 0.05, feather: 50, flow: 100, points: [0.5, 0.5] };
  const paint: HistoryAction = {
    type: "apply",
    update: (prev) => ({
      ...prev,
      layers: prev.layers.map((l) => ({ ...l, strokes: [...l.strokes, stroke] })),
    }),
    key: undefined,
    at: 0,
  };

  it("undoes a stroke, then the layer", () => {
    const h = run(start(), addLayer, paint);
    expect(h.present.layers[0].strokes).toHaveLength(1);
    const once = run(h, { type: "undo" });
    expect(once.present.layers[0].strokes).toHaveLength(0);
    expect(run(once, { type: "undo" }).present.layers).toHaveLength(0);
  });

  it("shares unchanged strokes between steps", () => {
    const h = run(start(), addLayer, paint, setExposure(1));
    expect(h.present.layers[0].strokes[0]).toBe(h.past[h.past.length - 1].layers[0].strokes[0]);
  });

  it("drops a layer change that changes nothing", () => {
    const h = run(start(), addLayer);
    const noop: HistoryAction = {
      type: "apply",
      update: (prev) => ({ ...prev, layers: prev.layers.map((l) => ({ ...l })) }),
      key: undefined,
      at: 0,
    };
    expect(run(h, noop)).toBe(h);
  });
});

describe("sameValue", () => {
  it("compares plain data deeply", () => {
    expect(sameValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(sameValue({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false);
    expect(sameValue([1, 2], [1, 2, 3])).toBe(false);
    expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameValue({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(false);
    expect(sameValue([1], { 0: 1 })).toBe(false);
    expect(sameValue(null, {})).toBe(false);
    expect(sameValue(Number.NaN, Number.NaN)).toBe(true);
  });

  it("doesn't walk into parts that are the same object", () => {
    const big = Array.from({ length: 5 }, () => ({ x: 1 }));
    const trap = new Proxy(big, {
      get(target, prop, receiver) {
        if (prop === "length") throw new Error("walked");
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(sameValue({ s: trap }, { s: trap })).toBe(true);
  });
});
