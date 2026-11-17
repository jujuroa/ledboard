"""
앱 아이콘을 만든다: 어두운 판 위의 2 × 2 LED 소자.

실행 화면의 특징을 옮겼다. 웜 앰버 소자가 밝기마다 다르게 켜지고,
가장 밝은 소자는 흰색에 가깝게 포화되며 글로우가 넓게 번진다.

산출물
  build/icon.ico       exe 아이콘 (electron-builder, 16~256 px)
  electron/icon.png    창·작업 표시줄 아이콘 (개발 실행), 브라우저 favicon

실행: python build/gen_icon.py   (Pillow 필요)
"""
import math
import os

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1024                      # 작업 해상도. 마지막에 줄인다
BG = (11, 11, 12)
OFF = (40, 34, 24)            # 꺼진 소자 바탕
AMBER = (232, 196, 132)       # 스크린샷의 중간 밝기 소자
HOT = (255, 250, 236)         # 포화된 소자

# (열, 행) → 밝기 0~1. 대각선 두 개는 밝게, 하나는 중간, 하나는 어둡게
LEVELS = {(0, 0): 1.0, (1, 0): 0.55, (0, 1): 0.22, (1, 1): 0.85}


def mix(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def led_color(level):
    """밝기에 따라 꺼짐 → 앰버 → 흰색으로 이어지는 색"""
    if level < 0.6:
        return mix(OFF, AMBER, level / 0.6)
    return mix(AMBER, HOT, (level - 0.6) / 0.4)


def render():
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))

    # 둥근 사각형 판
    pad = S * 0.04
    plate = Image.new('L', (S, S), 0)
    ImageDraw.Draw(plate).rounded_rectangle((pad, pad, S - pad, S - pad), radius=S * 0.2, fill=255)
    img.paste(Image.new('RGBA', (S, S), BG + (255,)), (0, 0), plate)

    pitch = S * 0.36
    origin = S / 2 - pitch / 2
    die_r = pitch * 0.36

    # 글로우: 밝은 소자일수록 넓고 강하게. 판 밖으로는 나가지 않게 마스크
    glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for (cx, cy), lv in LEVELS.items():
        x, y = origin + cx * pitch, origin + cy * pitch
        r = die_r * (1.0 + 1.1 * lv * lv)
        a = round(200 * lv ** 1.5)
        gd.ellipse((x - r, y - r, x + r, y + r), fill=led_color(lv) + (a,))
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.05))
    glow_masked = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    glow_masked.paste(glow, (0, 0), Image.composite(glow.getchannel('A'), Image.new('L', (S, S), 0), plate))
    img = Image.alpha_composite(img, glow_masked)

    # 다이: 가장자리를 살짝 어둡게 해서 구슬처럼
    dies = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    dd = ImageDraw.Draw(dies)
    steps = 24
    for (cx, cy), lv in LEVELS.items():
        x, y = origin + cx * pitch, origin + cy * pitch
        base = led_color(lv)
        for i in range(steps):
            t = i / (steps - 1)
            r = die_r * (1 - 0.55 * t)
            c = mix(mix(base, BG, 0.25), base, math.sqrt(t))
            dd.ellipse((x - r, y - r, x + r, y + r), fill=c + (255,))
    img = Image.alpha_composite(img, dies)
    return img


def main():
    big = render()
    sizes = [16, 24, 32, 48, 64, 128, 256]
    ico = os.path.join(ROOT, 'build', 'icon.ico')
    big.resize((256, 256), Image.LANCZOS).save(ico, sizes=[(s, s) for s in sizes])
    png = os.path.join(ROOT, 'electron', 'icon.png')
    big.resize((256, 256), Image.LANCZOS).save(png)
    print('wrote', ico, png)


if __name__ == '__main__':
    main()
