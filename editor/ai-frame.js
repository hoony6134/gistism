// AI가 그린 프레임을 가이드 사진 칸에 맞추기.
// 사진 칸 위치는 항상 가이드(템플릿) 좌표로 고정한다. AI에게는 칸을 마젠타(#FF00FF)로 칠하게 하고
// (밝은 회색으로 칠해도 인식),
//  1) 그림 속 칸 덩어리가 가이드 칸과 겹치는지 확인 → 많이 어긋나면 AI가 잘못 그린 것이므로 거부
//  2) 가이드 칸 안에서 칸 색 픽셀만 투명하게 만든다.
// 칸 가장자리에 걸친 캐릭터는 칸 색이 아니므로 그대로 남아 사진 위에 얹힌다.

const MIN_AREA_RATIO = 0.02; // 전체 면적의 2% 이상인 덩어리만 사진 칸으로 인정
const MAX_SLOTS = 6;

// 마젠타 정도 (0 = 아님, 1 = 완전 마젠타)
function magentaScore(r, g, b) {
  const lo = Math.min(r, b);
  if (lo < 120) return 0;
  const gap = lo - g; // 빨강·파랑은 높고 초록만 낮을수록 마젠타
  if (gap <= 40) return 0;
  return Math.min(1, (gap - 40) / 120);
}

// 밝은 회색 단색 칸 (채도가 거의 없고 너무 밝거나 어둡지 않음)
function grayScore(r, g, b) {
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  const avg = (r + g + b) / 3;
  if (hi - lo > 14 || avg < 150 || avg > 232) return 0;
  return 1;
}

const MIN_IOU = 0.7; // 가이드 칸과 그림 속 칸이 이만큼 겹쳐야 통과

function iou(a, b) {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return inter / (a.w * a.h + b.w * b.h - inter);
}

// 결과: { status: 'ok', fitted? } | { status: 'mismatch' } | { status: 'none' }
// 칸이 조금 어긋났으면(크기·위치가 전체적으로 밀림) 그림 전체를 늘이고 옮겨서 가이드 칸에 맞춘 뒤 다시 처리한다
export function keyToGuide(canvas, guideSlots) {
  for (const [score, despill] of [[magentaScore, true], [grayScore, false]]) {
    const r = keyWith(canvas, score, despill, guideSlots);
    if (!r) continue;
    if (r.status === 'mismatch' && fitToGuide(canvas, r.boxes, guideSlots)) {
      const again = keyWith(canvas, score, despill, guideSlots);
      if (again && again.status === 'ok') return { status: 'ok', fitted: true };
    }
    return { status: r.status };
  }
  return { status: 'none' };
}

const MAX_STRETCH = 0.25; // 가로·세로 각각 ±25%까지만 늘이고 줄인다 (캐릭터가 너무 찌그러지지 않게)

function union(list) {
  const x0 = Math.min(...list.map((b) => b.x));
  const y0 = Math.min(...list.map((b) => b.y));
  const x1 = Math.max(...list.map((b) => b.x + b.w));
  const y1 = Math.max(...list.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// 그림 속 칸 묶음(가장 큰 덩어리들)의 바깥 상자를 가이드 칸 묶음의 바깥 상자에 맞춘다
function fitToGuide(canvas, boxes, guide) {
  if (boxes.length < guide.length) return false;
  const found = boxes.slice(0, guide.length);
  const u = union(found);
  const g = union(guide);
  const sx = g.w / u.w;
  const sy = g.h / u.h;
  if (Math.abs(sx - 1) > MAX_STRETCH || Math.abs(sy - 1) > MAX_STRETCH) return false;
  const moved = found.map((b) => ({ x: g.x + (b.x - u.x) * sx, y: g.y + (b.y - u.y) * sy, w: b.w * sx, h: b.h * sy }));
  if (!guide.every((gs) => moved.some((b) => iou(gs, b) >= MIN_IOU))) return false;

  const { width: w, height: h } = canvas;
  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  src.getContext('2d').drawImage(canvas, 0, 0);
  const ctx = canvas.getContext('2d');
  // 줄일 때 드러나는 가장자리는 원래 그림 가장자리 색으로 채운다
  const d = ctx.getImageData(0, 0, w, h).data;
  let r = 0, gg = 0, b = 0, cnt = 0;
  for (let x = 0; x < w; x += 4) for (const y of [0, h - 1]) { const p = (y * w + x) * 4; r += d[p]; gg += d[p + 1]; b += d[p + 2]; cnt++; }
  for (let y = 0; y < h; y += 4) for (const x of [0, w - 1]) { const p = (y * w + x) * 4; r += d[p]; gg += d[p + 1]; b += d[p + 2]; cnt++; }
  ctx.fillStyle = `rgb(${r / cnt | 0},${gg / cnt | 0},${b / cnt | 0})`;
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, g.x - u.x * sx, g.y - u.y * sy, w * sx, h * sy);
  return true;
}

function keyWith(canvas, score, despill, guide) {
  const { width: w, height: h } = canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  const n = w * h;

  // 1) 확실한 칸 색 픽셀 표시
  const core = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (score(px[p], px[p + 1], px[p + 2]) >= 0.6) core[i] = 1;
  }

  // 2) 연결된 덩어리 찾기 (4방향)
  const label = new Int32Array(n);
  const stack = new Int32Array(n);
  const regions = [];
  let next = 1;
  for (let start = 0; start < n; start++) {
    if (!core[start] || label[start]) continue;
    let top = 0;
    stack[top++] = start;
    label[start] = next;
    let area = 0;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    while (top) {
      const i = stack[--top];
      area++;
      const x = i % w;
      const y = (i - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && core[i - 1] && !label[i - 1]) { label[i - 1] = next; stack[top++] = i - 1; }
      if (x < w - 1 && core[i + 1] && !label[i + 1]) { label[i + 1] = next; stack[top++] = i + 1; }
      if (y > 0 && core[i - w] && !label[i - w]) { label[i - w] = next; stack[top++] = i - w; }
      if (y < h - 1 && core[i + w] && !label[i + w]) { label[i + w] = next; stack[top++] = i + w; }
    }
    regions.push({ id: next, area, x0, y0, x1, y1 });
    next++;
  }

  const big = regions
    .filter((r) => r.area >= n * MIN_AREA_RATIO)
    .sort((a, b) => b.area - a.area)
    .slice(0, MAX_SLOTS);
  if (big.length < 2) return null; // 이 색의 칸이 없음

  // 가이드 칸마다 가장 잘 겹치는 덩어리를 찾는다. 하나라도 어긋나면 AI가 칸을 잘못 그린 것
  const boxes = big.map((r) => ({ x: r.x0, y: r.y0, w: r.x1 - r.x0 + 1, h: r.y1 - r.y0 + 1 }));
  const ok = guide.every((g) => boxes.some((b) => iou(g, b) >= MIN_IOU));
  if (!ok) return { status: 'mismatch', boxes };

  // 가이드 칸 안의 픽셀만 다룬다
  const inGuide = new Uint8Array(n);
  for (const g of guide) {
    for (let y = Math.max(0, g.y); y < Math.min(h, g.y + g.h); y++) {
      for (let x = Math.max(0, g.x); x < Math.min(w, g.x + g.w); x++) inGuide[y * w + x] = 1;
    }
  }

  // 3) 선택된 덩어리만 투명하게. 가장자리 2px은 마젠타 정도만큼 반투명 + 분홍기 제거
  const keep = new Uint8Array(next);
  big.forEach((r) => { keep[r.id] = 1; });
  const inRegion = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (keep[label[i]] && inGuide[i]) inRegion[i] = 1;

  // JPEG 잡티 정리: 각 칸의 평균색을 구하고, 칸 사각형 안에서 그 색과 비슷한 픽셀도 칸으로 친다
  for (const r of big) {
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
        if (inRegion[i] || !inGuide[i]) continue;
        const p = i * 4;
        const d = Math.abs(px[p] - mr) + Math.abs(px[p + 1] - mg) + Math.abs(px[p + 2] - mb);
        if (d < 45) inRegion[i] = 1;
      }
    }
  }

  const near = new Uint8Array(n); // 덩어리에서 2px 이내
  for (let i = 0; i < n; i++) {
    if (!inRegion[i]) continue;
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
    if (inRegion[i]) { px[p + 3] = 0; continue; }
    if (!near[i] || !despill || !inGuide[i]) continue;
    const s = score(px[p], px[p + 1], px[p + 2]);
    if (s <= 0) continue;
    px[p + 3] = Math.round(px[p + 3] * (1 - s));
    const cap = px[p + 1] + 20; // 빨강·파랑을 초록 수준으로 눌러 분홍 테두리 제거
    px[p] = Math.min(px[p], cap);
    px[p + 2] = Math.min(px[p + 2], cap);
  }
  ctx.putImageData(img, 0, 0);

  return { status: 'ok' };
}
