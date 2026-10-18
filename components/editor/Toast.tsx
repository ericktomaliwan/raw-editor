import type { ToastMessage } from "./hooks/useToast";

export function Toast({ toast }: { toast: ToastMessage | null }) {
  if (!toast) return null;
  return (
    <div
      role="status"
      className={`fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg border px-4 py-2 text-xs shadow-xl ${
        toast.kind === "error"
          ? "border-red-900/60 bg-red-950/90 text-red-200"
          : "border-zinc-700 bg-zinc-900/95 text-zinc-200"
      }`}
    >
      {toast.message}
    </div>
  );
}
