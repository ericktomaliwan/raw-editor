"use client";

import { type Ref, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { Adjustments } from "@/lib/adjustments";
import { type CropRect, fullRect } from "@/lib/crop";
import { type ExportRequest, type ExportResult, exportImage } from "@/lib/export/exportImage";
import type { LoadedImage } from "@/lib/image";
import { Renderer, type RenderOptions } from "@/lib/webgl/renderer";
import { CropOverlay } from "./CropOverlay";

export interface ViewportHandle {
  maxTextureSize: number;
  /**
   * Export the edit with this viewport's renderer (see lib/export/exportImage.ts),
   * putting the on-screen picture back afterwards.
   */
  exportImage(request: ExportRequest): Promise<ExportResult>;
}

interface Props {
  ref?: Ref<ViewportHandle>;
  image: LoadedImage | null;
  adjustments: Adjustments;
  compare: boolean;
  /** The crop in image pixels, or null for the whole image. */
  crop: CropRect | null;
  /** True while the crop is being edited: show the whole image with the crop box on it. */
  cropping: boolean;
  /** Width / height the crop box must keep, or null for a free crop. */
  cropRatio: number | null;
  onCropChange: (rect: CropRect) => void;
  onError: (message: string) => void;
  children?: React.ReactNode; // empty-state overlay
}

export function ImageViewport({
  ref,
  image,
  adjustments,
  compare,
  crop,
  cropping,
  cropRatio,
  onCropChange,
  onError,
  children,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  /** What the canvas last showed, so an export can put it back. Written by the render effect. */
  const displayRef = useRef<{ adjustments: Adjustments; options: RenderOptions } | null>(null);
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

  // What the canvas shows: the crop normally, the whole image while cropping
  // (so the box can be dragged over the parts that will be cut off).
  const whole = fullRect(image?.width ?? 0, image?.height ?? 0);
  const cropRect = crop ?? whole;
  const view = cropping ? whole : cropRect;
  // Rects are rebuilt each render; key effects on their numbers, not their identity.
  const { x: viewX, y: viewY, width: viewW, height: viewH } = view;
  const { x: cropX, y: cropY, width: cropW, height: cropH } = cropRect;

  // Compute the display size that fits the container.
  const fit = fitSize(viewW, viewH, container.w, container.h);
  const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 3) : 1;
  const pixelW = image ? Math.min(Math.round(fit.w * dpr), viewW) : 0;
  const pixelH = image ? Math.min(Math.round(fit.h * dpr), viewH) : 0;

  // Re-render whenever anything relevant changes (coalesced per frame).
  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !image || pixelW === 0 || pixelH === 0) return;
    const display = {
      adjustments,
      options: {
        width: pixelW,
        height: pixelH,
        bypass: compare,
        view: { x: viewX, y: viewY, width: viewW, height: viewH },
        crop: { x: cropX, y: cropY, width: cropW, height: cropH },
      },
    };
    displayRef.current = display;
    const id = requestAnimationFrame(() => r.render(display.adjustments, display.options));
    return () => cancelAnimationFrame(id);
  }, [
    adjustments,
    compare,
    image,
    pixelW,
    pixelH,
    viewX,
    viewY,
    viewW,
    viewH,
    cropX,
    cropY,
    cropW,
    cropH,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      get maxTextureSize() {
        return rendererRef.current?.maxTextureSize ?? 4096;
      },
      exportImage(request: ExportRequest) {
        const r = rendererRef.current;
        if (!r?.hasImage) return Promise.reject(new Error("No image to export."));
        return exportImage(r, request, () => {
          const display = displayRef.current;
          if (display) r.render(display.adjustments, display.options);
        });
      },
    }),
    [],
  );

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
    >
      {/* Sized to the displayed image, so the crop overlay can sit exactly on top of it. */}
      <div
        className={`relative shrink-0 shadow-2xl shadow-black/60 ${image ? "" : "hidden"}`}
        style={{ width: fit.w, height: fit.h }}
      >
        <canvas ref={canvasRef} className={`block h-full w-full ${image ? "" : "hidden"}`} />
        {image && cropping && (
          <CropOverlay
            imageWidth={image.width}
            imageHeight={image.height}
            rect={cropRect}
            ratio={cropRatio}
            onChange={onCropChange}
          />
        )}
      </div>
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
