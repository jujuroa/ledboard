/*
 * I18n — UI 문자열 (한국어 / English)
 *
 *  - 언어 결정: 쿼리 lang → 저장값(localStorage LANG_KEY) → 브라우저 언어(ko*면 한국어, 나머지는 영어)
 *  - 쿼리 lang은 이번 실행에만 적용하고 저장하지 않는다 (cols·rows와 같은 규칙).
 *  - HTML: data-i18n(텍스트), data-i18n-title, data-i18n-placeholder, data-i18n-label(optgroup)에 키를 단다.
 *    자식 요소가 있는 요소(<label>텍스트 <input>)는 첫 텍스트 노드만 바꾼다.
 *  - JS: I18n.t('key', { name: 값 }). 문자열의 {name}을 치환한다.
 *  - 언어를 바꾸면 document에 'langchange' 이벤트를 보낸다. 동적 문구는 이 이벤트로 다시 그린다.
 */
(function (global) {
  'use strict';

  const LANG_KEY = 'ledboard.lang';
  const LANGS = ['ko', 'en'];

  const DICT = {
    ko: {
      // ---- 무대
      'stage.drop': '이미지 / 영상 파일을 여기에 놓기',
      'panel.collapse': '패널 접기',

      // ---- 소스
      'src.title': '소스',
      'src.group.builtin': '내장',
      'src.group.local': '로컬',
      'src.group.stream': '외부 스트림',
      'src.gradient': '패턴 · 밝기 계단 + 파형',
      'src.plasma': '패턴 · 플라즈마',
      'src.clock': '패턴 · 시계',
      'src.text': '텍스트 스크롤',
      'src.file': '파일 (이미지 / 영상)',
      'src.camera': '카메라',
      'src.screen': '화면 캡처 (예정)',
      'src.whep': 'WebRTC · WHEP (예정)',
      'ws.token': '토큰',
      'ws.tokenPlaceholder': '(선택)',
      'ws.tokenShowTitle': '토큰 표시',
      'ws.show': '표시',
      'ws.hide': '숨김',
      'ws.connect': '연결',
      'ws.disconnect': '끊기',
      'ws.status': '상태',
      'ws.rx': '수신',
      'ws.remoteConfig': '원격 설정 허용',
      'ws.ledTone': 'LED 톤',
      'ws.ledToneTitle': 'LED 직접 입력 값의 톤 처리',
      'ws.apply': 'apply (톤 처리 적용)',
      'ws.bypass': 'bypass (값 그대로)',
      'cam.device': '장치',
      'cam.deviceTitle': '카메라 입력 장치',
      'cam.fallback': '카메라 {n}',
      'text.speed': '스크롤 속도',
      'file.open': '파일 열기…',
      'file.play': '재생 / 정지',
      'fit.label': '맞춤',
      'fit.contain': '전체 보기 (contain)',
      'fit.cover': '채우기 (cover)',
      'fit.stretch': '늘리기 (stretch)',

      // ---- 해상도
      'res.title': '해상도',
      'res.preset': '프리셋…',
      'res.autoPitch': '화면에 맞춰 피치 자동',
      'res.pitch': '피치(px)',
      'res.shape': '소자 모양',
      'res.round': '원형',
      'res.square': '사각형',

      // ---- 색
      'color.title': 'LED 색',
      'color.intensity': '세기',
      'color.offLevel': '꺼진 소자 보이기',

      // ---- 글로우
      'glow.title': '글로우 (단일 이미지)',
      'glow.core': '다이 지름',
      'glow.halo': '헤일로 세기',
      'glow.haloWidth': '헤일로 폭',
      'glow.spread': '스프라이트 반경',
      'glow.exposure': '노출 압축',
      'glow.exposureTitle': '0 = 순수 투명도 제어. 값을 올리면 코어는 포화되고 꼬리가 들려 확장이 강조됨 (WebGL 전용)',

      // ---- 톤
      'tone.title': '톤',
      'tone.brightness': '밝기',
      'tone.contrast': '대비',
      'tone.gamma': '감마',
      'tone.levels': '계조',
      'tone.threshold': '임계값',
      'tone.invert': '반전',

      // ---- 이징
      'ease.title': '밝기 이징 (가속도 모델)',
      'ease.on': '이징 사용',
      'ease.onTitle': '소자마다 밝기와 변화 속도를 두고, 목표까지의 거리를 힘으로 적분',
      'ease.previewTitle': '0 → 1 계단 입력에 대한 밝기 응답 (가로 1초)',
      'ease.freq': '반응 속도(Hz)',
      'ease.freqTitle': '고유 진동수. 클수록 빠르게 따라감',
      'ease.zeta': '감쇠비 ζ',
      'ease.zetaTitle': '1 미만: 목표를 지나쳤다 돌아옴, 1: 임계 감쇠, 1 초과: 느리게 다가감',
      'ease.off': '꺼짐 · 밝기가 즉시 바뀜',
      'ease.info': '오버슈트 {over}% · 정착 {settle}초',
      'ease.clipped': ' (1 초과분은 표시 시 잘림)',

      // ---- 감광
      'idle.title': '정지 소자 감광',
      'idle.on': '감광 사용',
      'idle.onTitle': '밝기가 일정 수준 이상 변하지 않는 소자를 서서히 어둡게',
      'idle.thr': '변화 기준',
      'idle.thrTitle': "밝기가 이 값보다 크게 바뀌어야 '변화'로 봄 (0~1). 영상 노이즈를 거르려면 0.05 이상",
      'idle.hold': '유지 시간(초)',
      'idle.holdTitle': '변화가 멈춘 뒤 어두워지기 시작할 때까지 기다리는 시간',
      'idle.tau': '어두워지는 시간 τ(초)',
      'idle.tauTitle': '지수 감쇠 시상수 τ. 이 시간마다 남은 차이가 약 37%로 줄어듦',
      'idle.floor': '최저 밝기',
      'idle.floorTitle': '감광의 하한. 원래 밝기 대비 비율',
      'idle.off': '꺼짐',
      'idle.info': '변화 없으면 {hold}초 뒤부터 어두워짐 · 약 {t95}초에 최저 {floor}% 근처',

      // ---- 기타
      'misc.title': '기타',
      'misc.renderer': '렌더러',
      'misc.gl': 'WebGL2 (인스턴싱)',
      'misc.2d': 'Canvas2D (소자별 drawImage)',
      'misc.lang': '언어',
      'misc.snap': 'PNG 저장',
      'misc.reset': '설정 초기화',
      'misc.export': '설정 내보내기',
      'misc.exportTitle': '현재 설정을 JSON 파일로 저장',
      'misc.import': '설정 불러오기…',
      'misc.importTitle': 'JSON 설정 파일 불러오기',

      // ---- 상태 표시줄·알림
      'stats.pitch': '피치',
      'stats.easing': '이징',
      'stats.easingActive': '진행 중',
      'stats.easingIdle': '정지',
      'stats.dimmed': '감광 {n}개',
      'msg.boardResized': '발신 측이 해상도를 {cols} × {rows}로 변경',
      'msg.cameraError': '카메라 오류: {msg}',
      'msg.sourceError': '소스 오류: {msg}',
      'msg.fileError': '파일 오류: {msg}',
      'msg.imported': '설정 불러옴: {name}',
      'msg.importSkipped': ' (건너뜀: {keys})',
      'msg.importFailed': '설정 불러오기 실패: {msg}',
      'msg.jsonError': 'JSON 형식 오류',
      'err.camBusy': '다른 프로그램이 카메라를 사용 중이거나 장치를 열 수 없음',
      'err.camDenied': '카메라 권한이 거부됨 (Windows 설정 → 개인 정보 및 보안 → 카메라 확인)',
      'err.camNotFound': '카메라 장치를 찾을 수 없음',
      'err.camGone': '선택한 카메라 장치를 찾을 수 없음',
      'err.imageRead': '이미지를 읽을 수 없음',
      'err.notSettings': '설정 파일 형식이 아님',
      'err.otherApp': 'LEDBoard 설정 파일이 아님',
      'err.noValues': '적용할 설정 값이 없음',
      'err.noWebGL2': 'WebGL2 미지원',

      // ---- WebSocket 연결 패널
      'ws.st.idle': '연결 안 됨',
      'ws.st.connecting': '연결 중',
      'ws.st.waiting': '연결됨 · 신호 없음',
      'ws.st.receiving': '수신 중',
      'ws.st.ended': '송출 종료',
      'ws.st.retry': '재연결',
      'ws.st.error': '오류',
      'ws.retryIn': '재연결 {sec}초 후',
      'ws.receivingMode': '수신 중 · {mode}',
      'ws.errorWith': '오류 · {msg}',
      'ws.modeDirect': '직접 모드',
      'ws.modePicture': '그림 모드',
      'ws.statsRx': 'WS 수신 {fps} fps · 폐기 {dropped} · {mode}',
      'ws.rxLine': '{fps} fps · 폐기 {dropped}',
      'ws.decode': ' · 디코드 {ms} ms',
      'ws.lastError': '최근 오류: {code}{seq} — {msg}',
      'ws.badUrl': 'ws:// 또는 wss:// 로 시작하는 주소 필요',
      'ws.badge.waiting': '신호 대기',
      'ws.badge.retry': '연결 끊김 · {sec}초 후 재연결',
      'ws.badge.error': '연결 오류',
      'ws.badge.ended': '송출 종료',
      'ws.fitDirect': 'LED 직접 입력에는 적용되지 않음',
      'ws.toneBypass': 'bypass: 받은 값을 그대로 표시',
      'ws.err.protocol': '서버가 서브프로토콜 {proto}을 선택하지 않음',
      'ws.err.auth': '인증 실패 (종료 코드 {code})',
      'ws.err.tooLarge': '메시지 크기 {size} > {max}',
      'ws.err.magic': '헤더 magic이 "LB"가 아님',
      'ws.err.version': '지원하지 않는 version {v}',
      'ws.err.type': '알 수 없는 type 0x{type}',
      'ws.err.configDenied': '시뮬레이터에서 원격 설정을 허용하지 않음',
      'ws.err.intRange': '{kv} (1~1024 정수)',
      'ws.err.decode': '이미지 디코드 실패',
      'ws.err.rawSize': 'RAW 크기 {w}×{h}',
      'ws.err.region': '영역 ({x},{y},{w},{h})이 보드 {cols}×{rows}를 벗어남',
    },

    en: {
      'stage.drop': 'Drop an image / video file here',
      'panel.collapse': 'Collapse panel',

      'src.title': 'Source',
      'src.group.builtin': 'Built-in',
      'src.group.local': 'Local',
      'src.group.stream': 'External stream',
      'src.gradient': 'Pattern · brightness steps + wave',
      'src.plasma': 'Pattern · plasma',
      'src.clock': 'Pattern · clock',
      'src.text': 'Text scroll',
      'src.file': 'File (image / video)',
      'src.camera': 'Camera',
      'src.screen': 'Screen capture (planned)',
      'src.whep': 'WebRTC · WHEP (planned)',
      'ws.token': 'Token',
      'ws.tokenPlaceholder': '(optional)',
      'ws.tokenShowTitle': 'Show token',
      'ws.show': 'Show',
      'ws.hide': 'Hide',
      'ws.connect': 'Connect',
      'ws.disconnect': 'Disconnect',
      'ws.status': 'Status',
      'ws.rx': 'RX',
      'ws.remoteConfig': 'Allow remote config',
      'ws.ledTone': 'LED tone',
      'ws.ledToneTitle': 'Tone processing for direct LED input',
      'ws.apply': 'apply (tone processing)',
      'ws.bypass': 'bypass (values as is)',
      'cam.device': 'Device',
      'cam.deviceTitle': 'Camera input device',
      'cam.fallback': 'Camera {n}',
      'text.speed': 'Scroll speed',
      'file.open': 'Open file…',
      'file.play': 'Play / Pause',
      'fit.label': 'Fit',
      'fit.contain': 'Show all (contain)',
      'fit.cover': 'Fill (cover)',
      'fit.stretch': 'Stretch (stretch)',

      'res.title': 'Resolution',
      'res.preset': 'Preset…',
      'res.autoPitch': 'Auto pitch to fit screen',
      'res.pitch': 'Pitch (px)',
      'res.shape': 'LED shape',
      'res.round': 'Round',
      'res.square': 'Square',

      'color.title': 'LED color',
      'color.intensity': 'Intensity',
      'color.offLevel': 'Unlit LED visibility',

      'glow.title': 'Glow (single image)',
      'glow.core': 'Die diameter',
      'glow.halo': 'Halo strength',
      'glow.haloWidth': 'Halo width',
      'glow.spread': 'Sprite radius',
      'glow.exposure': 'Exposure compression',
      'glow.exposureTitle': '0 = pure opacity control. Higher values saturate the core and lift the tail to emphasize the spread (WebGL only)',

      'tone.title': 'Tone',
      'tone.brightness': 'Brightness',
      'tone.contrast': 'Contrast',
      'tone.gamma': 'Gamma',
      'tone.levels': 'Levels',
      'tone.threshold': 'Threshold',
      'tone.invert': 'Invert',

      'ease.title': 'Brightness easing (acceleration model)',
      'ease.on': 'Enable easing',
      'ease.onTitle': 'Each LED keeps a brightness and velocity and integrates the distance to the target as a force',
      'ease.previewTitle': 'Brightness response to a 0 → 1 step input (1 s across)',
      'ease.freq': 'Response (Hz)',
      'ease.freqTitle': 'Natural frequency. Higher follows faster',
      'ease.zeta': 'Damping ratio ζ',
      'ease.zetaTitle': 'Below 1: overshoots and comes back, 1: critically damped, above 1: approaches slowly',
      'ease.off': 'Off · brightness changes instantly',
      'ease.info': 'Overshoot {over}% · settles in {settle} s',
      'ease.clipped': ' (values above 1 are clipped on display)',

      'idle.title': 'Idle LED dimming',
      'idle.on': 'Enable dimming',
      'idle.onTitle': 'Gradually dim LEDs whose brightness stops changing',
      'idle.thr': 'Change threshold',
      'idle.thrTitle': "Brightness must change by more than this to count as a 'change' (0–1). Use 0.05 or more to ignore video noise",
      'idle.hold': 'Hold time (s)',
      'idle.holdTitle': 'Time to wait after changes stop before dimming starts',
      'idle.tau': 'Fade time τ (s)',
      'idle.tauTitle': 'Exponential decay time constant τ. The remaining difference drops to about 37% every τ',
      'idle.floor': 'Minimum brightness',
      'idle.floorTitle': 'Lower limit of dimming, as a fraction of the original brightness',
      'idle.off': 'Off',
      'idle.info': 'Without change, dims after {hold} s · near the {floor}% floor in about {t95} s',

      'misc.title': 'Misc',
      'misc.renderer': 'Renderer',
      'misc.gl': 'WebGL2 (instancing)',
      'misc.2d': 'Canvas2D (drawImage per LED)',
      'misc.lang': 'Language',
      'misc.snap': 'Save PNG',
      'misc.reset': 'Reset settings',
      'misc.export': 'Export settings',
      'misc.exportTitle': 'Save the current settings as a JSON file',
      'misc.import': 'Import settings…',
      'misc.importTitle': 'Load a JSON settings file',

      'stats.pitch': 'pitch',
      'stats.easing': 'easing',
      'stats.easingActive': 'active',
      'stats.easingIdle': 'idle',
      'stats.dimmed': '{n} dimmed',
      'msg.boardResized': 'Sender changed the resolution to {cols} × {rows}',
      'msg.cameraError': 'Camera error: {msg}',
      'msg.sourceError': 'Source error: {msg}',
      'msg.fileError': 'File error: {msg}',
      'msg.imported': 'Settings imported: {name}',
      'msg.importSkipped': ' (skipped: {keys})',
      'msg.importFailed': 'Failed to import settings: {msg}',
      'msg.jsonError': 'invalid JSON',
      'err.camBusy': 'The camera is in use by another program or cannot be opened',
      'err.camDenied': 'Camera permission denied (check Windows Settings → Privacy & security → Camera)',
      'err.camNotFound': 'No camera device found',
      'err.camGone': 'The selected camera device was not found',
      'err.imageRead': 'Cannot read the image',
      'err.notSettings': 'Not a settings file',
      'err.otherApp': 'Not a LEDBoard settings file',
      'err.noValues': 'No settings to apply',
      'err.noWebGL2': 'WebGL2 not supported',

      'ws.st.idle': 'Not connected',
      'ws.st.connecting': 'Connecting',
      'ws.st.waiting': 'Connected · no signal',
      'ws.st.receiving': 'Receiving',
      'ws.st.ended': 'Stream ended',
      'ws.st.retry': 'Reconnecting',
      'ws.st.error': 'Error',
      'ws.retryIn': 'Reconnecting in {sec} s',
      'ws.receivingMode': 'Receiving · {mode}',
      'ws.errorWith': 'Error · {msg}',
      'ws.modeDirect': 'direct mode',
      'ws.modePicture': 'picture mode',
      'ws.statsRx': 'WS RX {fps} fps · dropped {dropped} · {mode}',
      'ws.rxLine': '{fps} fps · dropped {dropped}',
      'ws.decode': ' · decode {ms} ms',
      'ws.lastError': 'Last error: {code}{seq} — {msg}',
      'ws.badUrl': 'Address must start with ws:// or wss://',
      'ws.badge.waiting': 'Waiting for signal',
      'ws.badge.retry': 'Disconnected · reconnecting in {sec} s',
      'ws.badge.error': 'Connection error',
      'ws.badge.ended': 'Stream ended',
      'ws.fitDirect': 'Not applied to direct LED input',
      'ws.toneBypass': 'bypass: received values are shown as is',
      'ws.err.protocol': 'Server did not select subprotocol {proto}',
      'ws.err.auth': 'Authentication failed (close code {code})',
      'ws.err.tooLarge': 'Message size {size} > {max}',
      'ws.err.magic': 'Header magic is not "LB"',
      'ws.err.version': 'Unsupported version {v}',
      'ws.err.type': 'Unknown type 0x{type}',
      'ws.err.configDenied': 'Remote config is not allowed by the simulator',
      'ws.err.intRange': '{kv} (integer 1–1024)',
      'ws.err.decode': 'Image decode failed',
      'ws.err.rawSize': 'RAW size {w}×{h}',
      'ws.err.region': 'Region ({x},{y},{w},{h}) is outside the {cols}×{rows} board',
    },
  };

  function storageGet() {
    try { return localStorage.getItem(LANG_KEY); } catch (e) { return null; }
  }
  function storageSet(v) {
    try { localStorage.setItem(LANG_KEY, v); } catch (e) { /* 무시 */ }
  }

  function detect(queryLang) {
    if (LANGS.includes(queryLang)) return queryLang;
    const saved = storageGet();
    if (LANGS.includes(saved)) return saved;
    const nav = (navigator.languages && navigator.languages[0]) || navigator.language || '';
    return /^ko\b/i.test(nav) ? 'ko' : 'en';
  }

  /** 자식 요소가 있으면 첫 텍스트 노드만, 없으면 textContent 전체를 바꾼다 */
  function setText(el, text) {
    if (!el.firstElementChild) {
      el.textContent = text;
      return;
    }
    for (const node of el.childNodes) {
      if (node.nodeType === 3 && node.nodeValue.trim()) {
        const v = node.nodeValue;
        const lead = v.match(/^\s*/)[0];
        const trail = v.match(/\s*$/)[0];
        node.nodeValue = lead + text + trail;
        return;
      }
    }
    el.insertBefore(document.createTextNode(text + ' '), el.firstChild);
  }

  const I18n = {
    lang: 'ko',
    LANGS,

    /** 쿼리 lang이 있으면 그 언어로, 없으면 저장값·브라우저 언어로 시작 */
    init(queryLang) {
      this.lang = detect(queryLang);
      this.apply();
    },

    t(key, params) {
      let s = DICT[this.lang][key];
      if (s === undefined) s = DICT.ko[key];
      if (s === undefined) return key;
      if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
      return s;
    },

    /** root 아래의 data-i18n* 요소에 현재 언어를 적용 */
    apply(root) {
      const r = root || document;
      document.documentElement.lang = this.lang;
      r.querySelectorAll('[data-i18n]').forEach((el) => setText(el, this.t(el.dataset.i18n)));
      r.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = this.t(el.dataset.i18nTitle); });
      r.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = this.t(el.dataset.i18nPlaceholder); });
      r.querySelectorAll('[data-i18n-label]').forEach((el) => { el.label = this.t(el.dataset.i18nLabel); });
    },

    /** 언어를 바꾸고 저장한다. 바뀌면 'langchange' 이벤트 */
    set(lang) {
      if (!LANGS.includes(lang)) return;
      storageSet(lang);
      if (lang === this.lang) return;
      this.lang = lang;
      this.apply();
      document.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
    },
  };

  global.I18n = I18n;
})(window);
