/*
 * GLRenderer (WebGL2)
 * LED 소자 하나 = 인스턴스 하나. 모든 인스턴스가 같은 글로우 텍스처(GlowSprite)를 쓰고,
 * 버텍스 셰이더가 소스 텍스처(cols x rows)에서 자기 픽셀을 읽어 밝기 b를 구한다.
 * 프래그먼트는 glow * color * b 를 가산 블렌딩(ONE, ONE)으로 쌓는다 = 투명도 제어.
 */
(function (global) {
  'use strict';

  const VS = `#version 300 es
  precision highp float;
  precision highp int;
  layout(location = 0) in vec2 aCorner;
  uniform sampler2D uSrc;
  uniform ivec2 uGrid;
  uniform vec2 uView;
  uniform vec2 uOrigin;
  uniform float uPitch;
  uniform float uSpread;
  uniform float uCoreHalf;
  uniform float uOffLevel;
  // tone: x=contrast, y=brightness, z=gamma, w=invert
  uniform vec4 uTone;
  // quant: x=levels, y=threshold
  uniform vec2 uQuant;
  // 입력 x: 0 = RGBA 캔버스, 1 = R8 휘도(LED 직접 입력), 2 = R32F 최종 밝기(이징 결과)
  //      y: 1이면 톤 처리 생략(bypass)
  uniform vec2 uInput;
  out vec2 vUV;
  out float vB;

  float tone(vec3 rgb) {
    if (uInput.x > 1.5) return rgb.r;   // 이징이 톤 처리까지 끝낸 값
    float l = uInput.x > 0.5 ? rgb.r : dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    if (uInput.y > 0.5) return l;
    if (uTone.w > 0.5) l = 1.0 - l;
    l = clamp((l - 0.5) * uTone.x + 0.5 + uTone.y, 0.0, 1.0);
    if (uQuant.x < 2.5) {
      l = step(uQuant.y, l);
    } else if (uQuant.x < 255.5) {
      float n = uQuant.x - 1.0;
      l = floor(l * n + 0.5) / n;
    }
    return pow(l, uTone.z);
  }

  void main() {
    int id = gl_InstanceID;
    int c = id % uGrid.x;
    int r = id / uGrid.x;
    float b = tone(texelFetch(uSrc, ivec2(c, r), 0).rgb);
    vB = b;

    // 꺼진 소자는 다이 크기 쿼드만, 꺼진 소자 표시도 안 하면 쿼드를 없앤다(필레이트 절약)
    float hs = b > 0.002 ? uSpread : uCoreHalf;
    if (b <= 0.002 && uOffLevel <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vUV = vec2(0.0);
      return;
    }
    vec2 center = uOrigin + (vec2(float(c), float(r)) + 0.5) * uPitch;
    vec2 p = center + aCorner * hs * uPitch;
    vec2 clip = p / uView * 2.0 - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    vUV = 0.5 + aCorner * 0.5 * (hs / uSpread);
  }`;

  const FS = `#version 300 es
  precision mediump float;
  uniform sampler2D uGlow;
  uniform vec3 uColor;
  uniform vec3 uOff;
  uniform float uIntensity;
  uniform float uExposure;
  in vec2 vUV;
  in float vB;
  out vec4 outColor;
  void main() {
    vec4 g = texture(uGlow, vUV);
    float a = g.r * vB;                 // 단일 글로우 이미지 x 밝기(투명도)
    if (uExposure > 0.01) {             // 선택: 노출 압축(코어는 포화, 꼬리는 들어올림)
      a = (1.0 - exp(-uExposure * a)) / (1.0 - exp(-uExposure));
    }
    vec3 col = uColor * a * uIntensity + uOff * g.g * (1.0 - vB);
    outColor = vec4(col, 1.0);
  }`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s));
    }
    return s;
  }

  class GLRenderer {
    static isSupported() {
      try {
        return !!document.createElement('canvas').getContext('webgl2');
      } catch (e) {
        return false;
      }
    }

    constructor(canvas) {
      this.name = 'WebGL2';
      this.needsBrightness = false;   // rgba·luma8은 셰이더에서 톤 처리 (frame.js 참고)
      this.canvas = canvas;
      const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false });
      if (!gl) throw new Error(I18n.t('err.noWebGL2'));
      this.gl = gl;

      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      this.prog = prog;
      this.u = {};
      const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const name = gl.getActiveUniform(prog, i).name;
        this.u[name] = gl.getUniformLocation(prog, name);
      }

      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);

      this.srcTex = this._makeTex(gl.NEAREST, gl.NEAREST);
      this.ledTex = this._makeTex(gl.NEAREST, gl.NEAREST);
      this.brightTex = this._makeTex(gl.NEAREST, gl.NEAREST);   // R32F는 필터링 불가 → NEAREST
      this.glowTex = this._makeTex(gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR);
      this._spriteVersion = -1;
    }

    _makeTex(minF, magF) {
      const gl = this.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minF);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magF);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }

    render(frame, layout, sprite, p) {
      const gl = this.gl;
      if (sprite.version !== this._spriteVersion) {
        gl.bindTexture(gl.TEXTURE_2D, this.glowTex);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, sprite.canvas);
        gl.generateMipmap(gl.TEXTURE_2D);
        this._spriteVersion = sprite.version;
      }
      gl.activeTexture(gl.TEXTURE0);
      const bright = frame.kind === 'bright';   // 최종 밝기 (CPU 파이프라인 결과)
      const led = frame.kind === 'luma8';       // LED 직접 입력
      if (bright) {
        gl.bindTexture(gl.TEXTURE_2D, this.brightTex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, frame.cols, frame.rows, 0, gl.RED, gl.FLOAT, frame.data);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      } else if (led) {
        gl.bindTexture(gl.TEXTURE_2D, this.ledTex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, frame.cols, frame.rows, 0, gl.RED, gl.UNSIGNED_BYTE, frame.data);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      } else {
        gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, frame.data);
      }
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.glowTex);

      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      const bg = p.background;
      gl.clearColor(bg[0], bg[1], bg[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);

      gl.useProgram(this.prog);
      const u = this.u;
      gl.uniform1i(u.uSrc, 0);
      gl.uniform1i(u.uGlow, 1);
      gl.uniform2i(u.uGrid, layout.cols, layout.rows);
      gl.uniform2f(u.uView, this.canvas.width, this.canvas.height);
      gl.uniform2f(u.uOrigin, layout.originX, layout.originY);
      gl.uniform1f(u.uPitch, layout.pitch);
      gl.uniform1f(u.uSpread, sprite.spread);
      gl.uniform1f(u.uCoreHalf, Math.min(sprite.spread, sprite.core * 0.6));
      gl.uniform1f(u.uOffLevel, p.offLevel);
      gl.uniform4f(u.uTone, p.contrast, p.brightness, p.gamma, p.invert ? 1 : 0);
      gl.uniform2f(u.uQuant, p.levels, p.threshold);
      gl.uniform2f(u.uInput, bright ? 2 : led ? 1 : 0, led && p.bypass ? 1 : 0);
      gl.uniform3fv(u.uColor, p.color);
      gl.uniform3fv(u.uOff, p.offColor);
      gl.uniform1f(u.uIntensity, p.intensity);
      gl.uniform1f(u.uExposure, p.exposure);

      gl.bindVertexArray(this.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, layout.cols * layout.rows);
      gl.bindVertexArray(null);
    }
  }

  global.GLRenderer = GLRenderer;
})(window);
