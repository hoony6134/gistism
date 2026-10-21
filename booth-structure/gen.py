# 포토부스 알루미늄 프로파일(3030) 구조 도면 생성기
import math
P = 30  # 프로파일 단면 30x30
W, D, H = 1200, 2000, 1950
YM = 400            # 앞 장비 모듈 깊이 (안쪽 면 y=400)
Z_SHELF = 850       # 프린터 선반 레일 (850~880)
Z_CAM = 1420        # 카메라 레일 (1420~1450)
UP_X = (450, 750)   # 디스플레이 기둥 x 위치 (좌우로 이동 가능)

# 부재: (이름, 시작(x,y,z), 끝(x,y,z)) 중심선, 단면 30
c = P / 2
xs, xe = c, W - c
members = []
def add(name, a, b): members.append((name, a, b))
# 기둥 6
for x in (c, W - c):
    for y in (c, YM - c, D - c):
        add('post', (x, y, 0), (x, y, H))
# 가로(X) 레일
for y in (c, YM - c, D - c):
    add('xrail', (P, y, H - c), (W - P, y, H - c))   # 상단
    add('xrail', (P, y, c), (W - P, y, c))           # 하단
for y in (c, YM - c):
    add('xrail', (P, y, Z_SHELF + c), (W - P, y, Z_SHELF + c))  # 선반
add('cam', (P, YM - c, Z_CAM + c), (W - P, YM - c, Z_CAM + c))  # 카메라 레일
# 세로(Y) 레일
for x in (c, W - c):
    for z in (H - c, c, Z_SHELF + c):
        add('yrail', (x, P, z), (x, YM - P, z))     # 앞 모듈 340
    add('yrail', (x, YM, H - c), (x, D - P, H - c))  # 부스 상단 1570
add('yrail', (c, YM, c), (c, D - P, c))             # 부스 하단 (입구 반대쪽만)
# 옆벽 샛기둥 (왼쪽 벽 패널 이음매 받침)
add('stud', (c, 1200, P), (c, 1200, H - P))
# 디스플레이 기둥 2
for x in UP_X:
    add('upright', (x, YM - c, Z_SHELF + P), (x, YM - c, Z_CAM))

def length(m):
    a, b = m[1], m[2]
    return round(math.dist(a, b))

if __name__ == '__main__':
    from collections import Counter
    cnt = Counter((m[0], length(m)) for m in members)
    total = 0
    for (n, l), k in sorted(cnt.items(), key=lambda t: -t[0][1]):
        print(n, l, k); total += l * k
    print('total mm', total, 'members', len(members))
