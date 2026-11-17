"""
웹캠 → LED Board Simulator 테스트베드 (ledboard.v1, WebSocket)

노트북 웹캠(또는 영상 파일)을 캡처해 시뮬레이터로 보낸다.
docs/source-interface.md 의 계열 A(이미지 스트림) 경로를 시험한다.

  1) python tools/webcam_sender.py
  2) 브라우저 주소창에 전체 주소로 시뮬레이터를 연다
       file:///<저장소 경로>/index.html?ws=ws://127.0.0.1:8766/
     (index.html?ws=... 만 넣으면 index.html을 도메인으로 해석해 DNS 오류가 남)

처리 흐름
  캡처 스레드: 카메라에서 계속 읽어 "가장 최근 프레임" 하나만 보관
  송신 루프  : --fps 간격으로 최근 프레임을 꺼내
               hello의 hint(권장 최대 크기) 안으로 축소 → 좌우 반전 → JPEG 압축
               → 24 byte 헤더(type IMAGE) + JPEG 바이트 전송
  카메라는 시뮬레이터가 접속해 있는 동안에만 켠다.

포맷
  --format jpeg   IMAGE(JPEG)  기본. 대역폭이 작음
  --format gray8  RAW(GRAY8)   흑백 무압축. 압축 손실 없음

의존성: pip install -r tools/requirements.txt
"""
import argparse
import asyncio
import json
import sys
import threading
import time

import cv2
import websockets

import ledboard_proto as proto


class Capture:
    """카메라를 별도 스레드에서 읽고 최신 프레임만 보관. 사용자가 있을 때만 켠다."""

    def __init__(self, source, width, height, backend="dshow"):
        self.source = source
        self.backend = backend
        self.req_size = (width, height)
        self.lock = threading.Lock()
        self.frame = None
        self.index = 0          # 새 프레임마다 증가
        self.users = 0
        self.thread = None
        self.running = False
        self.error = None
        self.fps = 0.0

    def acquire(self):
        with self.lock:
            self.users += 1
            if self.running:
                return
            self.running = True
            self.error = None
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def release(self):
        with self.lock:
            self.users -= 1
            stop = self.users <= 0
            if stop:
                self.running = False
        if stop and self.thread:
            self.thread.join(timeout=2)
            self.thread = None
            print("[camera] off")

    def _open(self):
        src = self.source
        if isinstance(src, int) and sys.platform == "win32" and self.backend != "auto":
            # DSHOW: 여는 속도가 빠름. 고해상도에서 fps가 떨어지는 카메라가 있음 → 그때는 msmf
            api = cv2.CAP_DSHOW if self.backend == "dshow" else cv2.CAP_MSMF
            cap = cv2.VideoCapture(src, api)
        else:
            cap = cv2.VideoCapture(src)
        w, h = self.req_size
        if isinstance(src, int) and w and h:
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, w)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, h)
        return cap

    def _run(self):
        cap = self._open()
        if not cap.isOpened():
            self.error = f"카메라/영상을 열 수 없음: {self.source}"
            print("[camera]", self.error)
            self.running = False
            return
        print(f"[camera] on  {int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))}x{int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))}")
        is_file = not isinstance(self.source, int)
        file_dt = 1 / (cap.get(cv2.CAP_PROP_FPS) or 30) if is_file else 0
        n, t0 = 0, time.monotonic()
        while self.running:
            ok, frame = cap.read()
            if not ok:
                if is_file:                       # 영상 파일은 처음부터 반복
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                time.sleep(0.01)
                continue
            with self.lock:
                self.frame = frame
                self.index += 1
            n += 1
            now = time.monotonic()
            if now - t0 >= 1:
                self.fps, n, t0 = n / (now - t0), 0, now
            if file_dt:
                time.sleep(file_dt)
        cap.release()

    def latest(self):
        with self.lock:
            return self.index, self.frame


def fit_size(w, h, max_w, max_h):
    """원본 비율을 유지하며 (max_w, max_h) 안에 들어가는 크기. 확대는 하지 않음"""
    s = min(max_w / w, max_h / h, 1.0)
    return max(1, round(w * s)), max(1, round(h * s))


class Session:
    def __init__(self, ws, cap, args):
        self.ws = ws
        self.cap = cap
        self.args = args
        self.hint = None
        self.sim = {}

    async def reader(self):
        async for msg in self.ws:
            if isinstance(msg, bytes):
                continue
            m = json.loads(msg)
            t = m.get("type")
            if t == "hello":
                self.hint = (m["hint"]["maxWidth"], m["hint"]["maxHeight"])
                b = m["board"]
                print(f"[hello] board {b['cols']}x{b['rows']} → 송신 최대 크기 {self.hint[0]}x{self.hint[1]}")
            elif t == "state":
                b = m["board"]
                self.hint = proto.hint_from_board(b["cols"], b["rows"])
                print(f"[state] board {b['cols']}x{b['rows']} → 송신 최대 크기 {self.hint[0]}x{self.hint[1]}")
            elif t == "stats":
                self.sim = m
            elif t == "error":
                print(f"[error] {m.get('code')} {m.get('message')}")

    def encode(self, frame, seq):
        """(메시지, w, h, payload 크기, 처리 ms). 송신 스레드에서 실행"""
        t0 = time.perf_counter()
        msg, w, h = self._encode(frame, seq)
        return msg, w, h, len(msg) - proto.HEADER.size, (time.perf_counter() - t0) * 1000

    def _encode(self, frame, seq):
        a = self.args
        fh, fw = frame.shape[:2]
        max_w, max_h = (a.width, a.height) if a.width and a.height else self.hint
        w, h = fit_size(fw, fh, max_w, max_h)
        if (w, h) != (fw, fh):
            frame = cv2.resize(frame, (w, h), interpolation=cv2.INTER_AREA)
        if a.mirror:
            frame = cv2.flip(frame, 1)
        if a.format == "gray8":
            g = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            return proto.raw_msg("gray8", seq, w, h, g.tobytes()), w, h
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, a.quality])
        return proto.image_msg("jpeg", seq, buf.tobytes()), w, h

    async def run(self):
        reader = asyncio.create_task(self.reader())
        self.cap.acquire()
        try:
            while self.hint is None:
                await asyncio.sleep(0.02)
            dt = 1 / self.args.fps
            nxt = time.monotonic()
            last_idx, seq = -1, 0
            sent, nbytes, enc_ms, t_rep = 0, 0, 0.0, time.monotonic()
            while True:
                if self.cap.error:
                    print("[stop]", self.cap.error)
                    await self.ws.send(json.dumps({"type": "end"}))
                    return
                idx, frame = self.cap.latest()
                if frame is not None and idx != last_idx:   # 새 프레임만 보냄
                    last_idx = idx
                    msg, w, h, nb, ms = await asyncio.to_thread(self.encode, frame, seq)
                    enc_ms += ms
                    await self.ws.send(msg)
                    seq += 1
                    sent += 1
                    nbytes += nb
                    size = f"{w}x{h}"
                now = time.monotonic()
                if now - t_rep >= 2 and sent:
                    el = now - t_rep
                    s = self.sim
                    print(f"[send] {size} {self.args.format} · 카메라 {self.cap.fps:.0f} fps · 송신 {sent / el:.1f} fps"
                          f" · {nbytes / sent / 1000:.1f} KB/프레임 · {nbytes * 8 / el / 1e6:.2f} Mbps · 인코드 {enc_ms / sent:.1f} ms"
                          f" │ 시뮬레이터 표시 {s.get('displayed', '-')} 폐기 {s.get('dropped', '-')} 디코드 {s.get('decodeMs', '-')} ms")
                    sent, nbytes, enc_ms, t_rep = 0, 0, 0.0, now
                nxt = max(nxt + dt, time.monotonic())
                await asyncio.sleep(max(0.0, nxt - time.monotonic()))
        finally:
            reader.cancel()
            await asyncio.to_thread(self.cap.release)


async def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--camera", type=int, default=0, help="카메라 번호 (기본 0)")
    ap.add_argument("--video", help="카메라 대신 영상 파일을 반복 재생")
    ap.add_argument("--host", default="127.0.0.1", help="다른 PC에서 받으려면 0.0.0.0")
    ap.add_argument("--port", type=int, default=8766)
    ap.add_argument("--fps", type=float, default=30, help="최대 송신 fps")
    ap.add_argument("--format", choices=["jpeg", "gray8"], default="jpeg")
    ap.add_argument("--quality", type=int, default=80, help="JPEG 품질 1~100")
    ap.add_argument("--width", type=int, help="송신 최대 폭 (기본: 시뮬레이터 hint)")
    ap.add_argument("--height", type=int, help="송신 최대 높이 (기본: 시뮬레이터 hint)")
    ap.add_argument("--cap-width", type=int, default=640, help="카메라에 요청할 캡처 폭 (보드 폭의 4~8배면 충분)")
    ap.add_argument("--cap-height", type=int, default=360, help="카메라에 요청할 캡처 높이")
    ap.add_argument("--backend", choices=["dshow", "msmf", "auto"], default="dshow",
                    help="Windows 캡처 백엔드. 고해상도에서 fps가 낮으면 msmf")
    ap.add_argument("--no-mirror", dest="mirror", action="store_false", help="좌우 반전 끄기")
    args = ap.parse_args()

    cap = Capture(args.video if args.video else args.camera, args.cap_width, args.cap_height, args.backend)

    async def handler(ws):
        print(f"[conn] {ws.remote_address}")
        try:
            await Session(ws, cap, args).run()
        except websockets.ConnectionClosed:
            pass
        print("[conn] closed")

    async with websockets.serve(handler, args.host, args.port, subprotocols=[proto.SUBPROTOCOL], max_size=None):
        src = args.video or f"camera {args.camera}"
        print(f"ws://{args.host}:{args.port}/ 대기 중 ({src}, {args.format}). 시뮬레이터가 접속하면 카메라를 켬")
        print("브라우저 주소창에 붙여넣기:", proto.sim_url(args.host, args.port))
        await asyncio.Future()


if __name__ == "__main__":
    # 콘솔·리다이렉트 인코딩(cp949 등)에서 출력하지 못하는 문자가 있어도 죽지 않게
    sys.stdout.reconfigure(errors="replace")
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
