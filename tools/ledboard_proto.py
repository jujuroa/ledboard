"""
ledboard.v1 프로토콜 공통 모듈 (발신 측)
docs/source-interface.md 5절 규격. 시뮬레이터 수신 측 구현은 js/ws-channel.js.

ws_sender.py, webcam_sender.py가 함께 쓴다. 규격이 바뀌면 이 파일과 ws-channel.js만 고친다.
"""
import struct
import time
from pathlib import Path

SUBPROTOCOL = "ledboard.v1"
VERSION = 1
MAGIC = b"LB"

# 24 byte, little-endian
#   magic(2) version type format flags reserved(2) seq(4) timestamp(4) x y width height (각 2)
HEADER = struct.Struct("<2sBBBBHIIHHHH")
assert HEADER.size == 24

# type
T_IMAGE = 0x10
T_RAW = 0x11
T_LED = 0x20

# flags (LED)
F_COMMIT = 0x01
F_CLEAR = 0x02

# format 코드
IMAGE_FMT = {"jpeg": 1, "png": 2, "webp": 3}
IMAGE_EXT = {".jpg": "jpeg", ".jpeg": "jpeg", ".png": "png", ".webp": "webp"}
RAW_FMT = {"gray8": (1, 1), "rgb24": (2, 3), "rgba32": (3, 4)}     # 이름 → (코드, byte/픽셀)
LED_FMT = {"l8": (1, 8), "l4": (2, 4), "l1": (3, 1)}               # 이름 → (코드, bit/소자)


def _timestamp():
    return int(time.monotonic() * 1000) & 0xFFFFFFFF


def header(type_, fmt, seq, flags=0, x=0, y=0, w=0, h=0, timestamp=None):
    ts = _timestamp() if timestamp is None else timestamp & 0xFFFFFFFF
    return HEADER.pack(MAGIC, VERSION, type_, fmt, flags, 0, seq & 0xFFFFFFFF, ts, x, y, w, h)


def parse_header(buf):
    """시뮬레이터의 parseHeader와 같은 해석. magic이 틀리거나 짧으면 None"""
    if len(buf) < HEADER.size or buf[:2] != MAGIC:
        return None
    _, version, type_, fmt, flags, _, seq, ts, x, y, w, h = HEADER.unpack_from(buf)
    return {
        "version": version, "type": type_, "format": fmt, "flags": flags,
        "seq": seq, "timestamp": ts, "x": x, "y": y, "width": w, "height": h,
        "payload": bytes(buf[HEADER.size:]),
    }


# ---- 메시지 ----------------------------------------------------------------
def image_msg(fmt, seq, data):
    """IMAGE (0x10). fmt: 'jpeg' | 'png' | 'webp'"""
    return header(T_IMAGE, IMAGE_FMT[fmt], seq) + data


def raw_msg(fmt, seq, w, h, data):
    """RAW (0x11). fmt: 'gray8' | 'rgb24' | 'rgba32'. data 길이는 w × h × bpp"""
    code, bpp = RAW_FMT[fmt]
    if len(data) != w * h * bpp:
        raise ValueError(f"RAW {fmt} {w}x{h}: payload {len(data)} != {w * h * bpp}")
    return header(T_RAW, code, seq, w=w, h=h) + data


def led_msg(fmt, seq, values, x, y, w, h, flags=F_COMMIT):
    """LED (0x20). values: 0~255 값 w × h개(행 우선). fmt: 'l8' | 'l4' | 'l1'"""
    code, bits = LED_FMT[fmt]
    if len(values) != w * h:
        raise ValueError(f"LED 영역 {w}x{h}: 값 {len(values)}개 != {w * h}")
    return header(T_LED, code, seq, flags, x, y, w, h) + pack_led(values, w, bits)


def pack_led(values, w, bits):
    """values: 0~255 리스트(행 우선, 폭 w). 행마다 바이트 경계 정렬, 상위 비트가 왼쪽 소자"""
    if bits == 8:
        return bytes(values)
    out = bytearray()
    for r in range(len(values) // w):
        row = values[r * w:(r + 1) * w]
        if bits == 4:
            for c in range(0, w, 2):
                hi = row[c] // 17
                lo = row[c + 1] // 17 if c + 1 < w else 0
                out.append((hi << 4) | lo)
        else:
            for c in range(0, w, 8):
                byte = 0
                for k in range(8):
                    if c + k < w and row[c + k] >= 128:
                        byte |= 0x80 >> k
                out.append(byte)
    return bytes(out)


def unpack_led(payload, w, h, bits):
    """pack_led의 역. 시뮬레이터가 back 버퍼에 쓰는 값(L4는 × 17, L1은 0/255)과 같음"""
    stride = (w * bits + 7) // 8
    out = []
    for r in range(h):
        row = payload[r * stride:(r + 1) * stride]
        for c in range(w):
            if bits == 8:
                out.append(row[c])
            elif bits == 4:
                byte = row[c >> 1]
                out.append(((byte & 0x0F) if c & 1 else (byte >> 4)) * 17)
            else:
                out.append(255 if (row[c >> 3] >> (7 - (c & 7))) & 1 else 0)
    return out


# ---- 시뮬레이터 규칙 -------------------------------------------------------
def hint_from_board(cols, rows):
    """시뮬레이터 hello의 hint 계산 규칙과 같음: 보드의 8배, 최대 1920x1080"""
    return min(1920, cols * 8), min(1080, rows * 8)


# ---- 도구 공통 -------------------------------------------------------------
def sim_url(host, port):
    """이 저장소의 index.html을 파일로 여는 전체 주소 (주소창에 그대로 붙여넣기용)"""
    page = (Path(__file__).resolve().parent.parent / "index.html").as_uri()
    h = "127.0.0.1" if host in ("0.0.0.0", "") else host
    return f"{page}?ws=ws://{h}:{port}/"
