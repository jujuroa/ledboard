/*
 * main: UI 바인딩, 레이아웃 계산, 렌더 루프, 외부 스트림 연결
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'ledboard.settings.v1';
  const WS_URL_KEY = 'ledboard.wsUrl';

  // ---- 설정 -----------------------------------------------------------------
  const NUM_KEYS = ['cols', 'rows', 'pitch', 'textSpeed', 'intensity', 'offLevel', 'core', 'halo',
    'haloWidth', 'spread', 'exposure', 'brightness', 'contrast', 'gamma', 'threshold', 'easeFreq', 'easeZeta',
    'idleThr', 'idleHold', 'idleTau', 'idleFloor'];
  const SEL_KEYS = ['fit', 'shape', 'levels', 'renderer'];
  const CHK_KEYS = ['autoPitch', 'invert', 'remoteConfig', 'easeOn', 'idleOn'];
  const STR_KEYS = ['color', 'text'];
  const ALL_KEYS = [...NUM_KEYS, ...SEL_KEYS, ...CHK_KEYS, ...STR_KEYS];
  const TONE_KEYS = ['brightness', 'contrast', 'gamma', 'levels', 'threshold', 'invert'];

  const defaults = {};
  ALL_KEYS.forEach((k) => {
    const el = $(k);
    defaults[k] = el.type === 'checkbox' ? el.checked : el.value;
  });

  // 쿼리 파라미터 (docs/source-interface.md 7.5절). 이번 실행에만 적용하고 저장하지 않는다.
  const query = new URLSearchParams(location.search);
  const overrides = new Set();   // 쿼리로 덮어쓴 설정 키. 사용자가 직접 바꾸면 제거

  let stored = {};
  function loadSettings() {
    try {
      stored = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    } catch (e) {
      stored = {};
    }
    ALL_KEYS.forEach((k) => {
      if (!(k in stored)) return;
      const el = $(k);
      if (el.type === 'checkbox') el.checked = !!stored[k]; else el.value = stored[k];
    });
    for (const k of ['cols', 'rows']) {
      const v = parseInt(query.get(k), 10);
      if (v >= 1 && v <= 1024) {
        $(k).value = v;
        overrides.add(k);
      }
    }
  }

  function saveSettings() {
    try {
      const s = {};
      ALL_KEYS.forEach((k) => {
        if (overrides.has(k)) {
          if (k in stored) s[k] = stored[k];
          return;
        }
        const el = $(k);
        s[k] = el.type === 'checkbox' ? el.checked : el.value;
      });
      stored = s;
      localStorage.setItem(STORE_KEY, JSON.stringify(s));
    } catch (e) { /* 무시 */ }
  }

  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function lsSet(key, v) {
    try { localStorage.setItem(key, v); } catch (e) { /* 무시 */ }
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }

  function readParams() {
    const v = (k) => parseFloat($(k).value);
    const color = hexToRgb($('color').value);
    const offLevel = v('offLevel');
    return {
      cols: Math.max(1, Math.min(1024, Math.round(v('cols')) || 1)),
      rows: Math.max(1, Math.min(1024, Math.round(v('rows')) || 1)),
      pitch: v('pitch'),
      autoPitch: $('autoPitch').checked,
      shape: $('shape').value,
      color,
      intensity: v('intensity'),
      offLevel,
      offColor: color.map((c) => (0.5 * 0.65 + c * 0.35) * offLevel),
      background: [0.012, 0.012, 0.014],
      core: v('core'),
      halo: v('halo'),
      haloWidth: v('haloWidth'),
      spread: v('spread'),
      exposure: v('exposure'),
      brightness: v('brightness'),
      contrast: v('contrast'),
      gamma: v('gamma'),
      levels: parseInt($('levels').value, 10),
      threshold: v('threshold'),
      invert: $('invert').checked,
      bypass: false,
      easeOn: $('easeOn').checked,
      easeFreq: v('easeFreq'),
      easeZeta: v('easeZeta'),
      idleOn: $('idleOn').checked,
      idleThr: v('idleThr'),
      idleHold: v('idleHold'),
      idleTau: v('idleTau'),
      idleFloor: v('idleFloor'),
    };
  }

  // ---- 객체 -----------------------------------------------------------------
  loadSettings();
  let P = readParams();
  const sprite = new GlowSprite({ size: 256, spread: P.spread, core: P.core, halo: P.halo, haloWidth: P.haloWidth, shape: P.shape });
  const source = new FrameSource();
  source.fit = $('fit').value;
  source.text = $('text').value;
  source.textSpeed = parseFloat($('textSpeed').value);

  const dynamics = new BrightnessDynamics();   // 소자 밝기 이징 (가속도 모델)
  const dimmer = new IdleDimmer();             // 정지 소자 감광
  let base = new Float32Array(0);              // 톤 처리 직후 목표 밝기 (감광·이징 전)

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
      if (cfg.cols) { $('cols').value = cfg.cols; overrides.delete('cols'); }
      if (cfg.rows) { $('rows').value = cfg.rows; overrides.delete('rows'); }
      if (cfg.ledTone) $('ws-ledtone').value = cfg.ledTone;
      P = readParams();
      if (resized) {
        needLayout = true;
        toast(`발신 측이 해상도를 ${P.cols} × ${P.rows}로 변경`);
        saveSettings();
      }
      channel.boardChanged();   // LED 버퍼 재할당 + state 응답
      applyModeUi();
      dirty = true;
    },
    onPicture: (drawable) => {
      if (source.kind !== 'stream') source.useStream();
      source.setStreamFrame(drawable);
      applyModeUi();
      dirty = true;
    },
    onLed: () => {
      if (source.kind !== 'stream') source.useStream();
      applyModeUi();
      dirty = true;
    },
    onStatus: () => updateConnUi(),
  });

  const streamActive = () => source.kind === 'stream';
  const directMode = () => streamActive() && channel.mode === 'direct';

  function validWsUrl(u) {
    return /^wss?:\/\/[^\s/]+/i.test(u);
  }

  function wsConnect() {
    const url = $('ws-url').value.trim();
    if (!validWsUrl(url)) {
      $('ws-url').classList.add('invalid');
      $('ws-url').title = 'ws:// 또는 wss:// 로 시작하는 주소 필요';
      return;
    }
    $('ws-url').classList.remove('invalid');
    $('ws-url').title = '';
    channel.connect(url, $('ws-token').value);
  }

  const STATE_LABEL = {
    idle: '연결 안 됨',
    connecting: '연결 중',
    waiting: '연결됨 · 신호 없음',
    receiving: '수신 중',
    ended: '송출 종료',
    retry: '재연결',
    error: '오류',
  };

  function statusText() {
    const s = channel.state;
    if (s === 'retry') {
      const sec = Math.max(0, Math.ceil((channel.retryAt - performance.now()) / 1000));
      return `재연결 ${sec}초 후`;
    }
    if (s === 'receiving') return `수신 중 · ${channel.mode === 'direct' ? '직접 모드' : '그림 모드'}`;
    if (s === 'error' && channel.lastError) return `오류 · ${channel.lastError.message}`;
    return STATE_LABEL[s];
  }

  function updateConnUi() {
    const s = channel.state;
    const st = $('ws-status');
    st.className = 'st-' + s;
    st.innerHTML = '<i class="dot"></i>';
    st.appendChild(document.createTextNode(statusText()));
    $('ws-connect').disabled = s === 'connecting' || s === 'waiting' || s === 'receiving' || s === 'ended';
    $('ws-disconnect').disabled = s === 'idle';

    const live = s === 'waiting' || s === 'receiving' || s === 'ended';
    const st2 = channel.stats;
    $('ws-rx').textContent = live
      ? `${channel.rxFps.toFixed(1)} fps · 폐기 ${st2.dropped}`
        + (channel.mode === 'picture' && st2.decoded ? ` · 디코드 ${st2.decodeMs.toFixed(1)} ms` : '')
      : '—';

    const e = channel.lastError;
    $('ws-error').textContent = e && performance.now() - e.at < 10000
      ? `최근 오류: ${e.code}${e.seq != null ? ` (seq ${e.seq})` : ''} — ${e.message}`
      : '';

    // 신호 대기로 들어오면 보드를 꺼진 상태로 (이전 프레임이 있으면 유지)
    if (s === 'waiting' && $('src-kind').value === 'ws' && !streamActive()) {
      source.useStream();
      dirty = true;
    }

    // 무대 배지: 수신 중이 아닐 때만 모서리에 작게
    const badge = $('stage-badge');
    let text = '';
    if ($('src-kind').value === 'ws') {
      if (s === 'waiting') text = '신호 대기';
      else if (s === 'retry') text = `연결 끊김 · ${statusText().replace('재연결 ', '')} 재연결`;
      else if (s === 'error') text = '연결 오류';
      else if (s === 'ended') text = '송출 종료';
    }
    badge.textContent = text;
    badge.hidden = !text;
  }

  /** 표시 모드에 따라 컨트롤 비활성화 (7.4절) */
  function applyModeUi() {
    const direct = directMode();
    const bypass = direct && channel.ledTone === 'bypass';
    P.bypass = bypass;
    const fit = $('fit');
    fit.disabled = direct;
    fit.title = direct ? 'LED 직접 입력에는 적용되지 않음' : '';
    TONE_KEYS.forEach((k) => {
      const el = $(k);
      el.disabled = bypass;
      (el.closest('label') || el).title = bypass ? 'bypass: 받은 값을 그대로 표시' : '';
    });
    dirty = true;
  }

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

  // ---- 스프라이트 미리보기 ---------------------------------------------------
  function drawSpritePreview() {
    const c = $('sprite-preview');
    const ctx = c.getContext('2d');
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(sprite.tinted(P.color), 0, 0, c.width, c.height);
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- 이징 미리보기 ----------------------------------------------------------
  const EASE_PREVIEW_SEC = 1;

  /** 0 → 1 계단 입력에 대한 응답 곡선과 오버슈트·정착 시간 */
  function drawEasePreview() {
    const c = $('ease-preview');
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(c.clientWidth * dpr) || c.width;
    const H = Math.round(c.clientHeight * dpr) || c.height;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const n = 200;
    const ys = BrightnessDynamics.stepResponse(P.easeFreq, P.easeZeta, EASE_PREVIEW_SEC, n);
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
    ctx.strokeStyle = P.easeOn ? `rgb(${P.color.map((v) => Math.round(v * 255)).join(',')})` : '#6b6b76';
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
    $('ease-info').textContent = !P.easeOn ? '꺼짐 · 밝기가 즉시 바뀜'
      : `오버슈트 ${over.toFixed(1)}% · 정착 ${settle == null ? `> ${EASE_PREVIEW_SEC}` : settle.toFixed(2)}초`
        + (over > 0 ? ' (1 초과분은 표시 시 잘림)' : '');
  }

  function drawIdleInfo() {
    $('idle-info').textContent = !P.idleOn ? '꺼짐'
      : `변화 없으면 ${P.idleHold}초 뒤부터 어두워짐 · 약 ${IdleDimmer.time95(P).toFixed(1)}초에 최저 ${Math.round(P.idleFloor * 100)}% 근처`;
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
    if (id) overrides.delete(id);
    const prevCols = P.cols;
    const prevRows = P.rows;
    P = readParams();
    if (e && e.target && e.target.type === 'range') showOutput(e.target);
    if (['core', 'halo', 'haloWidth', 'spread', 'shape'].includes(id)) {
      sprite.update({ spread: P.spread, core: P.core, halo: P.halo, haloWidth: P.haloWidth, shape: P.shape });
    }
    if (['cols', 'rows', 'pitch', 'autoPitch'].includes(id)) needLayout = true;
    if (P.cols !== prevCols || P.rows !== prevRows || id === 'remoteConfig') channel.boardChanged();
    if (id === 'fit') source.fit = $('fit').value;
    if (id === 'text') source.text = $('text').value;
    if (id === 'textSpeed') source.textSpeed = parseFloat($('textSpeed').value);
    if (id === 'easeOn' && P.easeOn) dynamics.restart();
    if (id === 'idleOn' && P.idleOn) dimmer.restart();
    drawSpritePreview();
    drawEasePreview();
    drawIdleInfo();
    syncVisibility();
    applyModeUi();
    saveSettings();
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
    overrides.delete('rows');
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
    applyModeUi();
    updateConnUi();
    dirty = true;
  }

  $('src-kind').addEventListener('change', (e) => selectSource(e.target.value));
  $('btn-open').addEventListener('click', () => $('file').click());
  $('btn-play').addEventListener('click', () => source.togglePlay());

  // 연결 패널
  $('ws-url').value = lsGet(WS_URL_KEY) || '';
  $('ws-url').addEventListener('change', (e) => {
    const u = e.target.value.trim();
    e.target.classList.toggle('invalid', !!u && !validWsUrl(u));
    if (validWsUrl(u)) lsSet(WS_URL_KEY, u);
  });
  $('ws-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') wsConnect(); });
  $('ws-connect').addEventListener('click', wsConnect);
  $('ws-disconnect').addEventListener('click', () => {
    channel.disconnect();
    applyModeUi();
  });
  $('ws-token-show').addEventListener('click', () => {
    const t = $('ws-token');
    t.type = t.type === 'password' ? 'text' : 'password';
    $('ws-token-show').textContent = t.type === 'password' ? '표시' : '숨김';
  });
  $('ws-ledtone').addEventListener('change', (e) => {
    channel.setLedTone(e.target.value);
    applyModeUi();
  });

  async function openFile(file) {
    if (!file) return;
    try {
      channel.disconnect();
      await source.loadFile(file);
      $('src-kind').value = 'file';
      syncVisibility();
      applyModeUi();
      updateConnUi();
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
    ALL_KEYS.forEach((k) => {
      const el = $(k);
      if (el.type === 'checkbox') el.checked = defaults[k]; else el.value = defaults[k];
    });
    overrides.clear();
    document.querySelectorAll('.slider input').forEach(showOutput);
    P = readParams();
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

  let lastSrc = null;
  let lastLoopT = performance.now();

  /**
   * @param now         rAF 시각
   * @param dt          지난 루프 이후 경과(초). 이징 적분 간격
   * @param needSource  true면 소스를 다시 그려 목표 밝기를 갱신, false면 이징만 진행
   */
  function renderFrame(now, dt = 0, needSource = true) {
    if (needLayout) {
      computeLayout();
      needLayout = false;
      needSource = true;
    }
    const t0 = performance.now();
    const cpuPath = P.easeOn || P.idleOn;
    const n = P.cols * P.rows;
    if (cpuPath && base.length !== n) {
      base = new Float32Array(n);
      needSource = true;              // 새 크기의 소스로 목표를 다시 계산
    }
    let src = lastSrc;
    if (needSource || !src) {
      if (directMode() && channel.cols === P.cols && channel.rows === P.rows) {
        src = { led: channel.front, cols: channel.cols, rows: channel.rows };
      } else {
        src = source.draw(now);
      }
      lastSrc = src;
    }
    // CPU 밝기 파이프라인: 톤 처리 → [정지 소자 감광] → [밝기 이징] → 최종 밝기(R32F)
    if (cpuPath) {
      if (needSource) LedTone.computeTargets(lastSrc, P, base, P.cols, P.rows);
      let target = base;
      if (P.idleOn) {
        dimmer.resize(n);
        target = dimmer.update(base, now / 1000, P);   // 매 프레임: 시간이 지나며 감광
      }
      let out = target;
      if (P.easeOn) {
        dynamics.resize(P.cols, P.rows);
        if (needSource || P.idleOn) dynamics.setTargetArray(target);
        dynamics.step(dt, P.easeFreq, P.easeZeta);
        out = dynamics.display;
      }
      src = { bright: out, cols: P.cols, rows: P.rows };
    }
    getRenderer().render(src, layout, sprite, P);
    if (streamActive()) channel.markDisplayed();
    renderMs = renderMs * 0.9 + (performance.now() - t0) * 0.1;
    frames++;
  }

  function loop(now) {
    const dt = (now - lastLoopT) / 1000;
    lastLoopT = now;
    const needSource = dirty || source.animated;
    // 소스가 그대로여도 밝기가 목표로 움직이거나 감광이 진행 중이면 계속 그린다
    const moving = (P.easeOn && dynamics.active) || (P.idleOn && dimmer.active);
    if (needSource || moving) {
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
          + (P.easeOn ? ` · 이징 ${dynamics.active ? '진행 중' : '정지'}` : '')
          + (P.idleOn ? ` · 감광 ${dimmer.dimmed.toLocaleString()}개` : '');
      if ($('src-kind').value === 'ws' && now >= statUntil) {
        const s = channel.state;
        text += s === 'receiving'
          ? ` │ WS 수신 ${channel.rxFps.toFixed(1)} fps · 폐기 ${channel.stats.dropped} · ${channel.mode === 'direct' ? '직접 모드' : '그림 모드'}`
          : ` │ WS ${statusText()}`;
      }
      $('stats').textContent = text;
      if (channel.state === 'retry' || channel.lastError) updateConnUi();   // 카운트다운·오류 만료
    }
    requestAnimationFrame(loop);
  }

  // ---- 시작 -----------------------------------------------------------------
  if (query.get('panel') === '0') document.body.classList.add('collapsed');
  if (query.get('stats') === '0') document.body.classList.add('no-stats');
  const qWs = query.get('ws');
  if (qWs) {
    $('src-kind').value = 'ws';
    $('ws-url').value = qWs;               // 저장하지 않음
    $('ws-token').value = query.get('token') || '';
  }

  syncVisibility();
  drawSpritePreview();
  drawEasePreview();
  drawIdleInfo();
  updateConnUi();
  // 개발·자동 시험용 핸들 (콘솔에서 상태 확인)
  window.ledboard = { dynamics, dimmer, channel, source, params: () => P, base: () => base };
  if (qWs) wsConnect();
  requestAnimationFrame(loop);
})();
