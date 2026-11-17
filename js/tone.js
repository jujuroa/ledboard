/*
 * LedTone
 * 원본 휘도(0~255) → 소자 밝기 b(0~1) 변환. GL 셰이더의 tone()과 같은 계산.
 * Canvas2D 렌더러, 밝기 이징, 정지 소자 감광이 공유한다.
 */
(function (global) {
  'use strict';

  function makeLut(p) {
    const lut = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      let l = i / 255;
      if (p.invert) l = 1 - l;
      l = Math.min(1, Math.max(0, (l - 0.5) * p.contrast + 0.5 + p.brightness));
      if (p.levels <= 2) l = l >= p.threshold ? 1 : 0;
      else if (p.levels < 256) l = Math.round(l * (p.levels - 1)) / (p.levels - 1);
      lut[i] = Math.pow(l, p.gamma);
    }
    return lut;
  }

  /** ledTone = bypass: b = 값 / 255 */
  const BYPASS = new Float32Array(256).map((_, i) => i / 255);

  let cacheKey = '';
  let cacheLut = null;
  function lutFor(p) {
    const key = [p.invert, p.contrast, p.brightness, p.levels, p.threshold, p.gamma].join();
    if (key !== cacheKey) {
      cacheLut = makeLut(p);
      cacheKey = key;
    }
    return cacheLut;
  }

  /**
   * 소스에서 소자별 목표 밝기 b를 구해 out에 쓴다.
   * @param src  cols×rows 캔버스(그림 모드) 또는 {led: Uint8Array}(LED 직접 입력)
   * @param p    톤 파라미터 (bypass 포함)
   * @param out  Float32Array(cols × rows)
   */
  function computeTargets(src, p, out, cols, rows) {
    const n = cols * rows;
    if (src.led) {
      const lut = p.bypass ? BYPASS : lutFor(p);
      const led = src.led;
      for (let i = 0; i < n; i++) out[i] = lut[led[i]];
    } else {
      const lut = lutFor(p);
      const d = src.getContext('2d').getImageData(0, 0, cols, rows).data;
      for (let i = 0, j = 0; i < n; i++, j += 4) {
        out[i] = lut[Math.round(0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2])];
      }
    }
    return out;
  }

  global.LedTone = { makeLut, BYPASS, computeTargets };
})(window);
