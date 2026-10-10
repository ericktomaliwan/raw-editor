/** Site-wide constants shared by metadata, the OG image, and the UI. */

export const SITE_NAME = "RAW Editor";
export const SITE_TAGLINE = "Edit RAW and DNG photos in your browser";
export const SITE_DESCRIPTION =
  "Free browser-based RAW photo editor. Open DNG and camera RAW files, adjust exposure, white balance, tone curves, HSL and color grading on the GPU, apply .xmp presets, and export JPEG, PNG or WebP. Nothing is uploaded — everything runs locally.";

/** Production origin. Override with NEXT_PUBLIC_SITE_URL for staging/previews. */
export const PRODUCTION_URL = "https://www.imgedit.pics";

/**
 * Absolute origin used for canonical/OG URLs and the sitemap.
 * NEXT_PUBLIC_SITE_URL wins if set; otherwise the production domain, so that
 * deploys and local builds emit the real public URLs by default.
 */
export function getSiteUrl(): URL {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return new URL(explicit);
  return new URL(PRODUCTION_URL);
}
