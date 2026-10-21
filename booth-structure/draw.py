import math
from gen import *

FONT = "'Apple SD Gothic Neo','Malgun Gothic',sans-serif"
out = []
def T(x, y, s, size=22, w=600, fill='#3a2a20', anchor='start'):
    out.append(f'<text x="{x:.1f}" y="{y:.1f}" font-family="{FONT}" font-size="{size}" font-weight="{w}" fill="{fill}" text-anchor="{anchor}">{s}</text>')

# ── 1) 등각 투상 (뒤쪽 오른쪽 위에서 본 모습: 부스 안쪽과 장비 모듈 안쪽 면이 보임)
S = 0.225
C30, S30 = math.cos(math.radians(30)), math.sin(math.radians(30))
OX, OY = 150 + D * C30 * S, 150 + H * S
def iso(p):
    # 입구 쪽 뒤(+x, +y, 위)에서 내려다본 모습: 장비 모듈 안쪽 면이 보인다
    x, y, z = p
    return OX + (x - y) * C30 * S, OY + ((x + y) * S30 - z) * S
def poly(pts, fill, op=1, stroke='none'):
    s = ' '.join(f'{iso(p)[0]:.1f},{iso(p)[1]:.1f}' for p in pts)
    out.append(f'<polygon points="{s}" fill="{fill}" fill-opacity="{op}" stroke="{stroke}"/>')

out.append('<svg xmlns="http://www.w3.org/2000/svg" width="1700" height="1080" viewBox="0 0 1700 1080">')
out.append('<rect width="1700" height="1080" fill="#fbf6ee"/>')
T(40, 52, '포토부스 구조물 — 알루미늄 프로파일 3030', 32, 800)
T(40, 86, '외곽 1200(폭) × 2000(깊이) × 1950(높이) mm · 앞 400mm = 장비 모듈 · 나머지 = 촬영 공간', 19, 500, '#7a6656')

# 패널/천 (반투명) — 먼저 그려서 프레임 뒤로
poly([(0, YM, 0), (W, YM, 0), (W, YM, H), (0, YM, H)], '#ffffff', 0.55)          # 장비 모듈 안쪽 면 패널
poly([(0, YM, 0), (0, D, 0), (0, D, H), (0, YM, H)], '#ffffff', 0.35)            # 왼쪽 벽 패널
poly([(0, YM, 0), (W, YM, 0), (W, D, 0), (0, D, 0)], '#e9e1d6', 0.6)              # 바닥
poly([(0, D, 0), (W, D, 0), (W, D, H), (0, D, H)], '#bcdcff', 0.18, '#2f6fdb')     # 배경천
poly([(W, YM, 60), (W, D, 60), (W, D, H - 40), (W, YM, H - 40)], '#f08a3c', 0.08, '#f08a3c')  # 입구 커튼
# 디스플레이, 카메라, 프린터
dx0, dx1, dz0, dz1 = 380, 820, 1000, 1360
poly([(dx0, YM + 2, dz0), (dx1, YM + 2, dz0), (dx1, YM + 2, dz1), (dx0, YM + 2, dz1)], '#1d1612', 0.9)
poly([(560, YM + 2, 1490), (640, YM + 2, 1490), (640, YM + 2, 1570), (560, YM + 2, 1570)], '#e8455a', 0.95)
poly([(470, YM + 2, 885), (730, YM + 2, 885), (730, YM + 2, 950), (470, YM + 2, 950)], '#7a6656', 0.9)

# 프레임: 멀리 있는 것부터
colors = {'stud': '#8f99a8', 'post': '#8f99a8', 'xrail': '#a9b3c1', 'yrail': '#a9b3c1', 'cam': '#e8455a', 'upright': '#f08a3c'}
def depth(m):
    a, b = m[1], m[2]
    return (a[0] + b[0]) / 2 + (a[1] + b[1]) / 2 * -1 + 0
for m in sorted(members, key=lambda m: (m[1][0] + m[2][0] + m[1][1] + m[2][1]) / 2):
    a, b = iso(m[1]), iso(m[2])
    out.append(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="#4b5563" stroke-width="{P*S+2.5:.1f}" stroke-linecap="square"/>')
    out.append(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="{colors[m[0]]}" stroke-width="{P*S:.1f}" stroke-linecap="square"/>')

def label(p, s, dx, dy, color='#3a2a20'):
    x, y = iso(p)
    out.append(f'<line x1="{x:.1f}" y1="{y:.1f}" x2="{x+dx:.1f}" y2="{y+dy:.1f}" stroke="{color}" stroke-width="1.5"/>')
    out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4" fill="{color}"/>')
    T(x + dx + (6 if dx >= 0 else -6), y + dy + 6, s, 18, 700, color, 'start' if dx >= 0 else 'end')
label((600, YM, 1530), '카메라 (렌즈 구멍)', 190, -30, '#e8455a')
label((600, YM, 1180), '터치 디스플레이', -230, -60)
label((600, YM, 915), '프린터 출구', -230, 10)
label((W, 1700, 1200), '입구 (커튼)', 70, 30, '#c46a1e')
label((300, D, 1600), '배경천', -60, 120, '#2f6fdb')
label((0, 1300, 1300), '옆벽 패널', -110, -40)
label((600, 200, H), '앞 장비 모듈 (PC·프린터)', -160, -20)

# 범례
lx, ly = 40, 1000
for i, (k, s) in enumerate([('post', '기둥 1950'), ('xrail', '레일'), ('cam', '카메라 레일'), ('upright', '디스플레이 기둥')]):
    out.append(f'<rect x="{lx + i*170}" y="{ly}" width="26" height="12" fill="{colors[k]}" stroke="#4b5563"/>')
    T(lx + i*170 + 34, ly + 12, s, 16, 600)

# ── 2) 장비 모듈 안쪽 면 (부스 안에서 본 정면)
FX, FY, FS = 990, 150, 0.27
def F(x, z): return FX + x * FS, FY + (H - z) * FS
T(FX, FY - 30, '② 부스 안에서 본 앞면 (장비 모듈 안쪽 면)', 22, 800)
def rect(x0, z0, x1, z1, fill, stroke='#4b5563', sw=1.5, op=1):
    a, b = F(x0, z1), F(x1, z0)
    out.append(f'<rect x="{a[0]:.1f}" y="{a[1]:.1f}" width="{b[0]-a[0]:.1f}" height="{b[1]-a[1]:.1f}" fill="{fill}" fill-opacity="{op}" stroke="{stroke}" stroke-width="{sw}"/>')
rect(0, 0, W, H, '#ffffff')
for x in (0, W - P): rect(x, 0, x + P, H, '#a9b3c1')
for z in (0, Z_SHELF, H - P): rect(P, z, W - P, z + P, '#a9b3c1')
rect(P, Z_CAM, W - P, Z_CAM + P, '#e8455a')
for x in UP_X: rect(x - c, Z_SHELF + P, x + c, Z_CAM, '#f08a3c')
rect(dx0, dz0, dx1, dz1, '#1d1612', op=0.85)
T(*[v for v in F((dx0+dx1)/2, (dz0+dz1)/2 - 10)], '디스플레이', 15, 700, '#ffffff', 'middle')
cx, cz = F(600, 1540)
out.append(f'<circle cx="{cx:.1f}" cy="{cz:.1f}" r="{40*FS+2:.1f}" fill="#e8455a" stroke="#4b5563"/>')
rect(470, 885, 730, 950, '#7a6656')
def dim(z, s):
    x, y = F(W, z)
    out.append(f'<line x1="{x+6:.1f}" y1="{y:.1f}" x2="{x+30:.1f}" y2="{y:.1f}" stroke="#7a6656" stroke-width="1.2"/>')
    T(x + 36, y + 5, s, 15, 600, '#7a6656')
dim(1950, '1950 (높이)')
dim(1540, '≈1540 렌즈 중심')
dim(1435, '1420 카메라 레일')
dim(1180, '1000~1360 디스플레이')
dim(918, '880~950 프린터 출구')
dim(865, '850 선반 레일')
dim(15, '0 바닥 (조절좌 별도)')
x0, y0 = F(0, 0); x1, _ = F(W, 0)
out.append(f'<line x1="{x0:.1f}" y1="{y0+18:.1f}" x2="{x1:.1f}" y2="{y0+18:.1f}" stroke="#7a6656" stroke-width="1.2"/>')
T((x0 + x1) / 2, y0 + 38, '1200', 15, 700, '#7a6656', 'middle')
T(FX, y0 + 62, '주황 기둥은 좌우로, 카메라 레일은 위아래로 밀어서 조절 (T슬롯)', 15, 500, '#7a6656')

# ── 3) 평면도
PX, PY, PS = 990, 850, 0.13
def Pp(x, y): return PX + y * PS, PY + x * PS
T(PX, PY - 40, '③ 위에서 본 평면도', 22, 800)
def prect(x0, y0, x1, y1, fill, stroke='#4b5563', op=1):
    a = Pp(x0, y0); b = Pp(x1, y1)
    out.append(f'<rect x="{a[0]:.1f}" y="{a[1]:.1f}" width="{b[0]-a[0]:.1f}" height="{b[1]-a[1]:.1f}" fill="{fill}" fill-opacity="{op}" stroke="{stroke}" stroke-width="1.5"/>')
prect(0, 0, W, D, '#ffffff')
prect(0, 0, W, YM, '#e9e1d6')
T(*Pp(W / 2 + 60, 30), '장비 모듈', 14, 700)
prect(0, D - 15, W, D, '#bcdcff')
for x in (0, W - P):
    for y in (0, YM - P, D - P): prect(x, y, x + P, y + P, '#8f99a8')
ax, ay = Pp(W, YM + 40); bx, by = Pp(W, D - 40)
out.append(f'<line x1="{ax:.1f}" y1="{ay+4:.1f}" x2="{bx:.1f}" y2="{by+4:.1f}" stroke="#f08a3c" stroke-width="5" stroke-dasharray="10 6"/>')
T((ax + bx) / 2, ay + 26, '입구 (커튼)', 14, 700, '#c46a1e', 'middle')
# 사람 위치 / 카메라 화각
cxp, cyp = Pp(W / 2, YM)
for (x, y) in [(W/2 - 250, 1350), (W/2 + 250, 1350), (W/2, 1550)]:
    px, py = Pp(x, y)
    out.append(f'<circle cx="{px:.1f}" cy="{py:.1f}" r="11" fill="#f08a3c" fill-opacity="0.5"/>')
for xx in (0 + 40, W - 40):
    ex, ey = Pp(xx, 1700)
    out.append(f'<line x1="{cxp:.1f}" y1="{cyp:.1f}" x2="{ex:.1f}" y2="{ey:.1f}" stroke="#e8455a" stroke-width="1.2" stroke-dasharray="4 4"/>')
T(*Pp(W / 2 - 80, 700), '카메라 화각', 13, 600, '#e8455a')
T(*Pp(W / 2 + 120, 1250), '서는 자리', 13, 600, '#c46a1e')
a = Pp(0, 0); b = Pp(0, D)
out.append(f'<line x1="{a[0]:.1f}" y1="{a[1]-14:.1f}" x2="{b[0]:.1f}" y2="{b[1]-14:.1f}" stroke="#7a6656" stroke-width="1.2"/>')
T((a[0] + b[0]) / 2, a[1] - 20, '2000 (깊이)', 14, 700, '#7a6656', 'middle')
T(b[0] + 8, (Pp(0,0)[1] + Pp(W,0)[1]) / 2 - 10, '1200', 14, 700, '#7a6656')
T(b[0] + 8, Pp(W, D)[1] - 4, '배경', 13, 600, '#2f6fdb')

out.append('</svg>')
open('booth-structure.svg', 'w').write('\n'.join(out))
print('ok')
