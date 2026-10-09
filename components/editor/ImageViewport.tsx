"use client";

import {
  type Ref,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { Adjustments } from "@/lib/adjustments";
import type { LoadedImage } from "@/lib/image";
import { Renderer } from "@/lib/webgl/renderer";

export interface ViewportHandle {
  maxTextureSize: number;
  /** Render at full image resolution and encode. */
  exportBlob(type: string, quality?: number): Promise<Blob>;
}

interface Props {
  ref?: Ref<ViewportHandle>;
  image: LoadedImage | null;
  adjustments: Adjustments;
  compare: boolean;
  onError: (message: string) => void;
  children?: React.ReactNode; // empty-state overlay
}

export function ImageViewport({ ref, image, adjustments, compare, onError, children }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const [container, setContainer] = useState({ w: 0, h: 0 });

  // Create the WebGL renderer once. Declared before the other effects so it
  // runs first on mount; later effects can rely on rendererRef being set.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      rendererRef.current = new Renderer(canvas);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to initialise WebGL.");
    }
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [onError]);

  // Track container size.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setContainer({ w: Math.floor(width), h: Math.floor(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Upload the image when it changes.
  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !image) return;
    try {
      r.setImage(image.bitmap);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to upload image to GPU.");
    }
  }, [image, onError]);

  // Compute the display size that fits the container.
  const fit = fitSize(image?.width ?? 0, image?.height ?? 0, container.w, container.h);
  const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 3) : 1;
  const pixelW = image ? Math.min(Math.round(fit.w * dpr), image.width) : 0;
  const pixelH = image ? Math.min(Math.round(fit.h * dpr), image.height) : 0;

  // Re-render whenever anything relevant changes (coalesced per frame).
  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !image || pixelW === 0 || pixelH === 0) return;
    const id = requestAnimationFrame(() => {
      r.render(adjustments, { width: pixelW, height: pixelH, bypass: compare });
    });
    return () => cancelAnimationFrame(id);
  }, [adjustments, compare, image, pixelW, pixelH]);

  useImperativeHandle(
    ref,
    () => ({
      get maxTextureSize() {
        return rendererRef.current?.maxTextureSize ?? 4096;
      },
      async exportBlob(type: string, quality = 0.92) {
        const r = rendererRef.current;
        const canvas = canvasRef.current;
        if (!r || !canvas || !image) throw new Error("No image to export.");
        r.render(adjustments, { width: image.width, height: image.height });
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, type, quality),
        );
        // Restore the display-sized render.
        r.render(adjustments, { width: pixelW, height: pixelH, bypass: compare });
        if (!blob) throw new Error("Export failed — the image may be too large for this browser.");
        return blob;
      },
    }),
    [image, adjustments, pixelW, pixelH, compare],
  );

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
    >
      <canvas
        ref={canvasRef}
        className={`block max-h-full max-w-full shadow-2xl shadow-black/60 ${
          image ? "" : "hidden"
        }`}
        style={{ width: fit.w, height: fit.h }}
      />
      {image && compare && (
        <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/70 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-zinc-200">
          Before
        </div>
      )}
      {children}
    </div>
  );
}

function fitSize(iw: number, ih: number, cw: number, ch: number) {
  if (!iw || !ih || !cw || !ch) return { w: 0, h: 0 };
  const scale = Math.min(cw / iw, ch / ih);
  return { w: Math.max(1, Math.floor(iw * scale)), h: Math.max(1, Math.floor(ih * scale)) };
}
