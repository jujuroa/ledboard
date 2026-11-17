/*
 * WsChannel
 * docs/source-interface.md 5절 "채널 2: WebSocket" (ledboard.v1) 수신 측 구현.
 *
 *  - text 메시지  : 제어(JSON)  hello / state / stats / error  ↔  config / end
 *  - binary 메시지: 24 byte 헤더 + payload
 *      0x10 IMAGE  JPEG·PNG·WebP           → onPicture(ImageBitmap)
 *      0x11 RAW    GRAY8·RGB24·RGBA32      → onPicture(canvas)
 *      0x20 LED    L8·L4·L1, 영역 + COMMIT  → onLed(front buffer)
 *
 * 시뮬레이터가 클라이언트다. 끊기면 0.5→1→2→4→8→10초 간격으로 재연결한다.
 */
(function (global) {
  'use strict';

  const SUBPROTOCOL = 'ledboard.v1';
  const HEADER = 24;
  const MAX_MESSAGE = 16 * 1024 * 1024;
  const MAX_RAW_SIDE = 4096;
  const BACKOFF = [500, 1000, 2000, 4000, 8000, 10000];

  const T_IMAGE = 0x10;
  const T_RAW = 0x11;
  const T_LED = 0x20;
  const F_COMMIT = 0x01;
  const F_CLEAR = 0x02;

  const IMAGE_MIME = { 1: 'image/jpeg', 2: 'image/png', 3: 'image/webp' };
  const RAW_BPP = { 1: 1, 2: 3, 3: 4 };
  const LED_BITS = { 1: 8, 2: 4, 3: 1 };

  /** docs/source-interface.md 6절의 파싱 예와 같음 */
  function parseHeader(buf) {
    const dv = new DataView(buf);
    if (buf.byteLength < HEADER || dv.getUint8(0) !== 0x4c || dv.getUint8(1) !== 0x42) return null;
    return {
      version: dv.getUint8(2),
      type: dv.getUint8(3),
      format: dv.getUint8(4),
      flags: dv.getUint8(5),
      seq: dv.getUint32(8, true),
      timestamp: dv.getUint32(12, true),
      x: dv.getUint16(16, true),
      y: dv.getUint16(18, true),
      width: dv.getUint16(20, true),
      height: dv.getUint16(22, true),
      payload: new Uint8Array(buf, HEADER),
    };
  }

  class WsChannel {
    /**
     * @param {object} hooks
     *   getBoard()            → {cols, rows}
     *   getRemoteConfig()     → boolean
     *   onConfig(cfg)         검증을 통과한 config 적용 요청 {cols?, rows?, ledTone?}
     *   onPicture(drawable)   ImageBitmap 또는 canvas
     *   onLed(front, cols, rows)
     *   onStatus()            상태·통계·오류가 바뀔 때
     */
    constructor(hooks) {
      this.hooks = hooks;
      this.ws = null;
      this.url = '';
      this.token = '';
      this.state = 'idle';       // idle | connecting | waiting | receiving | ended | retry | error
      this.mode = 'picture';     // picture | direct
      this.ledTone = 'apply';
      this.lastError = null;     // {code, message, at}
      this.retryAt = 0;
      this._retryIdx = 0;
      this._retryTimer = 0;
      this._statsTimer = 0;
      this._errSentAt = {};
      this._decoding = false;
      this._pendingImage = null;
      this._undisplayed = false;
      this._resetStats();
      this._allocLed();
    }

    // ---- 연결 관리 ---------------------------------------------------------
    connect(url, token) {
      this.disconnect();
      this.url = url;
      this.token = token || '';
      this._retryIdx = 0;
      this._open();
    }

    disconnect() {
      clearTimeout(this._retryTimer);
      clearInterval(this._statsTimer);
      this._retryTimer = 0;
      this._statsTimer = 0;
      if (this.ws) {
        const ws = this.ws;
        this.ws = null;
        ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
        try { ws.close(1000); } catch (e) { /* 무시 */ }
      }
      this._pendingImage = null;
      this._setState('idle');
    }

    get connected() {
      return !!this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    _fullUrl() {
      if (!this.token) return this.url;
      const u = new URL(this.url);
      u.searchParams.set('token', this.token);
      return u.toString();
    }

    _open() {
      this._setState('connecting');
      let ws;
      try {
        ws = new WebSocket(this._fullUrl(), SUBPROTOCOL);
      } catch (e) {
        this._localError('BAD_URL', e.message);
        this._setState('error');
        return;
      }
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      ws.onopen = () => {
        if (ws.protocol !== SUBPROTOCOL) {
          this._localError('BAD_PROTOCOL', I18n.t('ws.err.protocol', { proto: SUBPROTOCOL }));
          ws.onclose = null;
          ws.close(1002);
          this.ws = null;
          this._setState('error');
          return;
        }
        this._retryIdx = 0;
        this._resetStats();
        this._setState('waiting');
        this._send(this._helloMsg());
        this._statsTimer = setInterval(() => this._sendStats(), 1000);
      };
      ws.onmessage = (ev) => this._onMessage(ev.data);
      ws.onerror = () => { /* onclose에서 처리 */ };
      ws.onclose = (ev) => {
        clearInterval(this._statsTimer);
        this._statsTimer = 0;
        this.ws = null;
        if (ev.code === 4401 || ev.code === 4403) {
          this._localError('AUTH', I18n.t('ws.err.auth', { code: ev.code }));
          this._setState('error');
          return;
        }
        this._scheduleRetry();
      };
    }

    _scheduleRetry() {
      const delay = BACKOFF[Math.min(this._retryIdx, BACKOFF.length - 1)];
      this._retryIdx++;
      this.retryAt = performance.now() + delay;
      this._setState('retry');
      this._retryTimer = setTimeout(() => this._open(), delay);
    }

    _setState(s) {
      this.state = s;
      this.hooks.onStatus && this.hooks.onStatus();
    }

    _send(obj) {
      if (this.connected) this.ws.send(JSON.stringify(obj));
    }

    // ---- 보드 / 상태 -------------------------------------------------------
    _allocLed() {
      const { cols, rows } = this.hooks.getBoard();
      this.cols = cols;
      this.rows = rows;
      this.back = new Uint8Array(cols * rows);
      this.front = new Uint8Array(cols * rows);
    }

    /** 보드 크기·ledTone이 바뀌었을 때 main이 호출. LED 버퍼를 초기화하고 state 전송 */
    boardChanged() {
      const { cols, rows } = this.hooks.getBoard();
      if (cols !== this.cols || rows !== this.rows) {
        this._allocLed();
        if (this.mode === 'direct') this.hooks.onLed && this.hooks.onLed(this.front, this.cols, this.rows);
      }
      this._send(this._stateMsg());
    }

    setLedTone(tone) {
      this.ledTone = tone;
      this._send(this._stateMsg());
    }

    _helloMsg() {
      const { cols, rows } = this.hooks.getBoard();
      return {
        type: 'hello',
        protocol: 'ledboard',
        version: 1,
        board: { cols, rows },
        accept: {
          image: ['jpeg', 'png', 'webp'],
          raw: ['gray8', 'rgb24', 'rgba32'],
          led: ['l8', 'l4', 'l1'],
        },
        hint: {
          maxWidth: Math.min(1920, cols * 8),
          maxHeight: Math.min(1080, rows * 8),
          maxFps: 60,
        },
      };
    }

    _stateMsg() {
      const { cols, rows } = this.hooks.getBoard();
      return {
        type: 'state',
        board: { cols, rows },
        ledTone: this.ledTone,
        remoteConfig: !!this.hooks.getRemoteConfig(),
      };
    }

    // ---- 통계 -------------------------------------------------------------
    _resetStats() {
      this.stats = {
        received: 0, bytes: 0, decoded: 0, displayed: 0, dropped: 0,
        lastSeq: null, decodeMs: 0,
      };
      this._fpsCount = 0;
      this._fpsT = performance.now();
      this.rxFps = 0;
    }

    /** main이 스트림 프레임을 실제로 그렸을 때 호출 */
    markDisplayed() {
      if (!this._undisplayed) return;
      this._undisplayed = false;
      this.stats.displayed++;
    }

    _frameReady() {
      if (this._undisplayed) this.stats.dropped++;   // 화면 주기 안에 덮어씀(latest-wins)
      this._undisplayed = true;
      if (this.state !== 'receiving') this._setState('receiving');
    }

    _sendStats() {
      const now = performance.now();
      this.rxFps = (this._fpsCount * 1000) / Math.max(1, now - this._fpsT);
      this._fpsCount = 0;
      this._fpsT = now;
      const s = this.stats;
      this._send({
        type: 'stats',
        received: s.received,
        bytes: s.bytes,
        decoded: s.decoded,
        displayed: s.displayed,
        dropped: s.dropped,
        lastSeq: s.lastSeq,
        decodeMs: Math.round(s.decodeMs * 10) / 10,
      });
      this.hooks.onStatus && this.hooks.onStatus();
    }

    // ---- 오류 -------------------------------------------------------------
    _localError(code, message, seq) {
      this.lastError = { code, message, seq, at: performance.now() };
      this.hooks.onStatus && this.hooks.onStatus();
    }

    /** 발신 측에 error 전송(같은 코드는 초당 1회) + 로컬 표시 */
    _error(code, message, seq) {
      this._localError(code, message, seq);
      const now = performance.now();
      if (now - (this._errSentAt[code] || -1e9) < 1000) return;
      this._errSentAt[code] = now;
      const msg = { type: 'error', code, message };
      if (seq != null) msg.seq = seq;
      this._send(msg);
    }

    // ---- 수신 -------------------------------------------------------------
    _onMessage(data) {
      if (typeof data === 'string') {
        this._onControl(data);
        return;
      }
      this.stats.received++;
      this.stats.bytes += data.byteLength;
      if (data.byteLength > MAX_MESSAGE) {
        this._error('TOO_LARGE', I18n.t('ws.err.tooLarge', { size: data.byteLength, max: MAX_MESSAGE }));
        return;
      }
      const h = parseHeader(data);
      if (!h) {
        this._error('BAD_MAGIC', I18n.t('ws.err.magic'));
        return;
      }
      this.stats.lastSeq = h.seq;
      if (h.version !== 1) {
        this._error('BAD_VERSION', I18n.t('ws.err.version', { v: h.version }), h.seq);
        return;
      }
      if (h.type === T_IMAGE) this._onImage(h);
      else if (h.type === T_RAW) this._onRaw(h);
      else if (h.type === T_LED) this._onLed(h);
      else this._error('UNKNOWN_TYPE', I18n.t('ws.err.type', { type: h.type.toString(16) }), h.seq);
    }

    _onControl(text) {
      let msg;
      try {
        msg = JSON.parse(text);
      } catch (e) {
        return; // JSON이 아니면 무시
      }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'config') this._onConfig(msg);
      else if (msg.type === 'end') this._setState('ended');
      // 알 수 없는 type은 무시
    }

    _onConfig(msg) {
      if (!this.hooks.getRemoteConfig()) {
        this._error('CONFIG_DENIED', I18n.t('ws.err.configDenied'));
        return;
      }
      const cfg = {};
      const bad = [];
      for (const k of ['cols', 'rows']) {
        if (msg[k] === undefined) continue;
        const v = msg[k];
        if (Number.isInteger(v) && v >= 1 && v <= 1024) cfg[k] = v;
        else bad.push(I18n.t('ws.err.intRange', { kv: `${k}=${JSON.stringify(v)}` }));
      }
      if (msg.ledTone !== undefined) {
        if (msg.ledTone === 'apply' || msg.ledTone === 'bypass') cfg.ledTone = msg.ledTone;
        else bad.push(`ledTone=${JSON.stringify(msg.ledTone)} (apply|bypass)`);
      }
      if (bad.length) {
        this._error('BAD_CONFIG', bad.join(', '));
        return;
      }
      if (cfg.ledTone) this.ledTone = cfg.ledTone;
      // main이 UI·보드에 반영한 뒤 boardChanged()를 호출 → LED 버퍼 재할당 + state 응답
      this.hooks.onConfig(cfg);
    }

    _onImage(h) {
      const mime = IMAGE_MIME[h.format];
      if (!mime) {
        this._error('BAD_FORMAT', `IMAGE format ${h.format}`, h.seq);
        return;
      }
      this._fpsCount++;
      const item = { h, mime };
      if (this._decoding) {
        if (this._pendingImage) this.stats.dropped++;
        this._pendingImage = item;
        return;
      }
      this._decode(item);
    }

    async _decode(item) {
      this._decoding = true;
      const t0 = performance.now();
      try {
        const bmp = await createImageBitmap(new Blob([item.h.payload], { type: item.mime }));
        const dt = performance.now() - t0;
        this.stats.decodeMs = this.stats.decoded ? this.stats.decodeMs * 0.9 + dt * 0.1 : dt;
        this.stats.decoded++;
        if (this.ws || this.state === 'ended') {
          this.mode = 'picture';
          this._frameReady();
          this.hooks.onPicture(bmp);
        } else {
          bmp.close();
        }
      } catch (e) {
        this._error('DECODE_FAILED', I18n.t('ws.err.decode'), item.h.seq);
      }
      this._decoding = false;
      const next = this._pendingImage;
      this._pendingImage = null;
      if (next) this._decode(next);
    }

    _onRaw(h) {
      const bpp = RAW_BPP[h.format];
      if (!bpp) {
        this._error('BAD_FORMAT', `RAW format ${h.format}`, h.seq);
        return;
      }
      const w = h.width;
      const hh = h.height;
      if (w < 1 || hh < 1 || w > MAX_RAW_SIDE || hh > MAX_RAW_SIDE) {
        this._error(w > MAX_RAW_SIDE || hh > MAX_RAW_SIDE ? 'TOO_LARGE' : 'BAD_LENGTH',
          I18n.t('ws.err.rawSize', { w, h: hh }), h.seq);
        return;
      }
      const n = w * hh;
      if (h.payload.length !== n * bpp) {
        this._error('BAD_LENGTH', `RAW payload ${h.payload.length} ≠ ${n * bpp}`, h.seq);
        return;
      }
      this._fpsCount++;
      const t0 = performance.now();
      const img = new ImageData(w, hh);
      const d = img.data;
      const p = h.payload;
      if (bpp === 1) {
        for (let i = 0, j = 0; i < n; i++, j += 4) {
          d[j] = d[j + 1] = d[j + 2] = p[i];
          d[j + 3] = 255;
        }
      } else if (bpp === 3) {
        for (let i = 0, s = 0, j = 0; i < n; i++, s += 3, j += 4) {
          d[j] = p[s];
          d[j + 1] = p[s + 1];
          d[j + 2] = p[s + 2];
          d[j + 3] = 255;
        }
      } else {
        d.set(p);
        for (let j = 3; j < d.length; j += 4) d[j] = 255; // A는 무시
      }
      if (!this._rawCanvas) this._rawCanvas = document.createElement('canvas');
      const c = this._rawCanvas;
      if (c.width !== w || c.height !== hh) {
        c.width = w;
        c.height = hh;
      }
      c.getContext('2d').putImageData(img, 0, 0);
      const dt = performance.now() - t0;
      this.stats.decodeMs = this.stats.decoded ? this.stats.decodeMs * 0.9 + dt * 0.1 : dt;
      this.stats.decoded++;
      this.mode = 'picture';
      this._frameReady();
      this.hooks.onPicture(c);
    }

    _onLed(h) {
      const bits = LED_BITS[h.format];
      if (!bits) {
        this._error('BAD_FORMAT', `LED format ${h.format}`, h.seq);
        return;
      }
      const { x, y, width: w, height: hh } = h;
      if (w < 1 || hh < 1 || x + w > this.cols || y + hh > this.rows) {
        this._error('BAD_REGION',
          I18n.t('ws.err.region', { x, y, w, h: hh, cols: this.cols, rows: this.rows }), h.seq);
        return;
      }
      const stride = Math.ceil((w * bits) / 8);
      const p = h.payload;
      if (p.length !== stride * hh) {
        this._error('BAD_LENGTH', `LED payload ${p.length} ≠ ${stride * hh}`, h.seq);
        return;
      }
      const back = this.back;
      const cols = this.cols;
      if (h.flags & F_CLEAR) back.fill(0);
      for (let r = 0; r < hh; r++) {
        const src = r * stride;
        const dst = (y + r) * cols + x;
        if (bits === 8) {
          back.set(p.subarray(src, src + w), dst);
        } else if (bits === 4) {
          for (let c = 0; c < w; c++) {
            const byte = p[src + (c >> 1)];
            back[dst + c] = ((c & 1) ? (byte & 0x0f) : (byte >> 4)) * 17;
          }
        } else {
          for (let c = 0; c < w; c++) {
            back[dst + c] = (p[src + (c >> 3)] >> (7 - (c & 7))) & 1 ? 255 : 0;
          }
        }
      }
      this.stats.decoded++;
      if (h.flags & F_COMMIT) {
        this._fpsCount++;
        this.front.set(back);
        this.mode = 'direct';
        this._frameReady();
        this.hooks.onLed(this.front, this.cols, this.rows);
      }
    }
  }

  WsChannel.SUBPROTOCOL = SUBPROTOCOL;
  global.WsChannel = WsChannel;
})(window);
