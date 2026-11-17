/*
 * GlowSprite
 * 모든 LED 소자가 공유하는 "단일 글로우 이미지"를 만든다.
 *
 *   R 채널 : 글로우 프로파일 P(r)  (다이 코어 + 헤일로 꼬리)
 *   G 채널 : 다이(소자 몸체) 마스크 — 꺼진 소자를 어둡게 그릴 때 사용
 *
 * 소자별로는 이 이미지에 밝기 b를 곱하기(=투명도 제어)만 한다.
 * 화면에 보이는 경계는 b * P(r) = t(인지 임계값)인 지점이므로,
 * 꼬리가 지수 감쇠 P(r) ~ exp(-r/w)이면 보이는 반경은 r* = w * ln(b/t)로
 * 밝기에 따라 바깥으로 넓어진다. 즉 이미지 크기를 바꾸지 않아도 글로우가 "확장"되어 보인다.
 */
(function (global) {
  'use strict';

  function smoothstep(e0, e1, x) {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }

  class GlowSprite {
    /**
     * @param {object} opt
     * @param {number} opt.size      스프라이트 한 변 픽셀 수
     * @param {number} opt.spread    스프라이트 반경 (피치 단위). 이 바깥은 0
     * @param {number} opt.core      다이 지름 (피치 단위)
     * @param {number} opt.halo      헤일로 세기 (코어 대비)
     * @param {number} opt.haloWidth 헤일로 감쇠 길이 (피치 단위)
     * @param {string} opt.shape     'round' | 'square'
     */
    constructor(opt = {}) {
      this.size = opt.size || 256;
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.canvas.height = this.size;
      this.update(opt);
    }

    update(opt) {
      this.spread = opt.spread ?? 3;
      this.core = opt.core ?? 0.7;
      this.halo = opt.halo ?? 0.6;
      this.haloWidth = opt.haloWidth ?? 0.45;
      this.shape = opt.shape || 'round';
      this.version = (this.version || 0) + 1;
      this._render();
    }

    /** r: 중심으로부터 거리(피치 단위), 반환 [glow, dieMask] */
    profile(dx, dy) {
      const r = Math.hypot(dx, dy);
      const rc = this.core * 0.5;
      const aa = 0.04;
      // 다이 거리: 원형이면 유클리드, 사각형이면 체비셰프(모서리 살짝 둥글게)
      const dDie = this.shape === 'square'
        ? Math.max(Math.abs(dx), Math.abs(dy)) * 0.9 + r * 0.1
        : r;
      const die = 1 - smoothstep(rc - aa, rc + aa, dDie);
      // 다이 안쪽의 밝기 분포(중심이 약간 더 밝음)
      const coreLum = die * (0.85 + 0.15 * (1 - Math.min(1, dDie / Math.max(rc, 1e-3))));
      // 헤일로: 가까운 쪽 가우시안 + 먼 쪽 지수 꼬리
      const d = Math.max(0, dDie - rc * 0.6);
      const w = this.haloWidth;
      const halo = this.halo * (0.55 * Math.exp(-(d * d) / (2 * w * w * 0.35)) + 0.45 * Math.exp(-d / w));
      // 스프라이트 가장자리에서 0으로 떨어지게 하는 창 함수
      const e = Math.min(1, r / this.spread);
      const win = (1 - e * e) * (1 - e * e);
      return [Math.min(1, (coreLum + halo) * win), die];
    }

    _render() {
      const n = this.size;
      const ctx = this.canvas.getContext('2d');
      const img = ctx.createImageData(n, n);
      const px = img.data;
      const s = this.spread;
      for (let y = 0; y < n; y++) {
        const dy = ((y + 0.5) / n * 2 - 1) * s;
        for (let x = 0; x < n; x++) {
          const dx = ((x + 0.5) / n * 2 - 1) * s;
          const [g, die] = this.profile(dx, dy);
          const i = (y * n + x) * 4;
          px[i] = Math.round(g * 255);
          px[i + 1] = Math.round(die * 255);
          px[i + 2] = 0;
          px[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      this._tinted = null;
    }

    /**
     * Canvas2D 렌더러용: 단색으로 칠하고 알파 = 글로우 프로파일인 이미지.
     * 'lighter' 합성에서 globalAlpha만 바꿔 그리면 밝기 제어가 된다.
     */
    tinted(rgb) {
      const key = rgb.join(',') + '|' + this.version;
      if (this._tinted && this._tintedKey === key) return this._tinted;
      const n = this.size;
      const src = this.canvas.getContext('2d').getImageData(0, 0, n, n).data;
      const c = document.createElement('canvas');
      c.width = c.height = n;
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(n, n);
      const px = img.data;
      for (let i = 0; i < px.length; i += 4) {
        px[i] = rgb[0] * 255;
        px[i + 1] = rgb[1] * 255;
        px[i + 2] = rgb[2] * 255;
        px[i + 3] = src[i];
      }
      ctx.putImageData(img, 0, 0);
      this._tinted = c;
      this._tintedKey = key;
      return c;
    }
  }

  global.GlowSprite = GlowSprite;
})(window);
