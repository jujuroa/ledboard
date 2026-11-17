/*
 * BrightnessDynamics — 소자 밝기 이징 (가속도 모델)
 *
 * 일반적인 이징 곡선(시간 → 진행률)이 아니라, 소자마다 밝기 x와 변화 속도 v를 두고
 * 목표까지의 거리를 힘으로 삼아 움직인다.
 *
 *     a = k·(target − x) − c·v        힘 = 거리 × 강성,  마찰 = 속도 × 감쇠
 *     dv/dt = a,   dx/dt = v
 *
 *   k = (2π·f)²       f = 반응 속도(Hz, 고유 진동수)
 *   c = 2·ζ·√k        ζ = 감쇠비 (<1 오버슈트, =1 임계 감쇠, >1 과감쇠)
 *
 * 적분: 한 프레임 동안 목표가 고정이면 이 식은 선형이라 해를 정확히 구할 수 있다.
 * e = x − target 으로 두면
 *     [e', v'] = M(dt) · [e, v],   M(dt) = exp([[0, 1], [−k, −c]] · dt)
 * M은 프레임마다 한 번 계산하고, 소자마다 곱셈 4번으로 다음 x·v를 얻는다.
 * 단순 오일러(v += a·dt; x += v·dt)와 달리 프레임 간격이 길어도 발산하지 않고,
 * 수치 감쇠 없이 f·ζ가 뜻하는 그대로 움직인다.
 *
 * 목표 밝기는 톤 처리까지 끝난 최종 밝기 b(0~1). 표시값은 [0, 1]로 자르고,
 * 내부 상태 x·v는 자르지 않아 오버슈트가 물리적으로 이어진다.
 */
(function (global) {
  'use strict';

  const MAX_DT = 0.25;         // 탭 전환 등으로 프레임 간격이 길어져도 한 번에 0.25초까지만 진행
  const EPS = 1e-4;            // 이보다 작으면 정지로 보고 목표에 맞춤

  /**
   * 상태 전이 행렬 M = exp(A·t),  A = [[0, 1], [−ω², −2ζω]]
   * @returns {number[]} [m11, m12, m21, m22]   e' = m11·e + m12·v,  v' = m21·e + m22·v
   */
  function transition(freq, zeta, t) {
    const w = 2 * Math.PI * freq;
    const a = zeta * w;                 // 감쇠율
    const E = Math.exp(-a * t);
    if (Math.abs(zeta - 1) < 1e-4) {    // 임계 감쇠
      return [E * (1 + w * t), E * t, -E * w * w * t, E * (1 - w * t)];
    }
    let C, S;                            // cos·sin/ωd (부족 감쇠) 또는 cosh·sinh/β (과감쇠)
    let Sw;                              // ωd·sin 또는 −β·sinh  (m21 계산용 부호 포함)
    if (zeta < 1) {
      const wd = w * Math.sqrt(1 - zeta * zeta);
      C = Math.cos(wd * t);
      S = Math.sin(wd * t) / wd;
    } else {
      const b = w * Math.sqrt(zeta * zeta - 1);
      C = Math.cosh(b * t);
      S = Math.sinh(b * t) / b;
    }
    Sw = S * w * w;
    return [E * (C + a * S), E * S, -E * Sw, E * (C - a * S)];
  }

  class BrightnessDynamics {
    constructor() {
      this.n = 0;
      this.x = new Float32Array(0);
      this.v = new Float32Array(0);
      this.target = new Float32Array(0);
      this.display = new Float32Array(0);
      this.active = false;
      this._fresh = true;      // 할당 직후: 첫 목표를 그대로 상태로 사용(크기 변경 시 깜빡임 방지)
    }

    resize(cols, rows) {
      const n = cols * rows;
      this.cols = cols;
      this.rows = rows;
      if (n === this.n) return;
      this.n = n;
      this.x = new Float32Array(n);
      this.v = new Float32Array(n);
      this.target = new Float32Array(n);
      this.display = new Float32Array(n);
      this._fresh = true;
    }

    /** 이징을 다시 켤 때: 다음 목표를 그대로 상태로 삼아 출발(꺼져 있던 동안의 차이로 튀지 않게) */
    restart() {
      this._fresh = true;
      this.active = false;
    }

    /** 현재 목표로 즉시 맞춤 */
    snap() {
      this.x.set(this.target);
      this.v.fill(0);
      this._writeDisplay();
      this.active = false;
    }

    /**
     * 목표 밝기 설정 (톤 처리·감광까지 끝난 값)
     * @param arr  Float32Array(n)
     */
    setTargetArray(arr) {
      const t = this.target;
      const n = this.n;
      let changed = false;
      for (let i = 0; i < n; i++) {
        const v = arr[i];
        if (!changed && Math.abs(v - t[i]) > 1e-6) changed = true;
        t[i] = v;
      }
      if (this._fresh) {
        this._fresh = false;
        this.snap();
        return;
      }
      // 목표가 그대로면 정지 상태를 깨지 않는다(감광이 매 프레임 목표를 넘겨도 불필요한 진행 방지)
      if (changed) this.active = true;
    }

    /**
     * dt초만큼 진행
     * @param freq  반응 속도 f (Hz)
     * @param zeta  감쇠비 ζ
     */
    step(dt, freq, zeta) {
      if (!this.active) return;
      dt = Math.min(MAX_DT, Math.max(0, dt));
      if (dt === 0) return;
      const [m11, m12, m21, m22] = transition(freq, zeta, dt);
      const x = this.x;
      const v = this.v;
      const t = this.target;
      const n = this.n;
      let moving = false;
      for (let i = 0; i < n; i++) {
        const ti = t[i];
        const e = x[i] - ti;
        const vi = v[i];
        let en = m11 * e + m12 * vi;
        let vn = m21 * e + m22 * vi;
        if (Math.abs(en) < EPS && Math.abs(vn) < EPS) {
          en = 0;
          vn = 0;
        } else {
          moving = true;
        }
        x[i] = ti + en;
        v[i] = vn;
      }
      this.active = moving;
      this._writeDisplay();
    }

    _writeDisplay() {
      const x = this.x;
      const d = this.display;
      for (let i = 0; i < this.n; i++) {
        const xi = x[i];
        d[i] = xi < 0 ? 0 : xi > 1 ? 1 : xi;
      }
    }

    /**
     * 0 → 1 계단 입력에 대한 응답 곡선 (UI 미리보기·검증용). 같은 전이 행렬을 쓴다.
     * @returns {Float32Array} duration초 동안 samples개 표본
     */
    static stepResponse(freq, zeta, duration, samples) {
      const out = new Float32Array(samples);
      const [m11, m12, m21, m22] = transition(freq, zeta, duration / (samples - 1));
      let e = -1;   // x − target = 0 − 1
      let v = 0;
      for (let i = 0; i < samples; i++) {
        out[i] = 1 + e;
        const en = m11 * e + m12 * v;
        v = m21 * e + m22 * v;
        e = en;
      }
      return out;
    }
  }

  BrightnessDynamics.transition = transition;
  global.BrightnessDynamics = BrightnessDynamics;
})(window);
