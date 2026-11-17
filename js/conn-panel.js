/*
 * ConnPanel — 외부 스트림(WebSocket) 연결 패널과 표시 모드 UI
 * docs/source-interface.md 7.2~7.4절.
 *
 *  - URL·토큰 입력, [연결]·[끊기], LED 톤(apply | bypass)
 *  - 연결 상태 문구, 수신 통계, 최근 오류, 무대 모서리 배지
 *  - 표시 모드(그림 | LED 직접)에 따른 컨트롤 비활성화
 */
(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const WS_URL_KEY = 'ledboard.wsUrl';

  const t = (k, p) => I18n.t(k, p);

  function validWsUrl(u) {
    return /^wss?:\/\/[^\s/]+/i.test(u);
  }

  class ConnPanel {
    /**
     * @param {object} o
     *   channel        WsChannel
     *   source         FrameSource
     *   getParams()    현재 렌더링 파라미터 P (bypass를 여기에 씀)
     *   requestRender() 다음 루프에서 다시 그리기
     */
    constructor({ channel, source, getParams, requestRender }) {
      this.channel = channel;
      this.source = source;
      this.getParams = getParams;
      this.requestRender = requestRender;
    }

    /** 외부 스트림이 현재 소스인가 */
    get streamActive() {
      return this.source.kind === 'stream';
    }

    /** LED 직접 입력으로 표시 중인가 */
    get directMode() {
      return this.streamActive && this.channel.mode === 'direct';
    }

    bind() {
      const channel = this.channel;
      $('ws-url').value = Settings.storage.get(WS_URL_KEY) || '';
      $('ws-url').addEventListener('change', (e) => {
        const u = e.target.value.trim();
        e.target.classList.toggle('invalid', !!u && !validWsUrl(u));
        if (validWsUrl(u)) Settings.storage.set(WS_URL_KEY, u);
      });
      $('ws-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.connect(); });
      $('ws-connect').addEventListener('click', () => this.connect());
      $('ws-disconnect').addEventListener('click', () => {
        channel.disconnect();
        this.applyMode();
      });
      $('ws-token-show').addEventListener('click', () => {
        const t = $('ws-token');
        t.type = t.type === 'password' ? 'text' : 'password';
        this.updateTokenButton();
      });
      $('ws-ledtone').addEventListener('change', (e) => {
        channel.setLedTone(e.target.value);
        this.applyMode();
      });
    }

    updateTokenButton() {
      $('ws-token-show').textContent = t($('ws-token').type === 'password' ? 'ws.show' : 'ws.hide');
    }

    modeText() {
      return t(this.channel.mode === 'direct' ? 'ws.modeDirect' : 'ws.modePicture');
    }

    /** 언어가 바뀌었을 때 동적 문구를 다시 그린다 */
    relabel() {
      this.updateTokenButton();
      if ($('ws-url').classList.contains('invalid')) $('ws-url').title = t('ws.badUrl');
      this.update();
      this.applyMode();
    }

    /** 쿼리 파라미터로 받은 주소·토큰을 채운다 (저장하지 않음) */
    prefill(url, token) {
      $('ws-url').value = url;
      $('ws-token').value = token || '';
    }

    connect() {
      const url = $('ws-url').value.trim();
      if (!validWsUrl(url)) {
        $('ws-url').classList.add('invalid');
        $('ws-url').title = t('ws.badUrl');
        return;
      }
      $('ws-url').classList.remove('invalid');
      $('ws-url').title = '';
      this.channel.connect(url, $('ws-token').value);
    }

    statusText() {
      const channel = this.channel;
      const s = channel.state;
      if (s === 'retry') {
        const sec = Math.max(0, Math.ceil((channel.retryAt - performance.now()) / 1000));
        return t('ws.retryIn', { sec });
      }
      if (s === 'receiving') return t('ws.receivingMode', { mode: this.modeText() });
      if (s === 'error' && channel.lastError) return t('ws.errorWith', { msg: channel.lastError.message });
      return t('ws.st.' + s);
    }

    /** 상태 표시줄 끝에 붙일 WS 요약 */
    statsSuffix() {
      const channel = this.channel;
      return channel.state === 'receiving'
        ? ' │ ' + t('ws.statsRx', { fps: channel.rxFps.toFixed(1), dropped: channel.stats.dropped, mode: this.modeText() })
        : ` │ WS ${this.statusText()}`;
    }

    /** 연결 상태·통계·오류가 바뀔 때 (WsChannel.onStatus) */
    update() {
      const channel = this.channel;
      const s = channel.state;
      const st = $('ws-status');
      st.className = 'st-' + s;
      st.innerHTML = '<i class="dot"></i>';
      st.appendChild(document.createTextNode(this.statusText()));
      $('ws-connect').disabled = s === 'connecting' || s === 'waiting' || s === 'receiving' || s === 'ended';
      $('ws-disconnect').disabled = s === 'idle';

      const live = s === 'waiting' || s === 'receiving' || s === 'ended';
      const st2 = channel.stats;
      $('ws-rx').textContent = live
        ? t('ws.rxLine', { fps: channel.rxFps.toFixed(1), dropped: st2.dropped })
          + (channel.mode === 'picture' && st2.decoded ? t('ws.decode', { ms: st2.decodeMs.toFixed(1) }) : '')
        : '—';

      const e = channel.lastError;
      $('ws-error').textContent = e && performance.now() - e.at < 10000
        ? t('ws.lastError', { code: e.code, seq: e.seq != null ? ` (seq ${e.seq})` : '', msg: e.message })
        : '';

      // 신호 대기로 들어오면 보드를 꺼진 상태로 (이전 프레임이 있으면 유지)
      if (s === 'waiting' && $('src-kind').value === 'ws' && !this.streamActive) {
        this.source.useStream();
        this.requestRender();
      }

      // 무대 배지: 수신 중이 아닐 때만 모서리에 작게
      const badge = $('stage-badge');
      let text = '';
      if ($('src-kind').value === 'ws') {
        if (s === 'waiting') text = t('ws.badge.waiting');
        else if (s === 'retry') {
          const sec = Math.max(0, Math.ceil((channel.retryAt - performance.now()) / 1000));
          text = t('ws.badge.retry', { sec });
        } else if (s === 'error') text = t('ws.badge.error');
        else if (s === 'ended') text = t('ws.badge.ended');
      }
      badge.textContent = text;
      badge.hidden = !text;
    }

    /** 표시 모드에 따라 컨트롤 비활성화 (7.4절) */
    applyMode() {
      const direct = this.directMode;
      const bypass = direct && this.channel.ledTone === 'bypass';
      this.getParams().bypass = bypass;
      const fit = $('fit');
      fit.disabled = direct;
      fit.title = direct ? t('ws.fitDirect') : '';
      Settings.TONE_KEYS.forEach((k) => {
        const el = $(k);
        el.disabled = bypass;
        const target = el.closest('label') || el;
        target.title = bypass ? t('ws.toneBypass') : (target.dataset.i18nTitle ? t(target.dataset.i18nTitle) : '');
      });
      this.requestRender();
    }
  }

  global.ConnPanel = ConnPanel;
})(window);
