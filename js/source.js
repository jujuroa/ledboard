/*
 * FrameSource
 * 이미지·영상·카메라·내장 패턴을 LED 해상도(cols x rows) 캔버스로 샘플링한다.
 * 렌더러는 이 작은 캔버스의 픽셀 하나를 LED 소자 하나로 읽는다.
 */
(function (global) {
  'use strict';

  class FrameSource {
    constructor() {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
      this.kind = 'pattern';      // pattern | text | image | video | camera
      this.media = null;          // HTMLImageElement | HTMLVideoElement
      this.fit = 'contain';       // contain | cover | stretch
      this.text = 'HELLO LED BOARD  ★  안녕하세요  ';
      this.textSpeed = 20;        // LED/초
      this.pattern = 'gradient';
      this.objectUrl = null;
      this.stream = null;
      this._t0 = performance.now();
    }

    get animated() {
      // stream은 프레임이 도착할 때 main이 dirty를 세운다
      return this.kind !== 'image' && this.kind !== 'stream';
    }

    /** 외부 스트림(WebSocket 등) 소스로 전환. 프레임은 setStreamFrame으로 들어온다 */
    useStream() {
      this._release();
      this.kind = 'stream';
    }

    /** drawable: ImageBitmap 또는 canvas. 이전 ImageBitmap은 해제 */
    setStreamFrame(drawable) {
      if (this.kind !== 'stream') {
        if (drawable.close) drawable.close();
        return;
      }
      if (this.media && this.media !== drawable && this.media.close) this.media.close();
      this.media = drawable;
    }

    resize(cols, rows) {
      if (this.canvas.width !== cols || this.canvas.height !== rows) {
        this.canvas.width = cols;
        this.canvas.height = rows;
      }
    }

    _release() {
      if (this.media && this.media.tagName === 'VIDEO') {
        this.media.pause();
        this.media.srcObject = null;
        this.media.removeAttribute('src');
        this.media.load();
      }
      if (this.stream) {
        this.stream.getTracks().forEach((t) => t.stop());
        this.stream = null;
      }
      if (this.objectUrl) {
        URL.revokeObjectURL(this.objectUrl);
        this.objectUrl = null;
      }
      if (this.media && typeof ImageBitmap !== 'undefined' && this.media instanceof ImageBitmap) {
        this.media.close();
      }
      this.media = null;
    }

    usePattern(name) {
      this._release();
      this.kind = 'pattern';
      this.pattern = name;
    }

    useText(text) {
      this._release();
      this.kind = 'text';
      if (text != null) this.text = text;
      this._t0 = performance.now();
    }

    /** 파일(이미지/영상)을 불러온다. Promise<'image'|'video'> */
    loadFile(file) {
      this._release();
      const url = URL.createObjectURL(file);
      this.objectUrl = url;
      if (file.type.startsWith('video/')) {
        const v = document.createElement('video');
        v.src = url;
        v.muted = true;
        v.loop = true;
        v.playsInline = true;
        this.media = v;
        this.kind = 'video';
        return v.play().then(() => 'video');
      }
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          this.media = img;
          this.kind = 'image';
          resolve('image');
        };
        img.onerror = () => reject(new Error('이미지를 읽을 수 없음'));
        img.src = url;
      });
    }

    async useCamera() {
      this._release();
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      const v = document.createElement('video');
      v.srcObject = stream;
      v.muted = true;
      v.playsInline = true;
      await v.play();
      this.stream = stream;
      this.media = v;
      this.kind = 'camera';
    }

    togglePlay() {
      const v = this.media;
      if (!v || v.tagName !== 'VIDEO') return;
      if (v.paused) v.play(); else v.pause();
    }

    /** 현재 프레임을 LED 해상도 캔버스에 그린다. */
    draw(now) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      ctx.save();
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const t = (now - this._t0) / 1000;

      if (this.kind === 'image' || this.kind === 'video' || this.kind === 'camera' || this.kind === 'stream') {
        const m = this.media;
        // video → videoWidth, img → naturalWidth, ImageBitmap·canvas → width
        const mw = m && (m.videoWidth || m.naturalWidth || (m.tagName ? 0 : m.width) || (m.tagName === 'CANVAS' ? m.width : 0));
        const mh = m && (m.videoHeight || m.naturalHeight || (m.tagName ? 0 : m.height) || (m.tagName === 'CANVAS' ? m.height : 0));
        if (mw && mh) {
          let dw = W, dh = H;
          if (this.fit !== 'stretch') {
            const s = this.fit === 'cover' ? Math.max(W / mw, H / mh) : Math.min(W / mw, H / mh);
            dw = mw * s;
            dh = mh * s;
          }
          if (this.kind === 'camera') { // 거울 모드
            ctx.translate(W, 0);
            ctx.scale(-1, 1);
          }
          ctx.drawImage(m, (W - dw) / 2, (H - dh) / 2, dw, dh);
        }
      } else if (this.kind === 'text') {
        this._drawText(ctx, W, H, t);
      } else {
        this._drawPattern(ctx, W, H, t);
      }
      ctx.restore();
      return this.canvas;
    }

    _drawText(ctx, W, H, t) {
      const fontPx = Math.max(6, Math.round(H * 0.82));
      ctx.font = `bold ${fontPx}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      const text = this.text || ' ';
      const tw = Math.max(1, ctx.measureText(text).width);
      const span = tw + W;
      const x = W - ((t * this.textSpeed) % span);
      ctx.fillText(text, x, H / 2 + 0.5);
    }

    _drawPattern(ctx, W, H, t) {
      if (this.pattern === 'gradient') {
        // 위쪽: 왼쪽→오른쪽 밝기 계단. 아래쪽: 움직이는 사인 파형
        const half = Math.floor(H / 2);
        const steps = Math.min(W, 16);
        for (let i = 0; i < steps; i++) {
          const v = Math.round(((i + 1) / steps) * 255);
          ctx.fillStyle = `rgb(${v},${v},${v})`;
          const x0 = Math.floor((i * W) / steps);
          const x1 = Math.floor(((i + 1) * W) / steps);
          ctx.fillRect(x0, 0, x1 - x0, half);
        }
        const img = ctx.getImageData(0, half, W, H - half);
        const d = img.data;
        const h2 = H - half;
        for (let y = 0; y < h2; y++) {
          for (let x = 0; x < W; x++) {
            const yy = (y + 0.5) / h2;
            const wave = 0.5 + 0.4 * Math.sin(x / W * Math.PI * 4 - t * 2.5);
            const v = Math.max(0, 1 - Math.abs(yy - wave) * h2 * 0.45);
            const i = (y * W + x) * 4;
            d[i] = d[i + 1] = d[i + 2] = v * 255;
          }
        }
        ctx.putImageData(img, 0, half);
      } else if (this.pattern === 'plasma') {
        const img = ctx.createImageData(W, H);
        const d = img.data;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = x / W * 8, v = y / H * 8 * (H / W) * 2;
            const s = Math.sin(u + t) + Math.sin(v * 1.3 - t * 1.1)
              + Math.sin((u + v) * 0.7 + t * 0.7) + Math.sin(Math.hypot(u - 4, v - 4) * 1.2 - t * 1.6);
            const val = Math.pow((s / 4 + 1) / 2, 1.6) * 255;
            const i = (y * W + x) * 4;
            d[i] = d[i + 1] = d[i + 2] = val;
            d[i + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
      } else if (this.pattern === 'clock') {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const str = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        let fontPx = Math.round(H * 0.8);
        ctx.font = `bold ${fontPx}px Consolas, monospace`;
        const w = ctx.measureText(str).width;
        if (w > W * 0.95) {
          fontPx = Math.floor(fontPx * (W * 0.95) / w);
          ctx.font = `bold ${fontPx}px Consolas, monospace`;
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.fillText(str, W / 2, H / 2 + 0.5);
      }
    }

    dispose() {
      this._release();
    }
  }

  global.FrameSource = FrameSource;
})(window);
