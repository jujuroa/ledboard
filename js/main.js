/*
 * main: 모듈 조립, UI 바인딩, 레이아웃 계산, 렌더 루프
 *
 *   Settings            설정 읽기·저장 (settings.js)
 *   FrameSource         입력 → LED 해상도 캔버스 (source.js)
 *   WsChannel/ConnPanel 외부 스트림 수신과 연결 패널 (ws-channel.js, conn-panel.js)
 *   BrightnessPipeline  톤 처리·감광·이징 (pipeline.js)
 *   GLRenderer/Canvas2DRenderer
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ---- 설정 -----------------------------------------------------------------
  const query = new URLSearchParams(location.search);
  const settings = new Settings(query);
  const ALL_KEYS = Settings.ALL_KEYS;

  // ---- 객체 -----------------------------------------------------------------
  settings.load();
  let P = settings.read();
  const sprite = new GlowSprite({ size: 256, spread: P.spread, core: P.core, halo: P.halo, haloWidth: P.haloWidth, shape: P.shape });
  const source = new FrameSource();
  source.fit = $('fit').value;
  source.text = $('text').value;
  source.textSpeed = parseFloat($('textSpeed').value);

  const pipeline = new BrightnessPipeline();

  const stage = $('stage');
  const canvases = { gl: $('cv-gl'), '2d': $('cv-2d') };
  const renderers = {};
  const glOk = GLRenderer.isSupported();
  if (!glOk) {
    $('renderer').querySelector('option[value=gl]').disabled = true;
    $('renderer').value = '2d';
  }

  function getRenderer() {
    const kind = $('renderer').value;
    if (!renderers[kind]) {
      renderers[kind] = kind === 'gl' ? new GLRenderer(canvases.gl) : new Canvas2DRenderer(canvases['2d']);
    }
    canvases.gl.hidden = kind !== 'gl';
    canvases['2d'].hidden = kind !== '2d';
    return renderers[kind];
  }

  let dirty = true;
  let needLayout = true;

  // ---- 외부 스트림 (WebSocket) ---------------------------------------------
  const channel = new WsChannel({
    getBoard: () => ({ cols: P.cols, rows: P.rows }),
    getRemoteConfig: () => $('remoteConfig').checked,
    onConfig: (cfg) => {
      const resized = (cfg.cols && cfg.cols !== P.cols) || (cfg.rows && cfg.rows !== P.rows);
      if (cfg.cols) { $('cols').value = cfg.cols; settings.release('cols'); }
      if (cfg.rows) { $('rows').value = cfg.rows; settings.release('rows'); }
      if (cfg.ledTone) $('ws-ledtone').value = cfg.ledTone;
      P = settings.read();
      if (resized) {
        needLayout = true;
        toast(`발신 측이 해상도를 ${P.cols} × ${P.rows}로 변경`);
        settings.save();
      }
      channel.boardChanged();   // LED 버퍼 재할당 + state 응답
      conn.applyMode();
      dirty = true;
    },
    onPicture: (drawable) => {
      if (source.kind !== 'stream') source.useStream();
      source.setStreamFrame(drawable);
      conn.applyMode();
      dirty = true;
    },
    onLed: () => {
      if (source.kind !== 'stream') source.useStream();
      conn.applyMode();
      dirty = true;
    },
    onStatus: () => conn.update(),
  });

  const conn = new ConnPanel({
    channel,
    source,
    getParams: () => P,
    requestRender: () => { dirty = true; },
  });

  // ---- 토스트 ---------------------------------------------------------------
  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  // ---- 레이아웃 -------------------------------------------------------------
  let layout = null;

  function computeLayout() {
    const dpr = window.devicePixelRatio || 1;
    const rect = stage.getBoundingClientRect();
    const margin = 1; // 보드 가장자리 여백(피치 단위) — 바깥 글로우가 잘리지 않게
    let pitch = P.pitch;
    if (P.autoPitch) {
      pitch = Math.min((rect.width - 24) / (P.cols + margin * 2), (rect.height - 24) / (P.rows + margin * 2));
      pitch = Math.max(0.5, Math.floor(pitch * 2) / 2);
      $('pitch').value = pitch;
      showOutput($('pitch'));
    }
    const cssW = (P.cols + margin * 2) * pitch;
    const cssH = (P.rows + margin * 2) * pitch;
    const pd = pitch * dpr;
    layout = {
      cols: P.cols,
      rows: P.rows,
      pitch: pd,
      pitchCss: pitch,
      originX: margin * pd,
      originY: margin * pd,
      width: Math.round(cssW * dpr),
      height: Math.round(cssH * dpr),
    };
    Object.values(canvases).forEach((c) => {
      c.width = layout.width;
      c.height = layout.height;
      c.style.width = cssW + 'px';
      c.style.height = cssH + 'px';
    });
    source.resize(P.cols, P.rows);
  }

  // ---- UI -----------------------------------------------------------------
  function fmt(el) {
    const step = parseFloat(el.step) || 1;
    const d = step >= 1 ? 0 : Math.min(3, String(step).split('.')[1].length);
    return parseFloat(el.value).toFixed(d);
  }

  function showOutput(input) {
    const out = input.parentElement.querySelector('output');
    if (out) out.textContent = fmt(input);
  }

  function syncVisibility() {
    const kind = $('src-kind').value;
    document.querySelectorAll('[data-for]').forEach((el) => {
      const f = el.dataset.for;
      let show = true;
      if (f === 'text') show = kind === 'text';
      else if (f === 'file') show = kind === 'file';
      else if (f === 'ws') show = kind === 'ws';
      else if (f === 'bit1') show = $('levels').value === '2';
      el.hidden = !show;
    });
    $('exposure').disabled = $('renderer').value !== 'gl';
    $('pitch').disabled = $('autoPitch').checked;
  }

  function onChange(e) {
    const id = e && e.target && e.target.id;
    if (id) settings.release(id);
    const prevCols = P.cols;
    const prevRows = P.rows;
    P = settings.read();
    if (e && e.target && e.target.type === 'range') showOutput(e.target);
    if (['core', 'halo', 'haloWidth', 'spread', 'shape'].includes(id)) {
      sprite.update({ spread: P.spread, core: P.core, halo: P.halo, haloWidth: P.haloWidth, shape: P.shape });
    }
    if (['cols', 'rows', 'pitch', 'autoPitch'].includes(id)) needLayout = true;
    if (P.cols !== prevCols || P.rows !== prevRows || id === 'remoteConfig') channel.boardChanged();
    if (id === 'fit') source.fit = $('fit').value;
    if (id === 'text') source.text = $('text').value;
    if (id === 'textSpeed') source.textSpeed = parseFloat($('textSpeed').value);
    if (id === 'easeOn' && P.easeOn) pipeline.dynamics.restart();
    if (id === 'idleOn' && P.idleOn) pipeline.dimmer.restart();
    LedPreviews.drawAll(sprite, P);
    syncVisibility();
    conn.applyMode();
    settings.save();
    dirty = true;
  }

  ALL_KEYS.forEach((k) => {
    $(k).addEventListener('input', onChange);
    $(k).addEventListener('change', onChange);
  });
  document.querySelectorAll('.slider input').forEach(showOutput);

  $('preset').addEventListener('change', (e) => {
    const v = e.target.value;
    if (!v) return;
    const [c, r] = v.split('x');
    $('cols').value = c;
    $('rows').value = r;
    e.target.value = '';
    settings.release('rows');
    onChange({ target: $('cols') });
  });

  $('swatches').addEventListener('click', (e) => {
    const c = e.target.dataset && e.target.dataset.c;
    if (!c) return;
    $('color').value = c;
    onChange({ target: $('color') });
  });

  async function selectSource(value) {
    if (value !== 'ws') channel.disconnect();
    try {
      if (value.startsWith('pattern:')) source.usePattern(value.slice(8));
      else if (value === 'text') source.useText($('text').value);
      else if (value === 'camera') await source.useCamera();
      else if (value === 'file' && !source.media) $('file').click();
      // ws: 바로 연결하지 않음. 연결 패널에서 [연결] (7.1절)
    } catch (err) {
      alertStat('소스 오류: ' + err.message);
    }
    syncVisibility();
    conn.applyMode();
    conn.update();
    dirty = true;
  }

  $('src-kind').addEventListener('change', (e) => selectSource(e.target.value));
  $('btn-open').addEventListener('click', () => $('file').click());
  $('btn-play').addEventListener('click', () => source.togglePlay());

  conn.bind();

  async function openFile(file) {
    if (!file) return;
    try {
      channel.disconnect();
      await source.loadFile(file);
      $('src-kind').value = 'file';
      syncVisibility();
      conn.applyMode();
      conn.update();
      dirty = true;
    } catch (err) {
      alertStat('파일 오류: ' + err.message);
    }
  }

  $('file').addEventListener('change', (e) => {
    openFile(e.target.files[0]);
    e.target.value = '';
  });

  // 드래그 앤 드롭
  ['dragenter', 'dragover'].forEach((t) => stage.addEventListener(t, (e) => {
    e.preventDefault();
    stage.classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach((t) => stage.addEventListener(t, (e) => {
    e.preventDefault();
    stage.classList.remove('drag');
  }));
  stage.addEventListener('drop', (e) => openFile(e.dataTransfer.files[0]));

  $('btn-snap').addEventListener('click', () => {
    renderFrame(performance.now());
    const a = document.createElement('a');
    a.download = `ledboard_${P.cols}x${P.rows}.png`;
    a.href = getRenderer().canvas.toDataURL('image/png');
    a.click();
  });

  $('btn-reset').addEventListener('click', () => {
    settings.restoreDefaults();
    document.querySelectorAll('.slider input').forEach(showOutput);
    P = settings.read();
    sprite.update({ spread: P.spread, core: P.core, halo: P.halo, haloWidth: P.haloWidth, shape: P.shape });
    source.fit = $('fit').value;
    source.text = $('text').value;
    source.textSpeed = parseFloat($('textSpeed').value);
    needLayout = true;
    channel.boardChanged();
    onChange({ target: {} });
  });

  function togglePanel() {
    document.body.classList.toggle('collapsed');
    setTimeout(() => { needLayout = true; dirty = true; }, 220);
  }

  $('btn-panel').addEventListener('click', togglePanel);

  // 단축키 (7.5절): 입력란에 포커스가 있으면 무시
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const k = e.key.toLowerCase();
    if (k === 'f') {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    } else if (k === 'h') {
      togglePanel();
    } else if (k === 's') {
      document.body.classList.toggle('no-stats');
    } else {
      return;
    }
    e.preventDefault();
  });

  window.addEventListener('resize', () => { needLayout = true; dirty = true; });
  window.addEventListener('beforeunload', () => channel.disconnect());

  // ---- 렌더 루프 ------------------------------------------------------------
  let statMsg = '';
  let statUntil = 0;
  function alertStat(msg) {
    statMsg = msg;
    statUntil = performance.now() + 4000;
  }

  let frames = 0;
  let fps = 0;
  let fpsT = performance.now();
  let renderMs = 0;

  let lastFrame = null;
  let lastLoopT = performance.now();

  /**
   * @param now         rAF 시각
   * @param dt          지난 루프 이후 경과(초). 이징 적분 간격
   * @param needSource  true면 소스를 다시 그려 목표 밝기를 갱신, false면 감광·이징만 진행
   */
  function renderFrame(now, dt = 0, needSource = true) {
    if (needLayout) {
      computeLayout();
      needLayout = false;
      needSource = true;
    }
    const t0 = performance.now();
    const renderer = getRenderer();
    // 이징·감광이 켜져 있거나 렌더러가 bright 프레임만 받으면 CPU에서 톤 처리
    if (pipeline.prepare(P, renderer.needsBrightness)) needSource = true;   // 새 크기의 소스로 목표를 다시 계산
    if (needSource || !lastFrame) {
      lastFrame = conn.directMode && channel.cols === P.cols && channel.rows === P.rows
        ? LedFrame.luma8(channel.front, channel.cols, channel.rows)
        : LedFrame.rgba(source.draw(now));
    }
    renderer.render(pipeline.process(lastFrame, P, now / 1000, dt, needSource), layout, sprite, P);
    if (conn.streamActive) channel.markDisplayed();
    renderMs = renderMs * 0.9 + (performance.now() - t0) * 0.1;
    frames++;
  }

  function loop(now) {
    const dt = (now - lastLoopT) / 1000;
    lastLoopT = now;
    const needSource = dirty || source.animated;
    if (needSource || pipeline.moving(P)) {
      renderFrame(now, dt, needSource);
      dirty = false;
    }
    if (now - fpsT > 500) {
      fps = (frames * 1000) / (now - fpsT);
      frames = 0;
      fpsT = now;
      const r = getRenderer();
      let text = now < statUntil ? statMsg
        : `${P.cols}×${P.rows} = ${(P.cols * P.rows).toLocaleString()} LED · 피치 ${layout.pitchCss}px · ${r.name} · ${fps.toFixed(0)} fps · ${renderMs.toFixed(1)} ms`
          + (P.easeOn ? ` · 이징 ${pipeline.dynamics.active ? '진행 중' : '정지'}` : '')
          + (P.idleOn ? ` · 감광 ${pipeline.dimmer.dimmed.toLocaleString()}개` : '');
      if ($('src-kind').value === 'ws' && now >= statUntil) text += conn.statsSuffix();
      $('stats').textContent = text;
      if (channel.state === 'retry' || channel.lastError) conn.update();   // 카운트다운·오류 만료
    }
    requestAnimationFrame(loop);
  }

  // ---- 시작 -----------------------------------------------------------------
  if (query.get('panel') === '0') document.body.classList.add('collapsed');
  if (query.get('stats') === '0') document.body.classList.add('no-stats');
  const qWs = query.get('ws');
  if (qWs) {
    $('src-kind').value = 'ws';
    conn.prefill(qWs, query.get('token'));   // 저장하지 않음
  }

  syncVisibility();
  LedPreviews.drawAll(sprite, P);
  conn.update();
  // 개발·자동 시험용 핸들 (콘솔에서 상태 확인)
  window.ledboard = {
    dynamics: pipeline.dynamics, dimmer: pipeline.dimmer, pipeline, channel, source, settings,
    params: () => P, base: () => pipeline.base,
  };
  if (qWs) conn.connect();
  requestAnimationFrame(loop);
})();
