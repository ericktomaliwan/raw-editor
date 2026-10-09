const RAW_EXTENSIONS = [
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
}

/**
 * Decode a dropped file into an ImageBitmap, honouring EXIF orientation and
 * downscaling if the image exceeds the GPU's max texture size.
 */
export async function loadImageFile(
  file: File,
  maxSize: number,
): Promise<LoadedImage> {
  if (isRawFile(file)) {
    throw new UnsupportedImageError(
      `RAW (.${extensionOf(file.name).toUpperCase()}) decoding isn't supported yet. Export a JPEG/TIFF from your camera software for now.`,
      "raw",
    );
  }
  if (!file.type.startsWith("image/") && !looksLikeImage(file.name)) {
    throw new UnsupportedImageError(
      `"${file.name}" doesn't look like an image file.`,
      "unknown",
    );
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Safari < 17 lacks imageOrientation support; fall back.
    try {
      bitmap = await createImageBitmap(file);
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
  return ["jpg", "jpeg", "png", "webp", "avif", "gif", "bmp", "tif", "tiff", "heic", "heif"].includes(
    extensionOf(name),
  );
}

export function stripExtension(name: string) {
  const i = name.lastIndexOf(".");
  return i === -1 ? name : name.slice(0, i);
}
