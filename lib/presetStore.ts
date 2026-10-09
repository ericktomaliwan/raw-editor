import { useSyncExternalStore } from "react";
import type { Preset } from "./xmp";

/**
 * Imported presets persisted in localStorage, exposed as an external store
 * so components can subscribe without effect-driven setState.
 */
const STORAGE_KEY = "raw-editor:imported-presets";
const EMPTY: Preset[] = [];

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedValue: Preset[] = EMPTY;

function read(): Preset[] {
  if (typeof window === "undefined") return EMPTY;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  try {
    cachedValue = raw ? (JSON.parse(raw) as Preset[]) : EMPTY;
  } catch {
    cachedValue = EMPTY;
  }
  return cachedValue;
}

function write(next: Preset[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota exceeded / private mode: keep in-memory only */
    cachedRaw = undefined;
    cachedValue = next;
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const update = (fn: (prev: Preset[]) => Preset[]) => write(fn(read()));
const getServerSnapshot = () => EMPTY;

export function useImportedPresets(): [Preset[], typeof update] {
  const presets = useSyncExternalStore(subscribe, read, getServerSnapshot);
  return [presets, update];
}
