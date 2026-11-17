"""
design.md 의 '밝기별 글로우 프로파일' 그림(profile.svg)을 만든다.
js/glow-sprite.js 의 profile() 식을 그대로 옮겼다. 외부 의존성 없음.

실행: python -I docs/design/gen_profile_svg.py
"""
import math
import os

# 그림용 파라미터. 처음 index.html 초기값이며, 지금 초기값과는 다를 수 있음
SPREAD, CORE, HALO, HALO_W = 3.0, 0.62, 0.55, 0.40


def smoothstep(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def profile(r):
    rc = CORE * 0.5
    die = 1 - smoothstep(rc - 0.04, rc + 0.04, r)
    core_lum = die * (0.85 + 0.15 * (1 - min(1.0, r / rc)))
    d = max(0.0, r - rc * 0.6)
    w = HALO_W
    halo = HALO * (0.55 * math.exp(-(d * d) / (2 * w * w * 0.35)) + 0.45 * math.exp(-d / w))
    e = min(1.0, r / SPREAD)
    win = (1 - e * e) ** 2
    return min(1.0, (core_lum + halo) * win)


def visible_radius(b, t):
    """b * P(r) >= t 를 만족하는 최대 r (피치 단위)"""
    r, last = 0.0, None
    while r <= SPREAD:
        if b * profile(r) >= t:
            last = r
        r += 0.001
    return last


BS = [1.0, 0.5, 0.25, 0.1]
COLORS = ["#d9480f", "#e67700", "#f59f00", "#94a3b8"]
T = 0.02

# ---- SVG ----
W, H = 760, 360
ML, MR, MT, MB = 64, 24, 24, 52
PW, PH = W - ML - MR, H - MT - MB
RMAX = 2.0


def X(r):
    return ML + r / RMAX * PW


def Y(v):
    # 로그 축: 0.002 ~ 1
    lo, hi = math.log10(0.002), 0.0
    v = max(v, 0.002)
    return MT + (hi - math.log10(v)) / (hi - lo) * PH


out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" '
       f'font-family="Malgun Gothic, Segoe UI, sans-serif" font-size="12">',
       f'<rect width="{W}" height="{H}" fill="#ffffff"/>']
for v in [1, 0.1, 0.01]:
    out.append(f'<line x1="{ML}" x2="{ML + PW}" y1="{Y(v):.1f}" y2="{Y(v):.1f}" stroke="#e5e7eb"/>')
    out.append(f'<text x="{ML - 8}" y="{Y(v) + 4:.1f}" text-anchor="end" fill="#555">{v:g}</text>')
for i in range(0, 5):
    r = i * 0.5
    out.append(f'<line x1="{X(r):.1f}" x2="{X(r):.1f}" y1="{MT}" y2="{MT + PH}" stroke="#e5e7eb"/>')
    out.append(f'<text x="{X(r):.1f}" y="{MT + PH + 18}" text-anchor="middle" fill="#555">{r:g}</text>')
out.append(f'<text x="{ML + PW / 2}" y="{H - 10}" text-anchor="middle" fill="#333">'
           f'중심으로부터 거리 r (피치 단위)</text>')
out.append(f'<text transform="translate(16 {MT + PH / 2}) rotate(-90)" text-anchor="middle" fill="#333">'
           f'화면 밝기 b·P(r) (로그)</text>')
# 임계값
out.append(f'<line x1="{ML}" x2="{ML + PW}" y1="{Y(T):.1f}" y2="{Y(T):.1f}" stroke="#111" '
           f'stroke-dasharray="5 4"/>')
out.append(f'<text x="{ML + PW - 4}" y="{Y(T) - 6:.1f}" text-anchor="end" fill="#111">'
           f'인지 임계값 t = {T}</text>')

rows = []
for b, c in zip(BS, COLORS):
    pts = []
    r = 0.0
    while r <= RMAX:
        pts.append(f"{X(r):.1f},{Y(b * profile(r)):.1f}")
        r += 0.01
    out.append(f'<polyline fill="none" stroke="{c}" stroke-width="2.2" points="{" ".join(pts)}"/>')
    rv = visible_radius(b, T)
    rows.append((b, rv, visible_radius(b, 1 / 255)))
    if rv is not None and rv <= RMAX:
        out.append(f'<circle cx="{X(rv):.1f}" cy="{Y(T):.1f}" r="4" fill="{c}"/>')

# 범례
lx, ly = ML + PW - 150, MT + 14
for i, (b, c) in enumerate(zip(BS, COLORS)):
    y = ly + i * 18
    out.append(f'<line x1="{lx}" x2="{lx + 24}" y1="{y}" y2="{y}" stroke="{c}" stroke-width="2.2"/>')
    out.append(f'<text x="{lx + 30}" y="{y + 4}" fill="#333">b = {b:g}</text>')
out.append('</svg>')

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "profile.svg"), "w", encoding="utf-8") as f:
    f.write("\n".join(out))

print("b, 보이는 반경(t=0.02), 보이는 반경(t=1/255)")
for b, r1, r2 in rows:
    print(b, None if r1 is None else round(r1, 2), None if r2 is None else round(r2, 2))
