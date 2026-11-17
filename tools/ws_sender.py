"""
LED Board Simulator WebSocket 발신 도구 (ledboard.v1)
docs/source-interface.md 5절 규격으로 시뮬레이터에 프레임을 보낸다.

시뮬레이터가 클라이언트이므로 이 도구는 WebSocket 서버로 동작한다.
  1) python tools/ws_sender.py led
  2) 브라우저 주소창에 전체 주소로 시뮬레이터를 열거나
       file:///<저장소 경로>/index.html?ws=ws://127.0.0.1:8765/
     소스 → 외부 스트림 · WebSocket 에서 주소를 넣고 [연결]

모드
  led     LED 직접 입력. 보드 해상도에 맞춰 움직이는 패턴을 보냄 (--format l8|l4|l1, --regions)
  raw     RAW 픽셀. 임의 해상도(--size)의 컬러 패턴을 보냄 (--format gray8|rgb24|rgba32)
  image   IMAGE. 파일 또는 폴더의 JPEG/PNG/WebP를 순서대로 보냄 (--interval)

의존성: websockets (pip install -r tools/requirements.txt)
"""
import argparse
import asyncio
import json
import math
import time
from pathlib import Path

import websockets

import ledboard_proto as proto


def led_pattern(cols, rows, t):
    """사인 파형 + 왼쪽→오른쪽 밝기 계단 + 움직이는 세로 막대"""
    v = [0] * (cols * rows)
    bar = int(t * 20) % cols
    for y in range(rows):
        for x in range(cols):
            yy = (y + 0.5) / rows
            wave = 0.5 + 0.35 * math.sin(x / cols * math.tau * 2 - t * 3)
            s = max(0.0, 1 - abs(yy - wave) * rows * 0.5)
            if y < rows // 4:
                s = max(s, (x + 1) / cols)
            if x == bar:
                s = 1.0
            v[y * cols + x] = int(min(1.0, s) * 255)
    return v


def raw_pattern(w, h, t, bpp):
    """움직이는 컬러 원 + 대각선 그라데이션"""
    out = bytearray(w * h * bpp)
    cx = w * (0.5 + 0.35 * math.cos(t))
    cy = h * (0.5 + 0.35 * math.sin(t * 1.3))
    rad = min(w, h) * 0.22
    i = 0
    for y in range(h):
        for x in range(w):
            g = (x + y) / (w + h) * 0.35
            d = math.hypot(x - cx, y - cy)
            c = 1.0 if d < rad else max(0.0, 1 - (d - rad) / (rad * 0.4))
            r, gg, b = min(1, c + g), min(1, c * 0.6 + g), min(1, g)
            if bpp == 1:
                out[i] = int((0.2126 * r + 0.7152 * gg + 0.0722 * b) * 255)
            else:
                out[i], out[i + 1], out[i + 2] = int(r * 255), int(gg * 255), int(b * 255)
                if bpp == 4:
                    out[i + 3] = 255
            i += bpp
    return bytes(out)


class Session:
    def __init__(self, ws, args):
        self.ws = ws
        self.args = args
        self.cols = self.rows = None
        self.board_event = asyncio.Event()

    async def reader(self):
        async for msg in self.ws:
            if isinstance(msg, bytes):
                continue
            m = json.loads(msg)
            t = m.get("type")
            if t in ("hello", "state"):
                self.cols, self.rows = m["board"]["cols"], m["board"]["rows"]
                self.board_event.set()
                print(f"[{t}] board {self.cols}x{self.rows}"
                      + (f" hint {m['hint']}" if t == "hello" else f" ledTone {m.get('ledTone')}"))
            elif t == "stats":
                if not self.args.quiet:
                    print(f"[stats] rx {m['received']} decoded {m['decoded']} "
                          f"displayed {m['displayed']} dropped {m['dropped']} "
                          f"lastSeq {m['lastSeq']} decodeMs {m['decodeMs']}")
            elif t == "error":
                print(f"[error] {m.get('code')} {m.get('message')} seq={m.get('seq')}")
            else:
                print(f"[{t}] {m}")

    async def run(self):
        reader = asyncio.create_task(self.reader())
        try:
            await asyncio.wait_for(self.board_event.wait(), 5)
            cfg = {k: v for k, v in (("cols", self.args.cols), ("rows", self.args.rows),
                                     ("ledTone", self.args.ledtone)) if v is not None}
            if cfg:
                self.board_event.clear()
                await self.ws.send(json.dumps({"type": "config", **cfg}))
                print(f"[send] config {cfg}")
                await asyncio.sleep(0.2)
            await getattr(self, "send_" + self.args.mode)()
            if self.args.count:
                await self.ws.send(json.dumps({"type": "end"}))
                print("[send] end")
                await asyncio.sleep(1.5)       # 마지막 stats 수신
        finally:
            reader.cancel()

    async def frames(self):
        """(seq, 경과 시간)을 --fps 간격으로 낸다. --count가 0이면 무한"""
        n = self.args.count or 10 ** 12
        dt = 1 / self.args.fps
        t0 = time.monotonic()
        nxt = t0
        for i in range(n):
            yield i, time.monotonic() - t0
            # 송신이 막혀 늦어졌으면 밀린 프레임을 몰아 보내지 않고 일정을 다시 잡는다
            nxt = max(nxt + dt, time.monotonic())
            await asyncio.sleep(max(0.0, nxt - time.monotonic()))

    async def send_led(self):
        fmt = self.args.format or "l8"
        async for seq, t in self.frames():
            cols, rows = self.cols, self.rows
            vals = led_pattern(cols, rows, t)
            if self.args.regions and rows >= 2:
                # 위·아래 절반을 따로 보내고 마지막에 COMMIT
                h1 = rows // 2
                parts = [(0, h1, 0), (h1, rows - h1, proto.F_COMMIT)]
                for y0, hh, fl in parts:
                    region = vals[y0 * cols:(y0 + hh) * cols]
                    await self.ws.send(proto.led_msg(fmt, seq, region, 0, y0, cols, hh, fl))
            else:
                await self.ws.send(proto.led_msg(fmt, seq, vals, 0, 0, cols, rows))

    async def send_raw(self):
        fmt = self.args.format or "rgb24"
        bpp = proto.RAW_FMT[fmt][1]
        w, h = (int(v) for v in self.args.size.lower().split("x"))
        async for seq, t in self.frames():
            await self.ws.send(proto.raw_msg(fmt, seq, w, h, raw_pattern(w, h, t, bpp)))

    async def send_image(self):
        p = Path(self.args.path)
        files = sorted(f for f in (p.iterdir() if p.is_dir() else [p]) if f.suffix.lower() in proto.IMAGE_EXT)
        if not files:
            raise SystemExit(f"이미지 파일 없음: {p}")
        seq = 0
        while True:
            for f in files:
                await self.ws.send(proto.image_msg(proto.IMAGE_EXT[f.suffix.lower()], seq, f.read_bytes()))
                print(f"[send] IMAGE seq {seq} {f.name}")
                seq += 1
                if self.args.count and seq >= self.args.count:
                    return
                await asyncio.sleep(self.args.interval)


async def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=["led", "raw", "image"])
    ap.add_argument("path", nargs="?", help="image 모드: 파일 또는 폴더")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--fps", type=float, default=30)
    ap.add_argument("--count", type=int, default=0, help="이만큼 보낸 뒤 end 전송 (0 = 무한)")
    ap.add_argument("--format", help="led: l8|l4|l1, raw: gray8|rgb24|rgba32")
    ap.add_argument("--regions", action="store_true", help="led: 위·아래 영역으로 나눠 보내고 마지막에 COMMIT")
    ap.add_argument("--size", default="320x180", help="raw: 원본 해상도 WxH")
    ap.add_argument("--interval", type=float, default=2.0, help="image: 장 사이 간격(초)")
    ap.add_argument("--cols", type=int, help="시작 시 config로 보드 열 수 변경 요청")
    ap.add_argument("--rows", type=int, help="시작 시 config로 보드 행 수 변경 요청")
    ap.add_argument("--ledtone", choices=["apply", "bypass"], help="시작 시 config로 ledTone 변경 요청")
    ap.add_argument("--quiet", action="store_true", help="stats 출력 생략")
    args = ap.parse_args()
    if args.mode == "image" and not args.path:
        ap.error("image 모드는 path 필요")

    async def handler(ws):
        print(f"[conn] {ws.remote_address} subprotocol={ws.subprotocol}")
        try:
            await Session(ws, args).run()
        except websockets.ConnectionClosed:
            pass
        print("[conn] closed")

    async with websockets.serve(handler, args.host, args.port, subprotocols=[proto.SUBPROTOCOL],
                                max_size=None):
        print(f"ws://{args.host}:{args.port}/ 대기 중 ({args.mode})")
        print("브라우저 주소창에 붙여넣기:", proto.sim_url(args.host, args.port))
        await asyncio.Future()


if __name__ == "__main__":
    # 콘솔·리다이렉트 인코딩(cp949 등)에서 출력하지 못하는 문자가 있어도 죽지 않게
    import sys
    sys.stdout.reconfigure(errors="replace")
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
