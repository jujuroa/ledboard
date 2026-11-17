/*
 * Canvas2DRenderer
 * 아이디어를 가장 직접적으로 구현한 렌더러.
 * 소자마다 같은 글로우 이미지를 globalAlpha = 밝기로 drawImage('lighter' 합성) 한다.
 * WebGL2가 없을 때의 fallback이자, GL 결과와 비교하는 기준용이다.
 * (노출 압축은 픽셀 단위 비선형이라 이 렌더러에서는 적용되지 않음)
 */
(function (global) {
  'use strict';

  function css(rgb) {
    return `rgb(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)})`;
  }

  class Canvas2DRenderer {
    constructor(canvas) {
      this.name = 'Canvas2D';
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this._bg = document.createElement('canvas');
      this._bgKey = '';
    }

    /** 꺼진 소자(다이)와 배경을 한 번만 그려 캐시 */
    _background(layout, sprite, p) {
      const key = [this.canvas.width, this.canvas.height, layout.cols, layout.rows, layout.pitch,
        layout.originX, layout.originY, sprite.version, p.offColor.join(), p.background.join()].join('|');
      if (key === this._bgKey) return this._bg;
      const c = this._bg;
      c.width = this.canvas.width;
      c.height = this.canvas.height;
      const ctx = c.getContext('2d');
      ctx.fillStyle = css(p.background);
      ctx.fillRect(0, 0, c.width, c.height);
      if (p.offLevel > 0) {
        ctx.fillStyle = css(p.offColor.map((v, i) => Math.min(1, v + p.background[i])));
        const r = sprite.core * 0.5 * layout.pitch;
        for (let y = 0; y < layout.rows; y++) {
          for (let x = 0; x < layout.cols; x++) {
            const cx = layout.originX + (x + 0.5) * layout.pitch;
            const cy = layout.originY + (y + 0.5) * layout.pitch;
            if (sprite.shape === 'square') {
              ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
            } else {
              ctx.beginPath();
              ctx.arc(cx, cy, r, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }
      this._bgKey = key;
      return c;
    }

    render(src, layout, sprite, p) {
      const ctx = this.ctx;
      const { cols, rows, pitch, originX, originY } = layout;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.drawImage(this._background(layout, sprite, p), 0, 0);

      // 입력 3종: 최종 밝기(이징 결과) / LED 직접 입력 버퍼 / 캔버스 픽셀
      const sized = src.cols === cols && src.rows === rows;
      const bright = src.bright && sized ? src.bright : null;
      const led = !bright && src.led && sized ? src.led : null;
      const data = bright || led ? null : src.getContext('2d').getImageData(0, 0, cols, rows).data;
      const lut = bright ? null : led && p.bypass ? LedTone.BYPASS : LedTone.makeLut(p);
      const glow = sprite.tinted(p.color);
      const R = sprite.spread * pitch;
      const D = R * 2;

      ctx.globalCompositeOperation = 'lighter';
      for (let y = 0; y < rows; y++) {
        const cy = originY + (y + 0.5) * pitch - R;
        for (let x = 0; x < cols; x++) {
          let b;
          if (bright) {
            b = bright[y * cols + x] * p.intensity;
          } else {
            let luma;
            if (led) {
              luma = led[y * cols + x];
            } else {
              const i = (y * cols + x) * 4;
              luma = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
            }
            b = lut[luma] * p.intensity;
          }
          if (b <= 0.002) continue;
          // intensity > 1 이면 같은 이미지를 한 번 더 얹어 표현
          let a = b;
          while (a > 0.002) {
            ctx.globalAlpha = Math.min(1, a);
            ctx.drawImage(glow, originX + (x + 0.5) * pitch - R, cy, D, D);
            a -= 1;
          }
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  global.Canvas2DRenderer = Canvas2DRenderer;
})(window);
