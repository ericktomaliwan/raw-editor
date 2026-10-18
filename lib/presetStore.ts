import { useSyncExternalStore } from "react";
import { sanitizeAdjustments } from "./adjustments";
import { BUILTIN_ID_PREFIX, cleanLabel, type Preset } from "./presets";

/**
 * Imported presets persisted in localStorage, exposed as an external store
 * so components can subscribe without effect-driven setState.
 */
const STORAGE_KEY = "raw-editor:imported-presets";
const EMPTY: Preset[] = [];

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedValue: Preset[] = EMPTY;
/**
 * Set when the browser refused to save the presets (storage full, or blocked
 * outright). This tab then keeps them in memory, so what was just imported
 * doesn't vanish; a later save that works switches back to storage.
 */
let memoryOnly: Preset[] | null = null;

/**
 * localStorage is not a trusted source: it can hold data written by an older
 * build, edited by hand, or corrupted. Rebuild every preset field by field and
 * drop anything that isn't a well-formed preset, so bad data can't crash
 * rendering on every load.
 */
function parseStored(raw: string): Preset[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return EMPTY;
  const seen = new Set<string>();
  const out: Preset[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const { id, name, group, adjustments } = item as Record<string, unknown>;
    if (typeof id !== "string" || !id || id.length > 100 || seen.has(id)) continue;
    // Ids in that namespace belong to the presets shipped in lib/presets.ts.
    if (id.startsWith(BUILTIN_ID_PREFIX)) continue;
    const cleanName = typeof name === "string" ? cleanLabel(name) : "";
    if (!cleanName) continue;
    seen.add(id);
    out.push({
      id,
      name: cleanName,
      group: (typeof group === "string" && cleanLabel(group)) || undefined,
      adjustments: sanitizeAdjustments(adjustments),
      source: "imported",
    });
  }
  return out;
}

/** The imported presets: from storage, or from memory if storage refused them. */
export function readImportedPresets(): Preset[] {
  if (typeof window === "undefined") return EMPTY;
  if (memoryOnly) return memoryOnly;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  try {
    cachedValue = raw ? parseStored(raw) : EMPTY;
  } catch {
    cachedValue = EMPTY;
  }
  return cachedValue;
}

/** Save the presets and tell subscribers. Returns false if storage refused them. */
function write(next: Preset[]): boolean {
  let saved: boolean;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    memoryOnly = null;
    saved = true;
  } catch {
    // Quota exceeded, or storage blocked: keep them for this tab instead.
    memoryOnly = next;
    saved = false;
  }
  for (const l of listeners) l();
  return saved;
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

/**
 * Change the imported presets. Returns false when they couldn't be saved: they
 * still apply, but only until this tab is closed.
 */
export function updateImportedPresets(fn: (prev: Preset[]) => Preset[]): boolean {
  return write(fn(readImportedPresets()));
}
const getServerSnapshot = () => EMPTY;

export function useImportedPresets(): [Preset[], typeof updateImportedPresets] {
  const presets = useSyncExternalStore(subscribe, readImportedPresets, getServerSnapshot);
  return [presets, updateImportedPresets];
}
