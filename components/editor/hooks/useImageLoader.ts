import { type RefObject, useCallback, useRef, useState } from "react";
import { isRawFile, type LoadedImage, loadImageFile } from "@/lib/image";
import type { ViewportHandle } from "../ImageViewport";
import type { Notify } from "./useToast";

/**
 * The open photo and the loading of a new one.
 *
 * Loads can overlap (open a RAW, then a JPEG while the RAW is still decoding).
 * The most recently started one wins: an older load that finishes later is
 * dropped, and its status text, errors and toasts are not shown.
 */
export function useImageLoader({
  viewportRef,
  onLoaded,
  notify,
}: {
  /** For the GPU's texture limit, which caps the working image size. */
  viewportRef: RefObject<ViewportHandle | null>;
  /** Called once a new photo is in place. Keep it stable (useCallback). */
  onLoaded: () => void;
  notify: Notify;
}) {
  const [image, setImage] = useState<LoadedImage | null>(null);
  /** Status text while decoding, or null. */
  const [loading, setLoading] = useState<string | null>(null);
  /** Numbers the loads, so a slow one overtaken by a newer one can tell. */
  const latestLoad = useRef(0);

  const openImage = useCallback(
    async (file: File) => {
      const load = ++latestLoad.current;
      const isLatest = () => load === latestLoad.current;
      const raw = isRawFile(file);
      setLoading(raw ? "Decoding RAW…" : "Loading…");
      try {
        const max = viewportRef.current?.maxTextureSize ?? 4096;
        const loaded = await loadImageFile(file, max, {
          onStatus: raw ? (s) => isLatest() && setLoading(s) : undefined,
        });
        if (!isLatest()) {
          loaded.bitmap.close();
          return;
        }
        setImage((prev) => {
          prev?.bitmap.close();
          return loaded;
        });
        onLoaded();
        if (loaded.raw?.preview) {
          notify(
            "Sensor data couldn't be decoded, so the embedded preview is being edited instead.",
            "info",
          );
        } else if (loaded.width !== loaded.sourceWidth) {
          notify(
            `Image downscaled to ${loaded.width}×${loaded.height} to fit this GPU's texture limit.`,
            "info",
          );
        }
      } catch (e) {
        if (isLatest()) notify(e instanceof Error ? e.message : "Couldn't open that file.");
      } finally {
        if (isLatest()) setLoading(null);
      }
    },
    [viewportRef, onLoaded, notify],
  );

  return { image, loading, openImage };
}
