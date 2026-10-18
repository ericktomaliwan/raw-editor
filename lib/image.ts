import { decodeRawFile, type RawMetadata } from "./raw/decoder";

/** Extensions routed through the LibRaw decoder. */
export const RAW_EXTENSIONS = [
  "cr2",
  "cr3",
  "nef",
  "nrw",
  "arw",
  "srf",
  "sr2",
  "dng",
  "raf",
  "orf",
  "rw2",
  "pef",
  "3fr",
  "iiq",
  "x3f",
];

export class UnsupportedImageError extends Error {
  constructor(
    message: string,
    public readonly kind: "raw" | "unknown",
  ) {
    super(message);
    this.name = "UnsupportedImageError";
  }
}

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

export function isRawFile(file: File): boolean {
  return RAW_EXTENSIONS.includes(extensionOf(file.name));
}

export function isXmpFile(file: File): boolean {
  return extensionOf(file.name) === "xmp";
}

export interface LoadedImage {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  /** Original dimensions before any GPU-limit downscale. */
  sourceWidth: number;
  sourceHeight: number;
  name: string;
  /** Present for RAW/DNG files. */
  raw?: {
    metadata: RawMetadata;
    /** True if only the embedded preview could be decoded. */
    preview: boolean;
  };
}

export interface LoadOptions {
  /** Progress text for slow (RAW) decodes. */
  onStatus?: (status: string) => void;
}

/**
 * Decode a dropped file into an ImageBitmap, honouring EXIF orientation and
 * downscaling if the image exceeds the GPU's max texture size. RAW/DNG files
 * are demosaiced with LibRaw in a worker.
 */
export async function loadImageFile(
  file: File,
  maxSize: number,
  opts: LoadOptions = {},
): Promise<LoadedImage> {
  if (isRawFile(file)) {
    try {
      const decoded = await decodeRawFile(file, { maxSize, onStatus: opts.onStatus });
      return {
        bitmap: decoded.bitmap,
        width: decoded.width,
        height: decoded.height,
        sourceWidth: decoded.width,
        sourceHeight: decoded.height,
        name: file.name,
        raw: { metadata: decoded.metadata, preview: decoded.preview },
      };
    } catch (e) {
      throw new UnsupportedImageError(
        e instanceof Error ? e.message : `Couldn't decode "${file.name}".`,
        "raw",
      );
    }
  }
  if (!file.type.startsWith("image/") && !looksLikeImage(file.name)) {
    throw new UnsupportedImageError(`"${file.name}" doesn't look like an image file.`, "unknown");
  }

  // Keep colours unpremultiplied: the GPU upload, the shader and every encoder
  // treat RGB as straight colour. By default the bitmap would hold RGB already
  // multiplied by alpha, which darkens every semi-transparent pixel (dark
  // fringes around cut-outs, 255 red at half alpha exported as 128).
  const decodeOptions: ImageBitmapOptions = { premultiplyAlpha: "none" };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { ...decodeOptions, imageOrientation: "from-image" });
  } catch {
    // Safari < 17 lacks imageOrientation support; fall back.
    try {
      bitmap = await createImageBitmap(file, decodeOptions);
    } catch {
      throw new UnsupportedImageError(
        `Couldn't decode "${file.name}". The browser doesn't support this format.`,
        "unknown",
      );
    }
  }

  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  const largest = Math.max(sourceWidth, sourceHeight);
  if (largest > maxSize) {
    const scale = maxSize / largest;
    const resized = await createImageBitmap(bitmap, {
      ...decodeOptions,
      resizeWidth: Math.round(sourceWidth * scale),
      resizeHeight: Math.round(sourceHeight * scale),
      resizeQuality: "high",
    });
    bitmap.close();
    bitmap = resized;
  }

  return {
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    sourceWidth,
    sourceHeight,
    name: file.name,
  };
}

function looksLikeImage(name: string) {
  return [
    "jpg",
    "jpeg",
    "png",
    "webp",
    "avif",
    "gif",
    "bmp",
    "tif",
    "tiff",
    "heic",
    "heif",
  ].includes(extensionOf(name));
}

export function stripExtension(name: string) {
  const i = name.lastIndexOf(".");
  return i === -1 ? name : name.slice(0, i);
}
