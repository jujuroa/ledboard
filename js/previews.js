/*
 * LedPreviews — 설정 패널의 미리보기
 *   sprite  글로우 이미지 (현재 LED 색으로)
 *   ease    밝기 이징의 계단 응답 곡선과 오버슈트·정착 시간
 *   idle    정지 소자 감광 요약 문구
 */
(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const EASE_PREVIEW_SEC = 1;

  function drawSprite(sprite, p) {
    const c = $('sprite-preview');
    const ctx = c.getContext('2d');
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(sprite.tinted(p.color), 0, 0, c.width, c.height);
    ctx.globalCompositeOperation = 'source-over';
  }

  /** 0 → 1 계단 입력에 대한 응답 곡선과 오버슈트·정착 시간 */
  function drawEase(p) {
    const c = $('ease-preview');
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(c.clientWidth * dpr) || c.width;
    const H = Math.round(c.clientHeight * dpr) || c.height;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const n = 200;
    const ys = BrightnessDynamics.stepResponse(p.easeFreq, p.easeZeta, EASE_PREVIEW_SEC, n);
    let peak = 0;
    for (const y of ys) peak = Math.max(peak, y);
    const top = Math.max(1.15, peak + 0.05);
    const pad = 6 * dpr;
    const X = (i) => pad + (i / (n - 1)) * (W - pad * 2);
    const Y = (v) => H - pad - (v / top) * (H - pad * 2);
    // 기준선: 목표(1), 0
    ctx.lineWidth = dpr;
    ctx.strokeStyle = '#2a2a33';
    ctx.beginPath();
    ctx.moveTo(pad, Y(0)); ctx.lineTo(W - pad, Y(0));
    ctx.stroke();
    ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.strokeStyle = '#5c5c68';
    ctx.beginPath();
    ctx.moveTo(pad, Y(1)); ctx.lineTo(W - pad, Y(1));
    ctx.stroke();
    ctx.setLineDash([]);
    // 응답 곡선 (표시값은 [0,1]로 잘리므로 1 위는 흐리게)
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = p.easeOn ? `rgb(${p.color.map((v) => Math.round(v * 255)).join(',')})` : '#6b6b76';
    ctx.beginPath();
    ys.forEach((y, i) => (i ? ctx.lineTo(X(i), Y(y)) : ctx.moveTo(X(i), Y(y))));
    ctx.stroke();

    // 오버슈트, 정착 시간(목표의 ±2% 안에 들어온 뒤 벗어나지 않는 시각)
    const over = Math.max(0, peak - 1) * 100;
    let settle = null;
    for (let i = n - 1; i >= 0; i--) {
      if (Math.abs(ys[i] - 1) > 0.02) {
        settle = i === n - 1 ? null : ((i + 1) / (n - 1)) * EASE_PREVIEW_SEC;
        break;
      }
      if (i === 0) settle = 0;
    }
    $('ease-info').textContent = !p.easeOn ? '꺼짐 · 밝기가 즉시 바뀜'
      : `오버슈트 ${over.toFixed(1)}% · 정착 ${settle == null ? `> ${EASE_PREVIEW_SEC}` : settle.toFixed(2)}초`
        + (over > 0 ? ' (1 초과분은 표시 시 잘림)' : '');
  }

  function drawIdle(p) {
    $('idle-info').textContent = !p.idleOn ? '꺼짐'
      : `변화 없으면 ${p.idleHold}초 뒤부터 어두워짐 · 약 ${IdleDimmer.time95(p).toFixed(1)}초에 최저 ${Math.round(p.idleFloor * 100)}% 근처`;
  }

  /** 세 미리보기를 모두 갱신 */
  function drawAll(sprite, p) {
    drawSprite(sprite, p);
    drawEase(p);
    drawIdle(p);
  }

  global.LedPreviews = { drawSprite, drawEase, drawIdle, drawAll };
})(window);
