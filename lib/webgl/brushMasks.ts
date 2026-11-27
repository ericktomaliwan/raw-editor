import { MAX_LAYERS, type BrushStroke, type Layer } from "../layers";
import { diffStrokes, strokeDabs } from "../masks/brush";
import { createProgram } from "./program";

/** Long edge of the painted masks, in texels. Masks are soft; this is plenty. */
const MASK_LONG_EDGE = 2048;

const DAB_VERTEX = /* glsl */ `#version 300 es
layout(location = 0) in vec2 a_center; // uv, one per instance
uniform vec2 u_radius;                 // uv
out vec2 v_local;
void main() {
  vec2 corner = vec2((gl_VertexID & 1) == 0 ? -1.0 : 1.0, (gl_VertexID & 2) == 0 ? -1.0 : 1.0);
  v_local = corner;
  vec2 uv = a_center + corner * u_radius;
  // uv (0,0) lands on texel row 0, which is where the main shader samples it.
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
`;

const DAB_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_local;
uniform float u_hardness; // where the falloff starts, 0..1 of the radius
uniform float u_flow;     // 0..1
out vec4 outColor;
void main() {
  float d = length(v_local);
  float a = clamp((1.0 - d) / max(1.0 - u_hardness, 1e-3), 0.0, 1.0);
  a = a * a * (3.0 - 2.0 * a) * u_flow;
  outColor = vec4(a);
}
`;

interface Slot {
  layerId: string;
  strokes: readonly BrushStroke[];
  /** Dabs of the last stroke already on the mask (it may still be growing). */
  lastDabs: number;
}

/**
 * The painted part of each layer's mask, on the GPU: one slice of an RG8
 * array texture per layer slot (r = painted on, g = erased). Strokes are drawn
 * as instanced round dabs, and only what changed since the last frame is
 * drawn: new strokes, or the new end of the stroke being painted. Anything
 * else (an undo, a deleted layer) clears the slice and redraws it from the
 * strokes, which are the source of truth.
 */
export class BrushMasks {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buffer: WebGLBuffer;
  private fbo: WebGLFramebuffer;
  private tex: WebGLTexture;
  private width = 1;
  private height = 1;
  private depth = 1;
  /** Mask size for the current image, used once something is painted. */
  private target = { width: 1, height: 1 };
  /** Image proportions (width, height) / long edge, for round dabs. */
  private iso = { sx: 1, sy: 1 };
  private slots: (Slot | null)[] = new Array(MAX_LAYERS).fill(null);
  private locs: Record<"radius" | "hardness" | "flow", WebGLUniformLocation | null>;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, DAB_VERTEX, DAB_FRAGMENT);
    this.locs = {
      radius: gl.getUniformLocation(this.program, "u_radius"),
      hardness: gl.getUniformLocation(this.program, "u_hardness"),
      flow: gl.getUniformLocation(this.program, "u_flow"),
    };
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    const fbo = gl.createFramebuffer();
    if (!vao || !buffer || !fbo) throw new Error("Failed to set up the brush masks");
    this.vao = vao;
    this.buffer = buffer;
    this.fbo = fbo;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.bindVertexArray(null);
    // A 1x1 placeholder until something is painted, so the sampler is always complete.
    this.tex = this.allocate(1, 1, 1);
  }

  /** The array texture to bind for the main shader's u_brush. */
  get texture() {
    return this.tex;
  }

  /** A new photo: masks are sized to it, and anything drawn belongs to the old one. */
  setImageSize(width: number, height: number) {
    const long = Math.max(width, height, 1);
    const scale = Math.min(1, MASK_LONG_EDGE / long);
    this.target = {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    };
    this.iso = { sx: width / long, sy: height / long };
    this.slots.fill(null);
  }

  /**
   * Bring every slice up to date with `layers` (slot i = layers[i]). Leaves the
   * default framebuffer bound, blending off and the colour mask open.
   */
  sync(layers: readonly Layer[]) {
    // Enough slices for the highest slot with strokes; growing reallocates and redraws.
    let needed = 0;
    for (let i = 0; i < Math.min(layers.length, MAX_LAYERS); i++) {
      if (layers[i].strokes.length) needed = i + 1;
    }
    if (needed === 0 && this.slots.every((s) => !s || s.strokes.length === 0)) {
      // Nothing painted anywhere: just remember which layers are where.
      for (let i = 0; i < MAX_LAYERS; i++) {
        const l = layers[i];
        this.slots[i] = l ? { layerId: l.id, strokes: l.strokes, lastDabs: 0 } : null;
      }
      return;
    }
    if (
      needed > this.depth ||
      this.width !== this.target.width ||
      this.height !== this.target.height
    ) {
      // Two slices cover the usual one or two painted layers (about 11 MB at
      // 2048 x 1365); past that, all eight.
      const depth = needed <= 2 ? 2 : MAX_LAYERS;
      this.gl.deleteTexture(this.tex);
      this.tex = this.allocate(this.target.width, this.target.height, depth);
      this.slots.fill(null);
    }

    const gl = this.gl;
    let bound = false;
    const begin = () => {
      if (bound) return;
      bound = true;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.viewport(0, 0, this.width, this.height);
      gl.useProgram(this.program);
      gl.bindVertexArray(this.vao);
      gl.enable(gl.BLEND);
    };

    for (let i = 0; i < MAX_LAYERS; i++) {
      const layer = layers[i];
      const strokes = layer?.strokes ?? [];
      const slot = this.slots[i];
      const sameLayer = slot !== null && layer !== undefined && slot.layerId === layer.id;
      if (i >= this.depth) {
        this.slots[i] = layer ? { layerId: layer.id, strokes, lastDabs: 0 } : null;
        continue;
      }
      const drawnStrokes = sameLayer ? slot.strokes : [];
      // A slice that held another layer's painting starts over.
      const wasPainted = slot !== null && slot.strokes.length > 0;
      const diff =
        sameLayer || !wasPainted
          ? diffStrokes(drawnStrokes, strokes, sameLayer ? slot.lastDabs : 0)
          : ({ kind: "redraw" } as const);

      let lastDabs = sameLayer ? slot.lastDabs : 0;
      if (diff.kind === "append" && diff.from === strokes.length) {
        // Nothing new.
      } else {
        begin();
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.tex, 0, i);
        let from = 0;
        if (diff.kind === "redraw") {
          gl.colorMask(true, true, true, true);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
        } else if (diff.kind === "append") {
          from = diff.from;
        } else {
          lastDabs = this.drawStroke(strokes[diff.index], diff.fromDab);
          from = diff.index + 1;
        }
        for (let s = from; s < strokes.length; s++) lastDabs = this.drawStroke(strokes[s], 0);
      }
      this.slots[i] = layer ? { layerId: layer.id, strokes, lastDabs } : null;
    }

    if (bound) {
      gl.disable(gl.BLEND);
      gl.colorMask(true, true, true, true);
      gl.bindVertexArray(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  dispose() {
    const gl = this.gl;
    gl.deleteTexture(this.tex);
    gl.deleteFramebuffer(this.fbo);
    gl.deleteBuffer(this.buffer);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }

  // ----- internals -----

  /** Draw a stroke's dabs from `fromDab` on; returns its total dab count. */
  private drawStroke(stroke: BrushStroke, fromDab: number): number {
    const gl = this.gl;
    const dabs = strokeDabs(stroke, this.iso.sx, this.iso.sy);
    const total = dabs.length / 2;
    if (fromDab >= total) return total;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, dabs.subarray(fromDab * 2), gl.STREAM_DRAW);
    // A radius in long-edge units is a different span of uv on each axis.
    gl.uniform2f(this.locs.radius, stroke.size / this.iso.sx, stroke.size / this.iso.sy);
    gl.uniform1f(this.locs.hardness, 1 - stroke.feather / 100);
    gl.uniform1f(this.locs.flow, stroke.flow / 100);
    const count = total - fromDab;
    // Painting raises its own channel (screen: a + b - ab) and lowers the other
    // (b * (1 - a)), so painting over an erased area brings it back and vice versa.
    const [raise, lower] = stroke.erase ? [1, 0] : [0, 1];
    for (const [channel, src, dst] of [
      [raise, gl.ONE, gl.ONE_MINUS_SRC_COLOR],
      [lower, gl.ZERO, gl.ONE_MINUS_SRC_COLOR],
    ] as const) {
      gl.colorMask(channel === 0, channel === 1, false, false);
      gl.blendFunc(src, dst);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    }
    return total;
  }

  private allocate(width: number, height: number, depth: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error("Failed to create texture");
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RG8, width, height, depth);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    this.width = width;
    this.height = height;
    this.depth = depth;
    return tex;
  }
}
