// 프레임 이미지(JPG/PNG)에서 사진 칸 찾기.
// 사진 칸 = 투명한 부분(PNG) 또는 마젠타 #FF00FF로 칠한 부분(JPG).
// 찾은 칸은 투명하게 뚫고, 칸 위에 걸친 캐릭터·글자(칸 색이 아닌 픽셀)는 그대로 남긴다.

const MIN_AREA_RATIO = 0.01; // 전체 면적의 1% 이상인 덩어리만 사진 칸으로 인정
const MAX_SLOTS = 10;

// 마젠타 정도 (0 = 아님, 1 = 완전 마젠타). JPG 압축으로 색이 조금 번져도 잡힌다
function magentaScore(r, g, b) {
  const lo = Math.min(r, b);
  if (lo < 120) return 0;
  const gap = lo - g;
  if (gap <= 40) return 0;
  return Math.min(1, (gap - 40) / 120);
}

// canvas를 직접 고친다(칸을 투명하게). 결과: 사진 칸 목록 (위→아래, 왼쪽→오른쪽 순서)
export function keySlots(canvas) {
  const { width: w, height: h } = canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  const n = w * h;

  // 1) 칸 색 픽셀 표시 (1 = 투명, 2 = 마젠타)
  const kind = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (px[p + 3] < 128) kind[i] = 1;
    else if (magentaScore(px[p], px[p + 1], px[p + 2]) >= 0.6) kind[i] = 2;
  }

  // 2) 연결된 덩어리 찾기 (4방향)
  const label = new Int32Array(n);
  const stack = new Int32Array(n);
  const regions = [];
  let next = 1;
  for (let start = 0; start < n; start++) {
    if (!kind[start] || label[start]) continue;
    let top = 0;
    stack[top++] = start;
    label[start] = next;
    let area = 0;
    let magenta = 0;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    while (top) {
      const i = stack[--top];
      area++;
      if (kind[i] === 2) magenta++;
      const x = i % w;
      const y = (i - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && kind[i - 1] && !label[i - 1]) { label[i - 1] = next; stack[top++] = i - 1; }
      if (x < w - 1 && kind[i + 1] && !label[i + 1]) { label[i + 1] = next; stack[top++] = i + 1; }
      if (y > 0 && kind[i - w] && !label[i - w]) { label[i - w] = next; stack[top++] = i - w; }
      if (y < h - 1 && kind[i + w] && !label[i + w]) { label[i + w] = next; stack[top++] = i + w; }
    }
    regions.push({ id: next, area, magenta: magenta > area / 2, x0, y0, x1, y1 });
    next++;
  }

  const big = regions
    .filter((r) => r.area >= n * MIN_AREA_RATIO)
    .sort((a, b) => b.area - a.area)
    .slice(0, MAX_SLOTS);
  if (!big.length) return [];

  const keep = new Uint8Array(next);
  big.forEach((r) => { keep[r.id] = 1; });
  const hole = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (keep[label[i]]) hole[i] = 1;

  // 3) JPG 잡티 정리: 마젠타 칸 사각형 안에서 칸 평균색과 비슷한 픽셀도 칸으로 친다
  for (const r of big) {
    if (!r.magenta) continue;
    let sr = 0, sg = 0, sb = 0, cnt = 0;
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const i = y * w + x;
        if (label[i] !== r.id) continue;
        const p = i * 4;
        sr += px[p]; sg += px[p + 1]; sb += px[p + 2]; cnt++;
      }
    }
    const mr = sr / cnt, mg = sg / cnt, mb = sb / cnt;
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const i = y * w + x;
        if (hole[i]) continue;
        const p = i * 4;
        const d = Math.abs(px[p] - mr) + Math.abs(px[p + 1] - mg) + Math.abs(px[p + 2] - mb);
        if (d < 45) hole[i] = 1;
      }
    }
  }

  // 4) 칸을 투명하게. 마젠타 칸 가장자리 2px은 마젠타 정도만큼 반투명 + 분홍기 제거
  const near = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!hole[i]) continue;
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -2; dy <= 2; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < w) near[yy * w + xx] = 1;
      }
    }
  }
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (hole[i]) { px[p + 3] = 0; continue; }
    if (!near[i]) continue;
    const s = magentaScore(px[p], px[p + 1], px[p + 2]);
    if (s <= 0) continue;
    px[p + 3] = Math.round(px[p + 3] * (1 - s));
    const cap = px[p + 1] + 20;
    px[p] = Math.min(px[p], cap);
    px[p + 2] = Math.min(px[p + 2], cap);
  }
  ctx.putImageData(img, 0, 0);

  // 5) 칸 = 덩어리를 감싸는 사각형. 줄(위→아래) 단위로 묶고 줄 안에서 왼쪽→오른쪽
  const slots = big.map((r) => ({ x: r.x0, y: r.y0, w: r.x1 - r.x0 + 1, h: r.y1 - r.y0 + 1 }));
  slots.sort((a, b) => a.y - b.y);
  const rows = [];
  for (const s of slots) {
    const row = rows.find((rw) => Math.abs(rw[0].y + rw[0].h / 2 - (s.y + s.h / 2)) < Math.min(rw[0].h, s.h) / 2);
    if (row) row.push(s);
    else rows.push([s]);
  }
  return rows.flatMap((rw) => rw.sort((a, b) => a.x - b.x));
}
