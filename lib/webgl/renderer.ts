import { type Adjustments, HSL_CHANNELS } from "../adjustments";
import { calibrationMatrix } from "../calibration";
import type { CropRect } from "../crop";
import { buildCurveTexture, hasPointCurve, LUT_SIZE } from "../curve";
import { FRAGMENT_SHADER, VERTEX_SHADER } from "./shaders";

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
}

/**
 * Thin WebGL2 wrapper: one source texture, one curve LUT texture, one
 * full-screen program. All adjustments are uniforms, so re-rendering is a
 * single draw call.
 */
export class Renderer {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement;
  readonly maxTextureSize: number;

  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private imageTex: WebGLTexture | null = null;
  private curveTex: WebGLTexture;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private imageWidth = 0;
  private imageHeight = 0;
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

    this.program = this.createProgram(VERTEX_SHADER, FRAGMENT_SHADER);
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

    gl.useProgram(this.program);
    gl.uniform1i(this.loc("u_image"), 0);
    gl.uniform1i(this.loc("u_curve"), 1);
  }

  get hasImage() {
    return this.imageTex !== null;
  }

  get imageSize() {
    return { width: this.imageWidth, height: this.imageHeight };
  }

  setImage(source: ImageBitmap | HTMLImageElement | HTMLCanvasElement) {
    const gl = this.gl;
    if (this.imageTex) gl.deleteTexture(this.imageTex);
    const tex = gl.createTexture();
    if (!tex) throw new Error("Failed to create texture");
    this.imageTex = tex;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    // Mip chain doubles as the blur pyramid for clarity/texture/dehaze.
    gl.generateMipmap(gl.TEXTURE_2D);
    this.imageWidth = source.width;
    this.imageHeight = source.height;
  }

  render(adj: Adjustments, opts: RenderOptions = {}) {
    const gl = this.gl;
    if (!this.imageTex) return;

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
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
    this.uploadCurveIfChanged(adj);

    const whole: CropRect = { x: 0, y: 0, width: this.imageWidth, height: this.imageHeight };
    const view = opts.view ?? whole;
    this.setUniforms(adj, opts.bypass ?? false, width, height, view, opts.crop ?? view);
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
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    // Deliberately not calling WEBGL_lose_context here: a canvas only ever
    // yields one context, so a remount (e.g. React StrictMode) would be
    // handed back the lost one.
  }

  // ----- internals -----

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
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      LUT_SIZE,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data,
    );
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
    gl.uniform4f(this.loc("u_cropRect"), crop.x / iw, crop.y / ih, crop.width / iw, crop.height / ih);
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
    gl.uniform2f(
      this.loc("u_gradeHighlight"),
      hue(a.highlightHue),
      n(a.highlightSaturation),
    );
    gl.uniform2f(this.loc("u_gradeGlobal"), hue(a.globalHue), n(a.globalSaturation));
    f("u_gradeBalance", n(a.gradingBalance));

    gl.uniformMatrix3fv(this.loc("u_calibration"), false, calibrationMatrix(a));
    f("u_shadowTint", n(a.shadowTint));

    f("u_sharpness", n(a.sharpness));
    f("u_vignette", n(a.vignette));
    f("u_fade", n(a.fade));
    f("u_grain", n(a.grain));
    f("u_grayscale", a.grayscale ? 1 : 0);
  }

  private loc(name: string) {
    if (!this.uniforms.has(name)) {
      this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    }
    return this.uniforms.get(name) ?? null;
  }

  private createProgram(vsSrc: string, fsSrc: string): WebGLProgram {
    const gl = this.gl;
    const vs = this.compile(gl.VERTEX_SHADER, vsSrc);
    const fs = this.compile(gl.FRAGMENT_SHADER, fsSrc);
    const program = gl.createProgram();
    if (!program) throw new Error("Failed to create program");
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Program link failed: ${log}`);
    }
    return program;
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Failed to create shader");
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compile failed: ${log}`);
    }
    return shader;
  }
}
