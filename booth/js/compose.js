// 사진 + 프레임 합성.
// 인쇄 한 장은 1200×1800px(4×6인치, 300dpi).
// layout "strip": 600×1800 스트립을 좌우로 두 번 찍는다 (재단하면 2명이 한 장씩).
// layout "sheet": 1200×1800 한 장을 그대로 쓴다.

export const SHEET_W = 1200;
export const SHEET_H = 1800;

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 불러오지 못했어요: ' + src));
    img.src = src;
  });
}

// 사진 하나: { source, w, h, mirror? }. source는 canvas / video / img.
export function drawCover(ctx, photo, x, y, w, h) {
  const scale = Math.max(w / photo.w, h / photo.h);
  const sw = w / scale;
  const sh = h / scale;
  // ox, oy: 원본 안에서 쓸 영역의 시작점 (카메라 가장자리 자르기)
  const sx = (photo.ox || 0) + (photo.w - sw) / 2;
  const sy = (photo.oy || 0) + (photo.h - sh) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  if (photo.filter) ctx.filter = photo.filter; // 실시간 카메라에만 색감 보정 (찍은 사진은 이미 보정됨)
  if (photo.mirror) {
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(photo.source, sx, sy, sw, sh, 0, 0, w, h);
  } else {
    ctx.drawImage(photo.source, sx, sy, sw, sh, x, y, w, h);
  }
  ctx.restore();
}

// 사진이 아직 없는 칸에 그리는 사람 실루엣.
export function drawPlaceholder(ctx, x, y, w, h, index = 0) {
  const tints = ['#e9e1d6', '#e2e6e9', '#e8e2ea', '#e3e9e1'];
  ctx.save();
  ctx.fillStyle = tints[index % tints.length];
  ctx.fillRect(x, y, w, h);
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = 'rgba(80, 64, 52, 0.18)';
  const cx = x + w / 2;
  const r = Math.min(w, h) * 0.17;
  ctx.beginPath();
  ctx.arc(cx, y + h * 0.42, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, y + h * 0.42 + r * 3.1, r * 2.1, r * 1.9, 0, Math.PI, 0);
  ctx.fill();
  ctx.restore();
}

// 프레임 하나(스트립 또는 시트)를 (ox, oy)에 그린다.
// photos[i]가 없으면 실루엣, photos[i] === 'empty'면 배경만.
export function drawFrame(ctx, frame, photos, ox = 0, oy = 0) {
  const [fw, fh] = frame.size;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.fillStyle = frame.background || '#ffffff';
  ctx.fillRect(0, 0, fw, fh);
  frame.slots.forEach((s, i) => {
    const p = photos[i];
    if (p && p !== 'empty') drawCover(ctx, p, s.x, s.y, s.w, s.h);
    else if (!p) drawPlaceholder(ctx, s.x, s.y, s.w, s.h, i);
  });
  if (frame.overlayImg) ctx.drawImage(frame.overlayImg, 0, 0, fw, fh);
  ctx.restore();
}

// 프레임 하나만 미리보기용 캔버스에 그린다 (캔버스 크기는 호출 쪽에서 정함).
export function renderFramePreview(canvas, frame, photos) {
  const ctx = canvas.getContext('2d');
  const [fw, fh] = frame.size;
  ctx.save();
  ctx.setTransform(canvas.width / fw, 0, 0, canvas.height / fh, 0, 0);
  drawFrame(ctx, frame, photos);
  ctx.restore();
}

// 인쇄용 1200×1800 한 장을 만든다.
export function composeSheet(frame, photos, canvas = document.createElement('canvas')) {
  canvas.width = SHEET_W;
  canvas.height = SHEET_H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SHEET_W, SHEET_H);
  if (frame.layout === 'strip') {
    const half = SHEET_W / 2;
    for (const ox of [0, half]) {
      ctx.save();
      ctx.translate(ox, 0);
      ctx.scale(half / frame.size[0], SHEET_H / frame.size[1]);
      drawFrame(ctx, frame, photos);
      ctx.restore();
    }
  } else {
    ctx.save();
    ctx.scale(SHEET_W / frame.size[0], SHEET_H / frame.size[1]);
    drawFrame(ctx, frame, photos);
    ctx.restore();
  }
  return canvas;
}

// 다운로드용: 스트립이면 한 줄만, 시트면 전체.
export function composeSingle(frame, photos) {
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = frame.size;
  drawFrame(canvas.getContext('2d'), frame, photos);
  return canvas;
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.95) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지 변환 실패'))), type, quality);
  });
}
