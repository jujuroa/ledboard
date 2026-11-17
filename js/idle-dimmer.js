/*
 * IdleDimmer — 정지 소자 감광
 *
 * 밝기가 일정 수준 이상 변하지 않는 소자를 서서히 어둡게 한다.
 *
 *  - 소자마다 기준 밝기 ref와 마지막 변화 시각 last를 둔다.
 *  - 목표 밝기 b가 |b − ref| > 변화 기준 이면 "변화"로 보고 ref = b, last = 지금.
 *    작은 흔들림(영상 노이즈)은 무시되지만, 조금씩 쌓인 변화도 기준을 넘으면 변화로 친다.
 *  - 변화 없이 유지 시간(hold)이 지나면 감광 계수 g가 최저 밝기(floor)로 지수 감쇠한다.
 *
 *        idle = 지금 − last − hold
 *        g    = 1                                        (idle ≤ 0)
 *             = floor + (1 − floor)·exp(−idle / τ)      (idle > 0)
 *
 *  - 출력 = b × g. 경과 시간으로 바로 계산하므로 fps와 무관하다.
 *  - 다시 변하면 g = 1로 돌아간다. 밝기 이징이 켜져 있으면 복귀도 이징으로 부드럽다.
 *
 * 판단은 감광 전 밝기 b로 한다. 스스로 어두워진 것을 변화로 오인하지 않는다.
 */
(function (global) {
  'use strict';

  class IdleDimmer {
    constructor() {
      this.n = 0;
      this.ref = new Float32Array(0);
      this.last = new Float64Array(0);
      this.out = new Float32Array(0);
      this.active = false;      // 유지 중이거나 감광이 진행 중인 소자가 있음 → 계속 그려야 함
      this.dimmed = 0;          // 감광된(g < 0.98) 켜진 소자 수
      this._fresh = true;
    }

    resize(n) {
      if (n === this.n) return;
      this.n = n;
      this.ref = new Float32Array(n);
      this.last = new Float64Array(n);
      this.out = new Float32Array(n);
      this._fresh = true;
    }

    /** 모드를 다시 켤 때: 모든 소자를 "방금 변함"으로 두고 시작 */
    restart() {
      this._fresh = true;
    }

    /**
     * @param base  감광 전 목표 밝기 b (Float32Array, n)
     * @param now   현재 시각(초)
     * @param p     {idleThr, idleHold, idleTau, idleFloor}
     * @returns     Float32Array  b × g
     */
    update(base, now, p) {
      const n = this.n;
      const ref = this.ref;
      const last = this.last;
      const out = this.out;
      if (this._fresh) {
        this._fresh = false;
        ref.set(base);
        last.fill(now);
      }
      const thr = p.idleThr;
      const hold = p.idleHold;
      const invTau = 1 / Math.max(0.05, p.idleTau);
      const floor = p.idleFloor;
      const span = 1 - floor;
      let active = false;
      let dimmed = 0;
      for (let i = 0; i < n; i++) {
        const b = base[i];
        if (Math.abs(b - ref[i]) > thr) {
          ref[i] = b;
          last[i] = now;
        }
        const idle = now - last[i] - hold;
        const g = idle > 0 ? floor + span * Math.exp(-idle * invTau) : 1;
        out[i] = b * g;
        if (b > 0.002) {
          if (g - floor > 0.002) active = true;
          if (g < 0.98) dimmed++;
        }
      }
      this.active = active;
      this.dimmed = dimmed;
      return out;
    }

    /** 변화가 멈춘 뒤 최저 밝기까지 95% 내려가는 데 걸리는 시간(초) */
    static time95(p) {
      return p.idleHold + Math.max(0.05, p.idleTau) * Math.log(20);
    }
  }

  global.IdleDimmer = IdleDimmer;
})(window);
