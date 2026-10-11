import type { Preset } from "./xmp";

/** Prefix shared by every built-in preset id. */
export const BUILTIN_ID_PREFIX = "builtin:";

/**
 * Presets that ship with the editor. They appear in the Presets panel under
 * "Built-in", ahead of anything the user imports, and can't be removed.
 *
 * Like imported presets they are applied on a clean slate, so each one only
 * lists the settings it changes; everything else stays at its default.
 * Ids carry the `builtin:` prefix, which the imported-preset store refuses, so
 * the two sets can never collide.
 */
export const BUILTIN_PRESETS: Preset[] = [
  {
    id: `${BUILTIN_ID_PREFIX}high-detail`,
    name: "High Detail",
    source: "builtin",
    /*
     * A crisp, neutral look for subjects where fine detail is the point:
     * product shots, metal, machinery, texture.
     *
     * The tone sliders flatten the image and open the shadows, then the
     * S-shaped curve puts contrast back around the midtones. Together with
     * texture and clarity that gives punchy detail without crushed blacks.
     * Colour is boosted overall and then pulled back selectively: reds and
     * magentas lean toward orange, and reds, oranges, greens and blues are
     * muted, which keeps metal neutral and stops stray reflections competing
     * with the subject. No exposure or white balance, so it suits any photo.
     */
    adjustments: {
      // Tone
      contrast: -15,
      highlights: -5,
      shadows: 10,
      whites: -5,
      blacks: 10,
      // Presence
      texture: 25,
      clarity: 35,
      vibrance: 20,
      saturation: 10,
      // Curve: darker shadows, brighter highlights, midpoint held
      toneCurve: [
        [0, 0],
        [60, 50],
        [127, 128],
        [190, 206],
        [253, 255],
      ],
      // Colour mixer
      hslHue: {
        red: 26,
        orange: 10,
        yellow: 0,
        green: 8,
        aqua: 0,
        blue: -5,
        purple: 10,
        magenta: 30,
      },
      hslSaturation: {
        red: -20,
        orange: -30,
        yellow: -11,
        green: -30,
        aqua: 0,
        blue: -20,
        purple: 0,
        magenta: 0,
      },
      hslLuminance: {
        red: -15,
        orange: -10,
        yellow: 10,
        green: -10,
        aqua: 0,
        blue: 0,
        purple: 0,
        magenta: -5,
      },
      // Detail and effects
      sharpness: 20,
      vignette: -10,
    },
  },
];
