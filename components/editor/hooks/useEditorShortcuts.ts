import { useEffect, useEffectEvent } from "react";

/** Input types that hold no text, so Cmd/Ctrl+Z on them can mean "undo the edit". */
const NON_TEXT_INPUTS = new Set([
  "range",
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "file",
  "color",
]);
/** Form fields that keep "\", Enter and Escape for themselves. */
const FORM_FIELDS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

interface Shortcuts {
  /** The crop tool is open, so Enter and Escape apply to it. */
  cropping: boolean;
  onToggleCompare: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onFinishCrop: () => void;
  onCancelCrop: () => void;
}

/**
 * The editor's keyboard shortcuts, on a single window listener:
 * - Undo: Cmd+Z / Ctrl+Z. Redo: Cmd+Shift+Z / Ctrl+Shift+Z, or Ctrl+Y.
 * - "\" switches between the original and the edit.
 * - While cropping: Enter finishes, Escape puts the crop back as it was.
 *
 * Handlers may change every render; the listener always calls the latest ones.
 */
export function useEditorShortcuts(shortcuts: Shortcuts) {
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (undoRedo(e, shortcuts)) return;
    const tag = (e.target as HTMLElement | null)?.tagName ?? "";
    if (FORM_FIELDS.has(tag)) return;
    if (e.key === "\\") {
      e.preventDefault();
      shortcuts.onToggleCompare();
    } else if (shortcuts.cropping && e.key === "Escape") {
      shortcuts.onCancelCrop();
    } else if (shortcuts.cropping && e.key === "Enter" && tag !== "BUTTON" && tag !== "A") {
      // (On a button or link, Enter belongs to that control.)
      e.preventDefault();
      shortcuts.onFinishCrop();
    }
  });

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
}

/** Handle Cmd/Ctrl+Z and friends. Returns true when the event was one of them. */
function undoRedo(e: KeyboardEvent, { onUndo, onRedo }: Shortcuts): boolean {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return false;
  const key = e.key.toLowerCase();
  const isUndo = key === "z" && !e.shiftKey;
  const isRedo = (key === "z" && e.shiftKey) || (key === "y" && e.ctrlKey && !e.metaKey);
  if (!isUndo && !isRedo) return false;
  // While typing in a text field, the shortcut belongs to the field: it
  // undoes the typing. (Sliders are inputs too, but not text ones.)
  const t = e.target;
  if (t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable)) {
    return true;
  }
  if (t instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(t.type)) return true;
  e.preventDefault();
  if (isUndo) onUndo();
  else onRedo();
  return true;
}
