/*
 * LedFrame — 소스 → 밝기 파이프라인 → 렌더러로 넘기는 프레임 형식
 *
 *   kind     data                       값의 의미
 *   rgba     cols×rows 캔버스            원본 픽셀. 톤 처리 전 (그림 모드)
 *   luma8    Uint8Array(cols × rows)    소자별 휘도 0~255. 톤 처리 전 (LED 직접 입력)
 *   bright   Float32Array(cols × rows)  최종 밝기 b 0~1. 톤 처리·감광·이징까지 끝난 값
 *
 * GLRenderer는 세 형식을 모두 받고 rgba·luma8은 셰이더에서 톤 처리한다.
 * Canvas2DRenderer는 bright만 받는다. 톤 처리는 BrightnessPipeline이 CPU에서 한다.
 */
(function (global) {
  'use strict';

  const LedFrame = {
    rgba: (canvas) => ({ kind: 'rgba', data: canvas, cols: canvas.width, rows: canvas.height }),
    luma8: (data, cols, rows) => ({ kind: 'luma8', data, cols, rows }),
    bright: (data, cols, rows) => ({ kind: 'bright', data, cols, rows }),
  };

  global.LedFrame = LedFrame;
})(window);
