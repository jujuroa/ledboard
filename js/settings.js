/*
 * Settings — 패널 컨트롤 값의 읽기·저장·복원
 *
 * 설정 키는 패널 컨트롤의 id와 같다. 값의 원본은 DOM이고, read()가 렌더링에 쓰는 파라미터 P를 만든다.
 *  - 저장: localStorage(STORE_KEY)에 키별 값
 *  - 파일: exportData()/importData()로 JSON 내보내기·불러오기
 *  - 쿼리 파라미터(cols, rows)는 이번 실행에만 적용하고 저장하지 않는다 (docs/source-interface.md 7.5절).
 *    사용자나 발신 측이 그 값을 직접 바꾸면 release(id)로 다시 저장 대상이 된다.
 */
(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'ledboard.settings.v1';

  const NUM_KEYS = ['cols', 'rows', 'pitch', 'textSpeed', 'intensity', 'offLevel', 'core', 'halo',
    'haloWidth', 'spread', 'exposure', 'brightness', 'contrast', 'gamma', 'threshold', 'easeFreq', 'easeZeta',
    'idleThr', 'idleHold', 'idleTau', 'idleFloor'];
  const SEL_KEYS = ['fit', 'shape', 'levels', 'renderer'];
  const CHK_KEYS = ['autoPitch', 'invert', 'remoteConfig', 'easeOn', 'idleOn'];
  const STR_KEYS = ['color', 'text'];
  const ALL_KEYS = [...NUM_KEYS, ...SEL_KEYS, ...CHK_KEYS, ...STR_KEYS];
  /** LED 직접 입력 bypass일 때 비활성화하는 톤 컨트롤 */
  const TONE_KEYS = ['brightness', 'contrast', 'gamma', 'levels', 'threshold', 'invert'];
  const MAX_SIDE = 1024;
  const FILE_VERSION = 1;   // 설정 파일(내보내기) 형식 버전

  const getVal = (el) => (el.type === 'checkbox' ? el.checked : el.value);
  function setVal(el, v) {
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }

  /** localStorage 접근. 막혀 있는 환경(사생활 보호 모드 등)에서도 예외 없이 동작 */
  const storage = {
    get(key) {
      try { return localStorage.getItem(key); } catch (e) { return null; }
    },
    set(key, v) {
      try { localStorage.setItem(key, v); } catch (e) { /* 무시 */ }
    },
  };

  class Settings {
    /** @param query  URLSearchParams */
    constructor(query) {
      this.query = query;
      this.overrides = new Set();   // 쿼리로 덮어쓴 키. 저장 시 이전 저장값을 유지
      this.stored = {};
      this.defaults = {};           // HTML에 적힌 초기값
      ALL_KEYS.forEach((k) => { this.defaults[k] = getVal($(k)); });
    }

    /** 저장된 값을 컨트롤에 반영하고, 쿼리의 cols·rows를 덮어쓴다 */
    load() {
      try {
        this.stored = JSON.parse(storage.get(STORE_KEY) || '{}') || {};
      } catch (e) {
        this.stored = {};
      }
      ALL_KEYS.forEach((k) => {
        if (k in this.stored) setVal($(k), this.stored[k]);
      });
      for (const k of ['cols', 'rows']) {
        const v = parseInt(this.query.get(k), 10);
        if (v >= 1 && v <= MAX_SIDE) {
          $(k).value = v;
          this.overrides.add(k);
        }
      }
    }

    save() {
      const s = {};
      ALL_KEYS.forEach((k) => {
        if (this.overrides.has(k)) {
          if (k in this.stored) s[k] = this.stored[k];
          return;
        }
        s[k] = getVal($(k));
      });
      this.stored = s;
      storage.set(STORE_KEY, JSON.stringify(s));
    }

    /** 사용자·발신 측이 직접 바꾼 키: 쿼리 덮어쓰기를 풀고 다시 저장 대상으로 */
    release(id) {
      this.overrides.delete(id);
    }

    /** 모든 컨트롤을 HTML 초기값으로 되돌린다 (저장은 호출자가) */
    restoreDefaults() {
      ALL_KEYS.forEach((k) => setVal($(k), this.defaults[k]));
      this.overrides.clear();
    }

    /** 내보내기 파일 내용. 쿼리로 덮어쓴 키도 지금 화면에 보이는 값으로 담는다 */
    exportData() {
      const s = {};
      ALL_KEYS.forEach((k) => { s[k] = getVal($(k)); });
      return { app: 'ledboard', version: FILE_VERSION, savedAt: new Date().toISOString(), settings: s };
    }

    /**
     * 내보낸 파일(또는 settings 객체만)을 컨트롤에 반영한다. 모르는 키와 형식이 맞지 않는 값은 건너뛴다.
     * 저장은 호출자가 한다.
     * @returns {{applied: number, skipped: string[]}}
     */
    importData(data) {
      if (!data || typeof data !== 'object') throw new Error('설정 파일 형식이 아님');
      if (data.app !== undefined && data.app !== 'ledboard') throw new Error('LEDBoard 설정 파일이 아님');
      const src = data.settings && typeof data.settings === 'object' ? data.settings : data;
      let applied = 0;
      const skipped = [];
      ALL_KEYS.forEach((k) => {
        if (!(k in src)) return;
        const v = src[k];
        const el = $(k);
        let ok;
        if (NUM_KEYS.includes(k)) ok = Number.isFinite(Number(v)) && v !== '' && v !== null;
        else if (CHK_KEYS.includes(k)) ok = typeof v === 'boolean';
        else if (SEL_KEYS.includes(k)) ok = [...el.options].some((o) => o.value === v && !o.disabled);
        else if (k === 'color') ok = /^#[0-9a-f]{6}$/i.test(v);
        else ok = typeof v === 'string';
        if (!ok) { skipped.push(k); return; }
        setVal(el, v);
        this.overrides.delete(k);
        applied++;
      });
      if (!applied) throw new Error('적용할 설정 값이 없음');
      return { applied, skipped };
    }

    /** 컨트롤 값 → 렌더링 파라미터 P. bypass는 표시 모드에 따라 ConnPanel이 채운다 */
    read() {
      const v = (k) => parseFloat($(k).value);
      const color = hexToRgb($('color').value);
      const offLevel = v('offLevel');
      return {
        cols: Math.max(1, Math.min(MAX_SIDE, Math.round(v('cols')) || 1)),
        rows: Math.max(1, Math.min(MAX_SIDE, Math.round(v('rows')) || 1)),
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
  }

  Settings.ALL_KEYS = ALL_KEYS;
  Settings.TONE_KEYS = TONE_KEYS;
  Settings.storage = storage;
  global.Settings = Settings;
})(window);
