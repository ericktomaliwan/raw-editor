import { type Adjustments, HSL_CHANNELS } from "../adjustments";
import { calibrationMatrix } from "../calibration";
import type { CropRect } from "../crop";
import { buildCurveTexture, hasPointCurve, LUT_SIZE } from "../curve";
import { type Layer, packLayerUniforms } from "../layers";
import { BrushMasks } from "./brushMasks";
import { createProgram } from "./program";
import { FRAGMENT_SHADER, VERTEX_SHADER } from "./shaders";

/** Everything a render needs to know about the edit. */
export interface RenderEdit {
  adjustments: Adjustments;
  /** Local adjustments; layer i uses shader slot i. */
  layers: readonly Layer[];
}

export interface RenderOptions {
  /** Output size in device pixels. Defaults to the canvas' current size. */
  width?: number;
  height?: number;
  /** Show the untouched source image. */
  bypass?: boolean;
  /**
   * The part of the image to draw, in image pixels. Defaults to all of it.
   * Pass the crop to render the cropped picture (display or export).
   */
  view?: CropRect;
  /**
   * The crop in effect, when it differs from `view` (i.e. while the crop is
   * being edited and the whole image is shown). Crop-relative effects such as
   * the vignette use this. Defaults to `view`.
   */
  crop?: CropRect;
  /** Index of the layer whose mask is tinted red on top of the picture. */
  showMask?: number;
}

/**
 * Thin WebGL2 wrapper: one source texture, one curve LUT texture, the painted
 * layer masks, one full-screen program. All adjustments are uniforms, so
 * re-rendering is a single draw call (plus drawing any new brush dabs).
 */
export class Renderer {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement;
  readonly maxTextureSize: number;

  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private imageTex: WebGLTexture | null = null;
  private curveTex: WebGLTexture;
  private brush: BrushMasks;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  /** Size of the texture being rendered (the photo, or an export's stand-in). */
  private imageWidth = 0;
  private imageHeight = 0;
  /** Size of the photo itself, which layer geometry is relative to. */
  private photoWidth = 0;
  private photoHeight = 0;
  /** The part of the photo the texture shows, in photo pixels; null = all of it. */
  private sourceRegion: CropRect | null = null;
  private curveKey = "";

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: false,
    });
    if (!gl) throw new Error("WebGL2 is not supported in this browser.");
    this.gl = gl;
    this.canvas = canvas;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

    this.program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    const vao = gl.createVertexArray();
    if (!vao) throw new Error("Failed to create VAO");
    this.vao = vao;

    const curveTex = gl.createTexture();
    if (!curveTex) throw new Error("Failed to create texture");
    this.curveTex = curveTex;
    gl.bindTexture(gl.TEXTURE_2D, curveTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.brush = new BrushMasks(gl);

    gl.useProgram(this.program);
    gl.uniform1i(this.loc("u_image"), 0);
    gl.uniform1i(this.loc("u_curve"), 1);
    // Its own unit: samplers of different types may not share one.
    gl.uniform1i(this.loc("u_brush"), 2);
  }

  get hasImage() {
    return this.imageTex !== null;
  }

  get imageSize() {
    return { width: this.imageWidth, height: this.imageHeight };
  }

  setImage(source: ImageBitmap | HTMLImageElement | HTMLCanvasElement) {
    if (this.imageTex) this.gl.deleteTexture(this.imageTex);
    this.imageTex = this.uploadImage(source);
    this.imageWidth = this.photoWidth = source.width;
    this.imageHeight = this.photoHeight = source.height;
    this.brush.setImageSize(source.width, source.height);
  }

  /**
   * Run `fn` with `pixels` (tightly packed RGBA, top row first) standing in
   * for the image, then put the image back. For exports at a reduced size: the
   * source is resampled to the output size first, and rendering it 1:1 keeps
   * every output-relative effect (sharpen, presence, grain) at the scale the
   * preview shows. `region` is the part of the photo the pixels show, in photo
   * pixels, so layer masks stay where they were drawn. Synchronous, so no
   * display render can happen in between.
   */
  withSource<T>(
    pixels: { data: Uint8Array; width: number; height: number },
    region: CropRect,
    fn: () => T,
  ): T {
    const saved = { tex: this.imageTex, width: this.imageWidth, height: this.imageHeight };
    const tex = this.uploadImage(pixels);
    this.imageTex = tex;
    this.imageWidth = pixels.width;
    this.imageHeight = pixels.height;
    this.sourceRegion = region;
    try {
      return fn();
    } finally {
      this.imageTex = saved.tex;
      this.imageWidth = saved.width;
      this.imageHeight = saved.height;
      this.sourceRegion = null;
      this.gl.deleteTexture(tex);
    }
  }

  render(edit: RenderEdit, opts: RenderOptions = {}) {
    const gl = this.gl;
    if (!this.imageTex) return;
    const adj = edit.adjustments;
    // Before anything else: drawing new brush dabs uses its own framebuffer.
    if (!opts.bypass) this.brush.sync(edit.layers);

    const width = opts.width ?? this.canvas.width;
    const height = opts.height ?? this.canvas.height;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imageTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.brush.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
    this.uploadCurveIfChanged(adj);

    const whole: CropRect = { x: 0, y: 0, width: this.imageWidth, height: this.imageHeight };
    const view = opts.view ?? whole;
    this.setUniforms(adj, opts.bypass ?? false, width, height, view, opts.crop ?? view);
    this.setLayerUniforms(edit.layers, opts.showMask ?? -1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * Read back the pixels of the last render as tightly packed RGBA.
   * Rows come bottom-to-top (GL convention). Returns null when the browser
   * gave the canvas a smaller drawing buffer than requested (very large
   * images), since the readback would then not be the full-size picture.
   */
  readPixels(): { data: Uint8Array; width: number; height: number } | null {
    const gl = this.gl;
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    if (width !== this.canvas.width || height !== this.canvas.height) return null;
    const data = new Uint8Array(width * height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    if (gl.getError() !== gl.NO_ERROR) return null;
    return { data, width, height };
  }

  dispose() {
    const gl = this.gl;
    if (this.imageTex) gl.deleteTexture(this.imageTex);
    gl.deleteTexture(this.curveTex);
    this.brush.dispose();
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    // Deliberately not calling WEBGL_lose_context here: a canvas only ever
    // yields one context, so a remount (e.g. React StrictMode) would be
    // handed back the lost one.
  }

  // ----- internals -----

  private uploadImage(
    source:
      | ImageBitmap
      | HTMLImageElement
      | HTMLCanvasElement
      | { data: Uint8Array; width: number; height: number },
  ): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error("Failed to create texture");
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    if ("data" in source) {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        source.width,
        source.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source.data,
      );
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    // Mip chain doubles as the blur pyramid for clarity/texture/dehaze.
    gl.generateMipmap(gl.TEXTURE_2D);
    return tex;
  }

  private uploadCurveIfChanged(adj: Adjustments) {
    const key = JSON.stringify([
      adj.toneCurve,
      adj.toneCurveRed,
      adj.toneCurveGreen,
      adj.toneCurveBlue,
    ]);
    if (key === this.curveKey) return;
    this.curveKey = key;
    const gl = this.gl;
    const data = buildCurveTexture(adj);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, LUT_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }

  private setUniforms(
    a: Adjustments,
    bypass: boolean,
    outW: number,
    outH: number,
    view: CropRect,
    crop: CropRect,
  ) {
    const gl = this.gl;
    const f = (name: string, v: number) => gl.uniform1f(this.loc(name), v);
    const n = (v: number) => v / 100;

    const iw = this.imageWidth;
    const ih = this.imageHeight;
    gl.uniform2f(this.loc("u_texel"), 1 / iw, 1 / ih);
    gl.uniform4f(this.loc("u_view"), view.x / iw, view.y / ih, view.width / iw, view.height / ih);
    gl.uniform4f(
      this.loc("u_cropRect"),
      crop.x / iw,
      crop.y / ih,
      crop.width / iw,
      crop.height / ih,
    );
    // One output pixel expressed in image uv: the view is what gets stretched over the output.
    gl.uniform2f(this.loc("u_outTexel"), view.width / iw / outW, view.height / ih / outH);
    // Mip level the GPU is already sampling the source at for this output size.
    const downscale = Math.max(view.width / outW, view.height / outH, 1);
    f("u_baseLod", Math.log2(downscale));
    f("u_aspect", crop.width / crop.height);
    f("u_bypass", bypass ? 1 : 0);
    f("u_hasCurve", hasPointCurve(a) ? 1 : 0);

    f("u_temperature", n(a.temperature));
    f("u_tint", n(a.tint));
    f("u_exposure", a.exposure);
    f("u_contrast", n(a.contrast));
    f("u_highlights", n(a.highlights));
    f("u_shadows", n(a.shadows));
    f("u_whites", n(a.whites));
    f("u_blacks", n(a.blacks));
    f("u_texture", n(a.texture));
    f("u_clarity", n(a.clarity));
    f("u_dehaze", n(a.dehaze));
    f("u_vibrance", n(a.vibrance));
    f("u_saturation", n(a.saturation));

    gl.uniform4f(
      this.loc("u_parametric"),
      n(a.parametricShadows),
      n(a.parametricDarks),
      n(a.parametricLights),
      n(a.parametricHighlights),
    );

    gl.uniform1fv(
      this.loc("u_hslHue[0]"),
      HSL_CHANNELS.map((c) => n(a.hslHue[c])),
    );
    gl.uniform1fv(
      this.loc("u_hslSat[0]"),
      HSL_CHANNELS.map((c) => n(a.hslSaturation[c])),
    );
    gl.uniform1fv(
      this.loc("u_hslLum[0]"),
      HSL_CHANNELS.map((c) => n(a.hslLuminance[c])),
    );

    const hue = (deg: number) => (((deg % 360) + 360) % 360) / 360;
    gl.uniform2f(this.loc("u_gradeShadow"), hue(a.shadowHue), n(a.shadowSaturation));
    gl.uniform2f(this.loc("u_gradeMidtone"), hue(a.midtoneHue), n(a.midtoneSaturation));
    gl.uniform2f(this.loc("u_gradeHighlight"), hue(a.highlightHue), n(a.highlightSaturation));
    gl.uniform2f(this.loc("u_gradeGlobal"), hue(a.globalHue), n(a.globalSaturation));
    f("u_gradeBalance", n(a.gradingBalance));

    gl.uniformMatrix3fv(this.loc("u_calibration"), false, calibrationMatrix(a));
    f("u_shadowTint", n(a.shadowTint));

    f("u_sharpness", n(a.sharpness));
    f("u_sharpenRadius", a.sharpenRadius);
    f("u_sharpenDetail", n(a.sharpenDetail));
    f("u_sharpenMasking", n(a.sharpenMasking));
    f("u_colorNoise", n(a.colorNoiseReduction));
    f("u_colorNoiseDetail", n(a.colorNoiseDetail));
    f("u_colorNoiseSmooth", n(a.colorNoiseSmoothness));
    f("u_vignette", n(a.vignette));
    f("u_vignetteMidpoint", n(a.vignetteMidpoint));
    f("u_vignetteRoundness", n(a.vignetteRoundness));
    f("u_vignetteFeather", n(a.vignetteFeather));
    f("u_fade", n(a.fade));
    f("u_grain", n(a.grain));
    f("u_grayscale", a.grayscale ? 1 : 0);
  }

  private setLayerUniforms(layers: readonly Layer[], showMask: number) {
    const gl = this.gl;
    const pw = this.photoWidth;
    const ph = this.photoHeight;
    const u = packLayerUniforms(layers, pw, ph);
    gl.uniform1i(this.loc("u_layerCount"), u.count);
    gl.uniform4fv(this.loc("u_maskA"), u.maskA);
    gl.uniform4fv(this.loc("u_maskB"), u.maskB);
    gl.uniform4fv(this.loc("u_rangeL"), u.rangeL);
    gl.uniform4fv(this.loc("u_rangeC"), u.rangeC);
    gl.uniform4fv(this.loc("u_localA"), u.localA);
    gl.uniform4fv(this.loc("u_localB"), u.localB);
    gl.uniform4fv(this.loc("u_localC"), u.localC);
    gl.uniform4fv(this.loc("u_localD"), u.localD);
    const long = Math.max(pw, ph, 1);
    gl.uniform2f(this.loc("u_isoScale"), pw / long, ph / long);
    const r = this.sourceRegion ?? { x: 0, y: 0, width: pw, height: ph };
    gl.uniform4f(this.loc("u_imageFrame"), r.x / pw, r.y / ph, r.width / pw, r.height / ph);
    gl.uniform1i(this.loc("u_showMask"), showMask < u.count ? showMask : -1);
  }

  private loc(name: string) {
    if (!this.uniforms.has(name)) {
      this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    }
    return this.uniforms.get(name) ?? null;
  }
}
