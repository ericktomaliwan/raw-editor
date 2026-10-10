export const VERTEX_SHADER = /* glsl */ `#version 300 es
out vec2 v_uv;
void main() {
  // Full-screen triangle; flip Y so uv (0,0) is the top-left of the image.
  vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = vec2(pos.x, 1.0 - pos.y);
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
uniform vec2  u_outTexel;     // 1 / output (canvas) size, in uv
uniform float u_baseLod;      // mip level the output is sampled at (log2 of downscale)
uniform float u_aspect;       // width / height
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
// Detail / effects
uniform float u_sharpness, u_vignette, u_grain, u_grayscale;

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
vec3 whiteBalance(vec3 lin) {
  // temperature: + = warmer (more red, less blue); tint: + = magenta, - = green
  float t = u_temperature * 0.35;
  float g = u_tint * 0.25;
  vec3 gain = vec3(1.0 + t, 1.0 - g, 1.0 - t);
  gain /= luma(gain); // keep overall brightness stable
  return lin * gain;
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

// Unsharp mask with a 1-output-pixel radius. Taps are spaced in *output*
// pixels (not source texels) so the effect is visible at preview scale too.
vec3 sharpen(vec3 c, vec3 src) {
  if (u_sharpness <= 0.0) return c;
  vec2 o = u_outTexel;
  float ls = luma(src);
  float ln = luma(texture(u_image, v_uv + vec2(0.0, -o.y)).rgb)
           + luma(texture(u_image, v_uv + vec2(0.0,  o.y)).rgb)
           + luma(texture(u_image, v_uv + vec2(-o.x, 0.0)).rgb)
           + luma(texture(u_image, v_uv + vec2( o.x, 0.0)).rgb);
  float ld = luma(texture(u_image, v_uv + vec2(-o.x, -o.y)).rgb)
           + luma(texture(u_image, v_uv + vec2( o.x, -o.y)).rgb)
           + luma(texture(u_image, v_uv + vec2(-o.x,  o.y)).rgb)
           + luma(texture(u_image, v_uv + vec2( o.x,  o.y)).rgb);
  // Gaussian-ish 3x3 blur: centre 4, edges 2, corners 1 (sum 16)
  float blur = (ls * 4.0 + ln * 2.0 + ld) / 16.0;
  float detail = ls - blur;
  // Suppress amplification of near-flat areas (noise) a little.
  float mask = smoothstep(0.0, 0.02, abs(detail));
  return c + detail * mask * u_sharpness * 2.5;
}

vec3 vignette(vec3 c) {
  if (u_vignette == 0.0) return c;
  vec2 p = (v_uv - 0.5) * vec2(u_aspect, 1.0) / max(u_aspect, 1.0) * 2.0;
  float d = length(p);
  float v = smoothstep(0.45, 1.35, d);
  float amt = u_vignette > 0.0 ? u_vignette * 0.9 : u_vignette;
  return c * (1.0 + amt * v);
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

  // Linear-light stages
  vec3 lin = srgbToLinear(src);
  lin = whiteBalance(lin);
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
  c = grain(c);

  outColor = vec4(clamp(c, 0.0, 1.0), texel.a);
}
`;
