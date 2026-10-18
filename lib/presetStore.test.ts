// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Preset } from "./presets";

const STORAGE_KEY = "raw-editor:imported-presets";
const preset = (id: string): Preset => ({
  id,
  name: `Preset ${id}`,
  adjustments: { exposure: 0.5 },
  source: "imported",
});

/** A fresh copy of the store module (it keeps state at module level). */
async function loadStore() {
  vi.resetModules();
  return import("./presetStore");
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("imported preset store", () => {
  it("saves and reads presets", async () => {
    const store = await loadStore();
    expect(store.updateImportedPresets(() => [preset("a")])).toBe(true);
    expect(store.readImportedPresets().map((p) => p.id)).toEqual(["a"]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toHaveLength(1);
  });

  it("keeps new presets for the session when storage is full, and says so", async () => {
    const store = await loadStore();
    store.updateImportedPresets(() => [preset("a")]);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(store.updateImportedPresets((prev) => [...prev, preset("b")])).toBe(false);
    // Before the fix, reading went back to storage and "b" vanished.
    expect(store.readImportedPresets().map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("goes back to storage once saving works again", async () => {
    const store = await loadStore();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    store.updateImportedPresets(() => [preset("a")]);
    setItem.mockRestore();
    expect(store.updateImportedPresets((prev) => [...prev, preset("b")])).toBe(true);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toHaveLength(2);
    expect(store.readImportedPresets().map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("works where storage is blocked outright", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const store = await loadStore();
    expect(store.readImportedPresets()).toEqual([]);
    expect(store.updateImportedPresets(() => [preset("a")])).toBe(false);
    expect(store.readImportedPresets().map((p) => p.id)).toEqual(["a"]);
  });

  it("ignores stored entries that claim a built-in id or are malformed", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([preset("ok"), { ...preset("x"), id: "builtin:fake" }, { id: 5 }, "junk"]),
    );
    const store = await loadStore();
    expect(store.readImportedPresets().map((p) => p.id)).toEqual(["ok"]);
  });
});
