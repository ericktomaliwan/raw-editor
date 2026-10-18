import { useCallback, useEffect, useState } from "react";

export type ToastKind = "error" | "info";
export interface ToastMessage {
  message: string;
  kind: ToastKind;
}
/** Show a message at the bottom of the screen. Errors are the default. */
export type Notify = (message: string, kind?: ToastKind) => void;

const TOAST_MS = 5000;

/** One toast at a time: a new message replaces the current one and restarts its timer. */
export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const notify = useCallback<Notify>((message, kind = "error") => setToast({ message, kind }), []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast]);
  return { toast, notify };
}
