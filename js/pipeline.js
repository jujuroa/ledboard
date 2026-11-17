/*
 * BrightnessPipeline — CPU 밝기 파이프라인
 *
 *   입력 프레임(rgba | luma8) → 톤 처리(LedTone) → [정지 소자 감광] → [밝기 이징] → bright 프레임
 *
 * CPU 경로를 타는 경우
 *   - 밝기 이징이나 정지 소자 감광이 켜져 있을 때 (소자별 상태가 필요)
 *   - 렌더러가 bright 프레임만 받을 때 (Canvas2DRenderer.needsBrightness)
 * 그 밖에는 입력 프레임을 그대로 넘기고, GL 셰이더가 톤 처리를 한다.
 */
(function (global) {
  'use strict';

  class BrightnessPipeline {
    constructor() {
      this.dynamics = new BrightnessDynamics();   // 소자 밝기 이징 (가속도 모델)
      this.dimmer = new IdleDimmer();             // 정지 소자 감광
      this.base = new Float32Array(0);            // 톤 처리 직후 목표 밝기 (감광·이징 전)
      this.cpu = false;
    }

    /**
     * 이번 프레임의 경로를 정한다. 목표 밝기 버퍼를 새로 잡았으면 true
     * → 호출자는 소스를 다시 읽어 새 크기의 목표를 계산하게 해야 한다.
     * @param forceCpu  렌더러가 bright 프레임만 받으면 true
     */
    prepare(p, forceCpu) {
      this.cpu = !!forceCpu || p.easeOn || p.idleOn;
      const n = p.cols * p.rows;
      if (this.cpu && this.base.length !== n) {
        this.base = new Float32Array(n);
        return true;
      }
      return false;
    }

    /**
     * @param frame       입력 프레임 (rgba | luma8). needSource가 false면 직전 프레임
     * @param now         현재 시각(초). 감광 시간 계산
     * @param dt          지난 루프 이후 경과(초). 이징 적분 간격
     * @param needSource  true면 frame에서 목표 밝기를 다시 계산, false면 감광·이징만 진행
     * @returns 렌더러에 넘길 프레임
     */
    process(frame, p, now, dt, needSource) {
      if (!this.cpu) return frame;
      const n = p.cols * p.rows;
      if (needSource) LedTone.computeTargets(frame, p, this.base, p.cols, p.rows);
      let target = this.base;
      if (p.idleOn) {
        this.dimmer.resize(n);
        target = this.dimmer.update(this.base, now, p);   // 매 프레임: 시간이 지나며 감광
      }
      let out = target;
      if (p.easeOn) {
        this.dynamics.resize(p.cols, p.rows);
        if (needSource || p.idleOn) this.dynamics.setTargetArray(target);
        this.dynamics.step(dt, p.easeFreq, p.easeZeta);
        out = this.dynamics.display;
      }
      return LedFrame.bright(out, p.cols, p.rows);
    }

    /** 소스가 그대로여도 밝기가 목표로 움직이거나 감광이 진행 중이면 계속 그려야 한다 */
    moving(p) {
      return (p.easeOn && this.dynamics.active) || (p.idleOn && this.dimmer.active);
    }
  }

  global.BrightnessPipeline = BrightnessPipeline;
})(window);
