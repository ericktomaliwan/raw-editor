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
import { type CropRect, fullRect } from "@/lib/crop";
import type { LoadedImage } from "@/lib/image";
import { encodeJpeg, type RawPixels } from "@/lib/jpeg/encoder";
import { encodePng } from "@/lib/png/encoder";
import { encodeWebp, WEBP_MAX_DIMENSION } from "@/lib/webp/encoder";
import { Renderer } from "@/lib/webgl/renderer";
import { CropOverlay } from "./CropOverlay";

/** Our own encoders by MIME type, each in its own worker. `quality` is 1–100. */
const ENCODERS: Record<string, { name: string; encode: (pixels: RawPixels, quality: number) => Promise<Blob> }> = {
  "image/jpeg": { name: "MozJPEG", encode: encodeJpeg },
  "image/png": { name: "OxiPNG", encode: (pixels) => encodePng(pixels) },
  "image/webp": { name: "libwebp", encode: encodeWebp },
};

export interface ExportResult {
  blob: Blob;
  /**
   * True when the file had to be written by the browser's built-in encoder
   * because ours (MozJPEG, OxiPNG, libwebp) couldn't run.
   */
  usedBuiltInEncoder: boolean;
}

export interface ViewportHandle {
  maxTextureSize: number;
  /**
   * Render at full resolution (of the crop, if there is one) and encode.
   * `quality` is 0..1. JPEGs go through MozJPEG, PNGs through OxiPNG and WebPs
   * through libwebp, with the browser's encoder as the fallback for all three.
   */
  exportBlob(type: string, quality?: number): Promise<ExportResult>;
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
    const id = requestAnimationFrame(() => {
      r.render(adjustments, {
        width: pixelW,
        height: pixelH,
        bypass: compare,
        view: { x: viewX, y: viewY, width: viewW, height: viewH },
        crop: { x: cropX, y: cropY, width: cropW, height: cropH },
      });
    });
    return () => cancelAnimationFrame(id);
  }, [adjustments, compare, image, pixelW, pixelH, viewX, viewY, viewW, viewH, cropX, cropY, cropW, cropH]);

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
        if (type === "image/webp" && (cropW > WEBP_MAX_DIMENSION || cropH > WEBP_MAX_DIMENSION)) {
          throw new Error(
            `WebP images can be at most ${WEBP_MAX_DIMENSION} pixels on a side. Crop the photo or export as JPEG or PNG.`,
          );
        }
        // The exported picture is the crop, at one output pixel per image pixel.
        const output: CropRect = { x: cropX, y: cropY, width: cropW, height: cropH };
        const full = { width: cropW, height: cropH, view: output, crop: output };
        const restore = () =>
          r.render(adjustments, {
            width: pixelW,
            height: pixelH,
            bypass: compare,
            view: { x: viewX, y: viewY, width: viewW, height: viewH },
            crop: output,
          });
        const builtIn = () =>
          new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

        let blob: Blob | null = null;
        let usedBuiltInEncoder = false;

        const encoder = ENCODERS[type];
        if (encoder) {
          // Read the full-size render back and hand it to our encoder in its
          // worker. The display render is restored first: the pixels are
          // already copied.
          r.render(adjustments, full);
          let pixels: ReturnType<Renderer["readPixels"]> = null;
          try {
            pixels = r.readPixels();
          } catch {
            pixels = null; // e.g. not enough memory for the readback buffer
          }
          restore();
          if (pixels) {
            const raw = { ...pixels, flipY: true };
            try {
              blob = await encoder.encode(raw, Math.round(quality * 100));
            } catch (e) {
              console.warn(`[export] ${encoder.name} unavailable, using the browser's encoder:`, e);
            }
          }
          usedBuiltInEncoder = blob === null;
        }

        if (!blob) {
          // toBlob snapshots the canvas when called, so render right before it.
          r.render(adjustments, full);
          const result = builtIn();
          restore();
          blob = await result;
        }
        if (!blob) throw new Error("Export failed — the image may be too large for this browser.");
        // A browser that can't write the format returns a PNG instead (Safari
        // does this for WebP). Don't save that under the wrong extension.
        if (blob.type !== type) {
          throw new Error("This browser can't write that format. Try exporting as JPEG or PNG.");
        }
        return { blob, usedBuiltInEncoder };
      },
    }),
    [image, adjustments, pixelW, pixelH, compare, viewX, viewY, viewW, viewH, cropX, cropY, cropW, cropH],
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
