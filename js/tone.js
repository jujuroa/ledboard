/*
 * LedTone
 * 원본 휘도(0~255) → 소자 밝기 b(0~1) 변환. GL 셰이더의 tone()과 같은 계산.
 * CPU 쪽 톤 처리는 모두 여기를 거친다 (BrightnessPipeline → Canvas2D 렌더러, 밝기 이징, 정지 소자 감광).
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
   * 프레임에서 소자별 목표 밝기 b를 구해 out에 쓴다.
   * @param frame  LedFrame rgba(그림 모드) 또는 luma8(LED 직접 입력). frame.js 참고
   * @param p      톤 파라미터 (bypass 포함. bypass는 luma8에만 적용)
   * @param out    Float32Array(cols × rows)
   */
  function computeTargets(frame, p, out, cols, rows) {
    const n = cols * rows;
    if (frame.kind === 'luma8') {
      const lut = p.bypass ? BYPASS : lutFor(p);
      const led = frame.data;
      for (let i = 0; i < n; i++) out[i] = lut[led[i]];
    } else if (frame.kind === 'rgba') {
      const lut = lutFor(p);
      const d = frame.data.getContext('2d').getImageData(0, 0, cols, rows).data;
      for (let i = 0, j = 0; i < n; i++, j += 4) {
        out[i] = lut[Math.round(0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2])];
      }
    } else {
      throw new Error(`computeTargets: 톤 처리 전 프레임이 아님 (${frame.kind})`);
    }
    return out;
  }

  global.LedTone = { makeLut, computeTargets };
})(window);
