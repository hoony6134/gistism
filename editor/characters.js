// 캐릭터 그림 → 스티커 만들기 + 사진 칸 주변 자동 배치 (콜라보 네컷 프레임 스타일)

const MAX_SIDE = 700;

// 그림 파일 → 배경을 지우고 여백을 잘라낸 캔버스
export async function makeCharacter(file) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  removeBackground(c);
  return trim(c);
}

// 테두리에서 시작해 배경색과 비슷하게 이어진 부분만 지운다 (캐릭터 안쪽 흰색은 남음)
function removeBackground(c) {
  const { width: w, height: h } = c;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  const n = w * h;

  // 이미 배경이 투명한 PNG면 그대로
  let transparentEdge = 0, edgeCount = 0;
  let br = 0, bg = 0, bb = 0;
  const edge = [];
  for (let x = 0; x < w; x++) edge.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) edge.push(y * w, y * w + w - 1);
  for (const i of edge) {
    const p = i * 4;
    edgeCount++;
    if (px[p + 3] < 200) transparentEdge++;
    br += px[p]; bg += px[p + 1]; bb += px[p + 2];
  }
  if (transparentEdge > edgeCount * 0.5) return;
  br /= edgeCount; bg /= edgeCount; bb /= edgeCount;

  const TOL = 60;
  const dist = (i) => {
    const p = i * 4;
    return Math.abs(px[p] - br) + Math.abs(px[p + 1] - bg) + Math.abs(px[p + 2] - bb);
  };
  const isBg = new Uint8Array(n);
  const stack = new Int32Array(n);
  let top = 0;
  for (const i of edge) {
    if (!isBg[i] && dist(i) < TOL) { isBg[i] = 1; stack[top++] = i; }
  }
  while (top) {
    const i = stack[--top];
    const x = i % w;
    const y = (i - x) / w;
    const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const j of nb) {
      if (j >= 0 && !isBg[j] && dist(j) < TOL) { isBg[j] = 1; stack[top++] = j; }
    }
  }
  for (let i = 0; i < n; i++) {
    if (isBg[i]) { px[i * 4 + 3] = 0; continue; }
    // 배경 바로 옆 픽셀은 배경색에 가까운 만큼 반투명 (가장자리 흰 테두리 줄이기)
    const x = i % w;
    const y = (i - x) / w;
    const touches = (x > 0 && isBg[i - 1]) || (x < w - 1 && isBg[i + 1]) || (y > 0 && isBg[i - w]) || (y < h - 1 && isBg[i + w]);
    if (touches) {
      const d = dist(i);
      if (d < TOL * 2) px[i * 4 + 3] = Math.round(px[i * 4 + 3] * ((d - TOL) / TOL));
    }
  }
  ctx.putImageData(img, 0, 0);
}

function trim(c) {
  const { width: w, height: h } = c;
  const px = c.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > 20) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return c; // 전부 지워졌으면 원본 유지
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

// 칸마다 쓸 자리 4종류. 모두 칸 모서리·가장자리라서 가운데(얼굴 자리)는 가리지 않는다.
//  ax, ay: 칸 기준 캐릭터 '바닥 가운데' 위치 (0~1), 칸 밖으로 조금 나갈 수 있음
const SPOTS = [
  { ax: 0.86, ay: 1.03, size: 0.40 }, // 오른쪽 아래 모서리에 걸터앉기
  { ax: 0.17, ay: 0.20, size: 0.34 }, // 왼쪽 위에서 빼꼼
  { ax: 0.93, ay: 0.62, size: 0.36 }, // 오른쪽 가장자리에 매달리기
  { ax: 0.13, ay: 1.03, size: 0.40 }, // 왼쪽 아래 모서리에 서 있기
];

function rand(seed) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

// 캐릭터 배치 목록 계산. shift를 바꾸면 다른 배치가 나온다.
export function layoutCharacters(template, chars, shift = 0) {
  if (!chars.length) return [];
  const out = [];
  template.slots.forEach((slot, i) => {
    const spot = SPOTS[(i + shift) % SPOTS.length];
    const ch = chars[(i + shift) % chars.length];
    const h = slot.h * spot.size;
    const w = (h * ch.width) / ch.height;
    out.push({
      image: ch,
      x: slot.x + slot.w * spot.ax - w / 2,
      y: slot.y + slot.h * spot.ay - h,
      width: w,
      height: h,
      rotation: (rand(i + shift * 7) - 0.5) * 12,
    });
  });
  // 칸 아래 여백이 넉넉하면 캐릭터 하나를 크게
  const bottom = template.slots.reduce((m, s) => Math.max(m, s.y + s.h), 0);
  const space = template.size[1] - bottom;
  if (space > template.size[1] * 0.1) {
    const ch = chars[(template.slots.length + shift) % chars.length];
    const h = space * 0.8;
    const w = (h * ch.width) / ch.height;
    out.push({ image: ch, x: template.size[0] * 0.78 - w / 2, y: bottom + space * 0.1, width: w, height: h, rotation: 0 });
  }
  return out;
}
