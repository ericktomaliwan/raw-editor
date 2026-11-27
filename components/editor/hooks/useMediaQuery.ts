import { useSyncExternalStore } from "react";

/**
 * Whether a CSS media query matches, kept up to date as the window changes.
 * False during server rendering and hydration, so pages must look right
 * without it first (the narrow layout) and switch once it's known.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
