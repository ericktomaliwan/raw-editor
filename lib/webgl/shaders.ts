export const VERTEX_SHADER = /* glsl */ `#version 300 es
out vec2 v_uv;
// The part of the image this render shows, as (x, y, width, height) in uv:
// the whole image while the crop is being edited, otherwise the crop itself.
uniform vec4 u_view;
void main() {
  // Full-screen triangle; flip Y so uv (0,0) is the top-left of the image.
  vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = u_view.xy + vec2(pos.x, 1.0 - pos.y) * u_view.zw;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_image;
uniform sampler2D u_curve;   // 256x1 RGBA: r,g,b per-channel curves, a = composite
uniform vec2  u_texel;        // 1 / image size
uniform vec2  u_outTexel;     // one output (canvas) pixel, in image uv
uniform float u_baseLod;      // mip level the output is sampled at (log2 of downscale)
uniform vec4  u_cropRect;     // the crop in uv (x, y, w, h); the vignette is centred on it
uniform float u_aspect;       // crop width / height, in pixels
uniform float u_bypass;       // 1 = show original
uniform float u_hasCurve;

// Basic
uniform float u_temperature, u_tint, u_exposure, u_contrast;
uniform float u_highlights, u_shadows, u_whites, u_blacks;
uniform float u_texture, u_clarity, u_dehaze, u_vibrance, u_saturation;
// Parametric curve (shadows, darks, lights, highlights)
uniform vec4 u_parametric;
// HSL
uniform float u_hslHue[8];
uniform float u_hslSat[8];
uniform float u_hslLum[8];
// Color grading: xy = (hue 0..1, sat 0..1)
uniform vec2 u_gradeShadow, u_gradeMidtone, u_gradeHighlight, u_gradeGlobal;
uniform float u_gradeBalance;
// Calibration: primaries matrix (linear RGB) + shadow tint (-1..1, green..magenta)
uniform mat3  u_calibration;
uniform float u_shadowTint;
// Detail / effects
uniform float u_sharpness, u_vignette, u_fade, u_grain, u_grayscale;
uniform float u_sharpenRadius;   // output pixels (0.5..3)
uniform float u_sharpenDetail;   // 0..1
uniform float u_sharpenMasking;  // 0..1
uniform float u_colorNoise, u_colorNoiseDetail, u_colorNoiseSmooth; // 0..1
uniform float u_vignetteMidpoint, u_vignetteFeather; // 0..1
uniform float u_vignetteRoundness;                   // -1..1

const float PI = 3.14159265359;

// ---------- colour helpers ----------
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Angular distance in [0, 0.5] on a 0..1 hue circle.
float hueDist(float a, float b) {
  float d = abs(a - b);
  return min(d, 1.0 - d);
}

// ---------- stages ----------

// How much a neighbour may count towards this pixel's colour: less the more
// its brightness (dl) and colour (dc) differ, so colour doesn't spread across
// an edge. sl and sc are the differences at which it counts about a third.
float noiseWeight(float dl, vec3 dc, float sl, float sc) {
  float a = dl / sl;
  float b = length(dc) / sc;
  return exp(-a * a - b * b);
}

// Colour noise reduction, on the source before any other stage (the colour
// stages would amplify the noise). Each pixel keeps its own brightness; its
// colour (rgb minus luma) is replaced by a weighted average of the colour
// around it: a 3x3 grid of taps on a mip level, from about 4 output pixels
// across at a low amount to about 25 at 100. Detail tightens the weights, so
// thin coloured lines and colour edges survive. Smoothness adds one sample 8x
// wider, for large, soft blotches. Levels and spacing are relative to the
// output, like presence and sharpening, so the preview matches the export.
vec3 colorNoiseReduction(vec3 src) {
  if (u_colorNoise <= 0.0) return src;
  float l0 = luma(src);
  vec3 ch0 = src - l0;
  float k = mix(0.5, 3.0, u_colorNoise); // tap spacing: 2^k output pixels
  float lod = u_baseLod + k;
  vec2 o = u_outTexel * exp2(k);
  float sl = mix(0.2, 0.03, u_colorNoiseDetail);
  float sc = mix(0.4, 0.05, u_colorNoiseDetail);
  // A little of the pixel's own colour, so it is kept when no neighbour matches.
  vec3 sum = ch0 * 0.05;
  float wsum = 0.05;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec3 t = textureLod(u_image, v_uv + vec2(float(i), float(j)) * o, lod).rgb;
      float lt = luma(t);
      float w = noiseWeight(lt - l0, t - lt - ch0, sl, sc);
      sum += (t - lt) * w;
      wsum += w;
    }
  }
  if (u_colorNoiseSmooth > 0.0) {
    vec3 t = textureLod(u_image, v_uv, lod + 3.0).rgb;
    float lt = luma(t);
    float w = 8.0 * u_colorNoiseSmooth * noiseWeight(lt - l0, t - lt - ch0, sl, sc);
    sum += (t - lt) * w;
    wsum += w;
  }
  // Fades in over the first quarter; beyond that the amount only widens the area.
  vec3 ch = mix(ch0, sum / wsum, min(u_colorNoise * 4.0, 1.0));
  // Clamped: a negative channel would turn into NaN in srgbToLinear's pow().
  return clamp(l0 + ch, 0.0, 1.0);
}

vec3 whiteBalance(vec3 lin) {
  // temperature: + = warmer (more red, less blue); tint: + = magenta, - = green
  float t = u_temperature * 0.35;
  float g = u_tint * 0.25;
  vec3 gain = vec3(1.0 + t, 1.0 - g, 1.0 - t);
  gain /= luma(gain); // keep overall brightness stable
  return lin * gain;
}

// Camera calibration in linear light: re-mix the primaries, then tint shadows.
vec3 calibrate(vec3 lin) {
  lin = u_calibration * lin;
  if (u_shadowTint != 0.0) {
    float l = luma(lin);
    float mask = 1.0 - smoothstep(0.0, 0.25, l); // linear-light shadows
    vec3 tint = vec3(1.0, -1.0, 1.0) * u_shadowTint * 0.05 * mask;
    lin += tint * min(l / 0.1, 1.0); // fade in from black so pure black stays neutral
  }
  return max(lin, 0.0);
}

vec3 toneBasic(vec3 c) {
  float l = luma(c);

  // Highlights / shadows recovery & lift (masked by luminance)
  float ms = 1.0 - smoothstep(0.0, 0.65, l);
  float mh = smoothstep(0.35, 1.0, l);
  if (u_shadows != 0.0) {
    vec3 lifted = pow(max(c, 0.0), vec3(1.0 - 0.6 * u_shadows));
    c = mix(c, lifted, ms);
  }
  if (u_highlights != 0.0) {
    vec3 comp = 1.0 - pow(max(1.0 - c, 0.0), vec3(1.0 + 0.6 * u_highlights));
    c = mix(c, comp, mh);
  }

  l = luma(c);
  // Whites / blacks: move the end points
  if (u_whites != 0.0) {
    c = mix(c, c * (1.0 + 0.35 * u_whites), smoothstep(0.2, 1.0, l));
  }
  if (u_blacks != 0.0) {
    c = mix(c, c + 0.3 * u_blacks, 1.0 - smoothstep(0.0, 0.55, l));
  }

  // Contrast around middle grey (sigmoid-ish for positive values)
  if (u_contrast != 0.0) {
    float k = u_contrast > 0.0 ? 1.0 + u_contrast * 1.2 : 1.0 + u_contrast * 0.7;
    c = (c - 0.5) * k + 0.5;
  }
  return c;
}

vec3 parametricCurve(vec3 c) {
  if (u_parametric == vec4(0.0)) return c;
  float l = luma(c);
  float ws = exp(-pow((l - 0.10) / 0.16, 2.0));
  float wd = exp(-pow((l - 0.35) / 0.16, 2.0));
  float wl = exp(-pow((l - 0.65) / 0.16, 2.0));
  float wh = exp(-pow((l - 0.90) / 0.16, 2.0));
  float delta = (u_parametric.x * ws + u_parametric.y * wd +
                 u_parametric.z * wl + u_parametric.w * wh) * 0.22;
  return c + delta;
}

vec3 pointCurve(vec3 c) {
  if (u_hasCurve < 0.5) return c;
  c = clamp(c, 0.0, 1.0);
  // Composite RGB first, then per-channel.
  vec3 o;
  o.r = texture(u_curve, vec2(c.r, 0.5)).a;
  o.g = texture(u_curve, vec2(c.g, 0.5)).a;
  o.b = texture(u_curve, vec2(c.b, 0.5)).a;
  o.r = texture(u_curve, vec2(o.r, 0.5)).r;
  o.g = texture(u_curve, vec2(o.g, 0.5)).g;
  o.b = texture(u_curve, vec2(o.b, 0.5)).b;
  return o;
}

// Local contrast using mip levels of the *source* image as cheap blurs.
// Blur levels are relative to u_baseLod so the effect looks the same whether
// we're drawing a downscaled preview or the full-resolution export.
vec3 presence(vec3 c, vec3 src) {
  if (u_texture == 0.0 && u_clarity == 0.0 && u_dehaze == 0.0) return c;
  float lSrc = luma(src);
  float l = luma(c);

  if (u_texture != 0.0) {
    float lb = luma(textureLod(u_image, v_uv, u_baseLod + 1.5).rgb);
    c += (lSrc - lb) * u_texture * 1.5;
  }
  if (u_clarity != 0.0) {
    float lb = luma(textureLod(u_image, v_uv, u_baseLod + 4.0).rgb);
    float mid = 1.0 - abs(l - 0.5) * 2.0; // emphasise midtones
    c += (lSrc - lb) * u_clarity * 1.2 * max(mid, 0.2);
  }
  if (u_dehaze != 0.0) {
    vec3 blur = textureLod(u_image, v_uv, u_baseLod + 5.0).rgb;
    float haze = min(min(blur.r, blur.g), blur.b);
    if (u_dehaze > 0.0) {
      float a = u_dehaze * 0.6 * haze;
      c = (c - a) / max(1.0 - a, 0.05);
      c = (c - 0.5) * (1.0 + u_dehaze * 0.3) + 0.5;
    } else {
      c = mix(c, vec3(0.75), -u_dehaze * 0.35);
    }
  }
  return c;
}

vec3 hslMixer(vec3 c) {
  vec3 hsv = rgb2hsv(clamp(c, 0.0, 1.0));
  if (hsv.y < 0.001) return c;

  const float centers[8] = float[8](0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 275.0, 315.0);
  float wsum = 0.0;
  float dh = 0.0, ds = 0.0, dl = 0.0;
  for (int i = 0; i < 8; i++) {
    float d = hueDist(hsv.x, centers[i] / 360.0);
    // Band width ~ 30deg either side, smooth falloff
    float w = max(0.0, 1.0 - d / (32.0 / 360.0));
    w = w * w;
    wsum += w;
    dh += w * u_hslHue[i];
    ds += w * u_hslSat[i];
    dl += w * u_hslLum[i];
  }
  if (wsum > 0.0) {
    dh /= wsum; ds /= wsum; dl /= wsum;
  }
  // Only affect visibly saturated pixels so greys stay neutral.
  float satMask = smoothstep(0.0, 0.25, hsv.y);
  dh *= satMask; ds *= satMask; dl *= satMask;

  hsv.x = fract(hsv.x + dh * (30.0 / 360.0));
  hsv.y = clamp(hsv.y * (1.0 + ds), 0.0, 1.0);
  vec3 o = hsv2rgb(hsv);
  // Luminance: brighten/darken while preserving hue
  if (dl > 0.0) o = mix(o, vec3(1.0), dl * 0.5 * hsv.y);
  else o = o * (1.0 + dl * 0.6 * hsv.y);
  return o;
}

vec3 colorGrade(vec3 c) {
  if (u_gradeShadow.y == 0.0 && u_gradeMidtone.y == 0.0 &&
      u_gradeHighlight.y == 0.0 && u_gradeGlobal.y == 0.0) return c;
  float l = luma(clamp(c, 0.0, 1.0));
  float bal = u_gradeBalance * 0.25;
  float wS = 1.0 - smoothstep(0.0, 0.6 + bal, l);
  float wH = smoothstep(0.4 + bal, 1.0, l);
  float wM = max(0.0, 1.0 - wS - wH);

  vec3 cs = hsv2rgb(vec3(u_gradeShadow.x, 1.0, 1.0)) - 0.5;
  vec3 cm = hsv2rgb(vec3(u_gradeMidtone.x, 1.0, 1.0)) - 0.5;
  vec3 ch = hsv2rgb(vec3(u_gradeHighlight.x, 1.0, 1.0)) - 0.5;
  vec3 cg = hsv2rgb(vec3(u_gradeGlobal.x, 1.0, 1.0)) - 0.5;

  vec3 tint = cs * u_gradeShadow.y * wS +
              cm * u_gradeMidtone.y * wM +
              ch * u_gradeHighlight.y * wH +
              cg * u_gradeGlobal.y;
  // Soft-light-ish application scaled so sat=100 is a strong but usable tint.
  return c + tint * 0.35 * (1.0 - abs(l - 0.5) * 0.8);
}

vec3 saturationVibrance(vec3 c) {
  float l = luma(c);
  if (u_vibrance != 0.0) {
    float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
    float amt = u_vibrance * (1.0 - smoothstep(0.0, 1.0, sat)) * 1.2;
    // Protect skin tones (orange hues) a bit when boosting
    if (u_vibrance > 0.0) {
      float h = rgb2hsv(clamp(c, 0.0, 1.0)).x;
      amt *= 1.0 - 0.5 * max(0.0, 1.0 - hueDist(h, 25.0 / 360.0) / (25.0 / 360.0));
    }
    c = mix(vec3(l), c, 1.0 + amt);
  }
  if (u_saturation != 0.0) {
    c = mix(vec3(l), c, 1.0 + u_saturation);
  }
  return c;
}

float tapLuma(vec2 offset, float lod) {
  return luma(textureLod(u_image, v_uv + offset, lod).rgb);
}

// Unsharp mask. Taps are spaced in *output* pixels (radius x one output pixel,
// not source texels) so the effect is visible at preview scale too, and the
// preview matches the export.
// At the defaults (radius 1, detail 25, masking 0) this is a plain 3x3 unsharp
// mask with a small noise floor.
vec3 sharpen(vec3 c, vec3 src) {
  if (u_sharpness <= 0.0) return c;
  float radius = u_sharpenRadius;
  vec2 o = u_outTexel * radius;
  // Mip level the output is drawn at. Past one pixel the taps are further apart
  // than the texels at that level, so they read a blurrier level instead and
  // no pixels are skipped in between.
  float lod = u_baseLod + log2(max(radius, 1.0));
  float ls = luma(src);
  float lc = radius > 1.0 ? tapLuma(vec2(0.0), lod) : ls;
  float lt = tapLuma(vec2(0.0, -o.y), lod);
  float lb = tapLuma(vec2(0.0,  o.y), lod);
  float ll = tapLuma(vec2(-o.x, 0.0), lod);
  float lr = tapLuma(vec2( o.x, 0.0), lod);
  float d1 = tapLuma(vec2(-o.x, -o.y), lod);
  float d2 = tapLuma(vec2( o.x, -o.y), lod);
  float d3 = tapLuma(vec2(-o.x,  o.y), lod);
  float d4 = tapLuma(vec2( o.x,  o.y), lod);
  // Gaussian-ish 3x3 blur: centre 4, edges 2, corners 1 (sum 16)
  float blur = (lc * 4.0 + (lt + lb + ll + lr) * 2.0 + (d1 + d2 + d3 + d4)) / 16.0;
  float detail = ls - blur;

  // Detail. Small differences are left alone so flat areas (noise) aren't
  // amplified. 25 sets that floor at 0.02. Higher values lower it to nothing at
  // 100, so fine texture is sharpened too. Lower values raise it and also stop
  // the result overshooting the darkest and brightest taps around it, which is
  // what draws a halo along a strong edge. At 0 there is no overshoot at all.
  float det = u_sharpenDetail;
  float noiseFloor = det < 0.25 ? mix(0.04, 0.02, det / 0.25) : 0.02 * (1.0 - det) / 0.75;
  float delta = detail * smoothstep(0.0, max(noiseFloor, 1e-4), abs(detail)) * u_sharpness * 2.5;
  float holdHalos = 1.0 - min(det / 0.25, 1.0);
  if (holdHalos > 0.0) {
    float lo = min(min(min(lt, lb), min(ll, lr)), min(min(d1, d2), min(d3, d4)));
    float hi = max(max(max(lt, lb), max(ll, lr)), max(max(d1, d2), max(d3, d4)));
    float held = clamp(ls + delta, min(lo, ls), max(hi, ls)) - ls;
    delta = mix(delta, held, holdHalos);
  }

  // Masking: sharpen only where there is an edge, measured as the brightness
  // gradient across the taps. The gradient needed rises with the slider, so at
  // 100 flat areas and fine texture are left out and only strong edges remain.
  if (u_sharpenMasking > 0.0) {
    float edge = length(vec2(lr - ll, lb - lt)) * 0.5;
    float needed = u_sharpenMasking * 0.15;
    delta *= smoothstep(needed * 0.5, needed, edge);
  }
  return c + delta;
}

vec3 vignette(vec3 c) {
  if (u_vignette == 0.0) return c;
  // Position within the crop (0..1), not within the image: the vignette frames
  // the picture you keep. This also holds while the crop is being edited and
  // the whole image is on screen.
  vec2 q = (v_uv - u_cropRect.xy) / u_cropRect.zw;
  // -1..1 across the crop on both axes, so equal distances trace an ellipse
  // with the crop's own proportions (roundness 0).
  vec2 p = (q - 0.5) * 2.0;
  float d;
  if (u_vignetteRoundness >= 0.0) {
    // Towards +100: a circle, measured in pixels and sized to the long edge.
    vec2 circle = p * vec2(u_aspect, 1.0) / max(u_aspect, 1.0);
    d = length(mix(p, circle, u_vignetteRoundness));
  } else {
    // Towards -100: a rounded rectangle (a superellipse that squares off).
    float n = mix(2.0, 8.0, -u_vignetteRoundness);
    vec2 a = abs(p);
    d = pow(pow(a.x, n) + pow(a.y, n), 1.0 / n);
  }
  // Midpoint moves where the darkening is half way; feather sets how wide the
  // transition is, down to a hard (anti-aliased) edge at 0. At 50 / 50 the
  // darkening runs from d = 0.45 to 1.35 (1 = the middle of an edge).
  float centre = mix(0.3, 1.5, u_vignetteMidpoint);
  float halfWidth = max(0.9 * u_vignetteFeather, fwidth(d));
  float v = smoothstep(centre - halfWidth, centre + halfWidth, d);
  float amt = (u_vignette > 0.0 ? u_vignette * 0.9 : u_vignette) * v;
  // Darkening spares highlights: bright points near the edge (a lamp, a
  // reflection) keep most of their brightness instead of turning grey. Stays
  // monotonic, so it never swaps the order of two tones.
  if (amt < 0.0) amt *= 1.0 - 0.7 * smoothstep(0.7, 1.0, luma(clamp(c, 0.0, 1.0)));
  return c * (1.0 + amt);
}

// Matte "faded film" look: blacks are lifted to a soft grey, whites are pulled
// down slightly, and midtones stay roughly where they were, so the picture
// loses depth without getting darker or lighter overall.
//
// The curve is a cubic fitted to that shape. At full strength it maps
// 0 -> 0.26, 0.25 -> 0.33, 0.5 -> 0.51, 0.75 -> 0.72 and 1 -> 0.87; the slider
// blends between the untouched image and that result. Applied per channel on
// display-referred values, so colours wash out a little too, as they should.
vec3 fade(vec3 c) {
  if (u_fade <= 0.0) return c;
  vec3 x = clamp(c, 0.0, 1.0);
  vec3 curve = ((-0.9772 * x + 1.708) * x - 0.1603) * x + 0.2878;
  vec3 faded = x + (curve - x) * 0.9;
  return mix(c, faded, u_fade);
}

vec3 grain(vec3 c) {
  if (u_grain <= 0.0) return c;
  vec2 px = floor(v_uv / u_texel);
  float n = hash12(px) - 0.5;
  float l = luma(c);
  float mask = 1.0 - abs(l - 0.5) * 1.2; // less grain in pure black/white
  return c + n * u_grain * 0.25 * max(mask, 0.15);
}

void main() {
  vec4 texel = texture(u_image, v_uv);
  vec3 src = texel.rgb;
  if (u_bypass > 0.5) { outColor = vec4(src, texel.a); return; }

  src = colorNoiseReduction(src);

  // Linear-light stages
  vec3 lin = srgbToLinear(src);
  lin = whiteBalance(lin);
  lin = calibrate(lin);
  lin *= exp2(u_exposure);
  vec3 c = linearToSrgb(lin);

  // Perceptual stages
  c = toneBasic(c);
  c = presence(c, src);
  c = parametricCurve(c);
  c = pointCurve(c);
  c = hslMixer(c);
  c = saturationVibrance(c);
  c = colorGrade(c);
  if (u_grayscale > 0.5) c = vec3(luma(c));
  c = sharpen(c, src);
  c = vignette(c);
  // After the vignette so darkened corners get the same matte floor; before
  // grain so the grain sits on top of the faded image rather than being flattened.
  c = fade(c);
  c = grain(c);

  outColor = vec4(clamp(c, 0.0, 1.0), texel.a);
}
`;
