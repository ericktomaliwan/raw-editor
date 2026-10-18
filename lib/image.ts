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
      // Half-size decoding isn't always enough, and the embedded preview isn't
      // limited at all, so fit the result like any other image.
      const bitmap = await fitWithin(decoded.bitmap, maxSize);
      return {
        bitmap,
        width: bitmap.width,
        height: bitmap.height,
        sourceWidth: decoded.sourceWidth,
        sourceHeight: decoded.sourceHeight,
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

  let decoded: ImageBitmap;
  try {
    decoded = await createImageBitmap(file, { ...DECODE_OPTIONS, imageOrientation: "from-image" });
  } catch {
    // Safari < 17 lacks imageOrientation support; fall back.
    try {
      decoded = await createImageBitmap(file, DECODE_OPTIONS);
    } catch {
      throw new UnsupportedImageError(
        `Couldn't decode "${file.name}". The browser doesn't support this format.`,
        "unknown",
      );
    }
  }

  // Read before fitting: a closed bitmap reports a size of 0.
  const sourceWidth = decoded.width;
  const sourceHeight = decoded.height;
  const bitmap = await fitWithin(decoded, maxSize);
  return {
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    sourceWidth,
    sourceHeight,
    name: file.name,
  };
}

/**
 * Keep colours unpremultiplied: the GPU upload, the shader and every encoder
 * treat RGB as straight colour. By default the bitmap would hold RGB already
 * multiplied by alpha, which darkens every semi-transparent pixel (dark
 * fringes around cut-outs, 255 red at half alpha exported as 128).
 */
const DECODE_OPTIONS: ImageBitmapOptions = { premultiplyAlpha: "none" };

/**
 * Scale a bitmap down so its long side is at most `maxSize` (the GPU's texture
 * limit), closing the original (which then reports a size of 0, so read its
 * size first). Returns it unchanged when it already fits.
 */
async function fitWithin(bitmap: ImageBitmap, maxSize: number): Promise<ImageBitmap> {
  const largest = Math.max(bitmap.width, bitmap.height);
  if (largest <= maxSize) return bitmap;
  const scale = maxSize / largest;
  const resized = await createImageBitmap(bitmap, {
    ...DECODE_OPTIONS,
    resizeWidth: Math.round(bitmap.width * scale),
    resizeHeight: Math.round(bitmap.height * scale),
    resizeQuality: "high",
  });
  bitmap.close();
  return resized;
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
