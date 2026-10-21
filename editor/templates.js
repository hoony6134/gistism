// 기본 템플릿 6종. 사진 칸 위치는 부스로 그대로 넘어간다.
const STRIP_SIZE = [600, 1800];
const STRIP_SLOTS = [60, 444, 828, 1212].map((y) => ({ x: 30, y, w: 540, h: 360 }));
const GRID_SIZE = [1200, 1800];
const GRID_SLOTS = [
  { x: 50, y: 60, w: 535, h: 740 }, { x: 615, y: 60, w: 535, h: 740 },
  { x: 50, y: 830, w: 535, h: 740 }, { x: 615, y: 830, w: 535, h: 740 },
];

function stars(ctx, w, h) {
  ctx.fillStyle = 'rgba(255, 230, 150, 0.85)';
  for (let i = 0; i < 70; i++) {
    const x = (Math.sin(i * 12.9898) * 43758.5453 % 1 + 1) % 1 * w;
    const y = (Math.sin(i * 78.233) * 12345.678 % 1 + 1) % 1 * h;
    ctx.beginPath();
    ctx.arc(x, y, 2 + (i % 4), 0, Math.PI * 2);
    ctx.fill();
  }
}
function checker(ctx, w, h) {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  const s = 50;
  for (let y = 0; y < h; y += s) for (let x = (y / s) % 2 ? s : 0; x < w; x += s * 2) ctx.fillRect(x, y, s, s);
}
function dots(ctx, w, h) {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  for (let y = 20; y < h; y += 60) {
    for (let x = (y / 60) % 2 ? 50 : 20; x < w; x += 60) {
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
    }
  }
}
function stripes(ctx, w, h) {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 22;
  for (let x = -h; x < w; x += 70) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + h, h); ctx.stroke();
  }
}

// 콜라보 스타일 스트립: 위쪽에 작은 제목, 칸마다 얇은 테두리(칸 모양을 따라 저장할 때 그림) (캐릭터 자동 배치용)
const COLLAB_SLOTS = [130, 498, 866, 1234].map((y) => ({ x: 36, y, w: 528, h: 352 }));
const collab = (id, name, color) => ({
  id, name, size: STRIP_SIZE, slots: COLLAB_SLOTS, color,
  title: '우리 캐릭터', titleTop: true, outline: 'rgba(60, 50, 40, 0.35)',
});

export const TEMPLATES = [
  collab('collab-gray', '콜라보 그레이', '#d8d2ca'),
  collab('collab-cream', '콜라보 크림', '#f6efdc'),
  collab('collab-white', '콜라보 화이트', '#ffffff'),
  collab('collab-pink', '콜라보 핑크', '#f7d9d9'),
  { id: 'cream', name: '크림 스트립', size: STRIP_SIZE, slots: STRIP_SLOTS, color: '#fff4e0', title: '우리만의 네컷' },
  { id: 'night', name: '밤하늘 스트립', size: STRIP_SIZE, slots: STRIP_SLOTS, color: '#1f2a44', pattern: stars, title: '오늘의 우리' },
  { id: 'check', name: '체크 스트립', size: STRIP_SIZE, slots: STRIP_SLOTS, color: '#ffc8d6', pattern: checker, title: '찰칵 ♡' },
  { id: 'dots', name: '도트 스트립', size: STRIP_SIZE, slots: STRIP_SLOTS, color: '#ffe680', pattern: dots, title: 'HAPPY DAY' },
  { id: 'grid-white', name: '2×2 화이트', size: GRID_SIZE, slots: GRID_SLOTS, color: '#ffffff', title: '우리만의 네컷' },
  { id: 'grid-mint', name: '2×2 민트', size: GRID_SIZE, slots: GRID_SLOTS, color: '#bfeadb', pattern: stripes, title: '함께라서 좋은 날' },
];

// AI가 그린 그림을 배경으로 쓰는 2×2 템플릿. image는 올릴 때 채운다.
export const AI_TEMPLATE = { id: 'ai', name: 'AI 프레임', size: GRID_SIZE, slots: GRID_SLOTS, color: '#ffffff', title: '', image: null };

export const BG_COLORS = ['#ffffff', '#fff4e0', '#ffe680', '#ffc8d6', '#e6d4ff', '#bfeadb', '#bcdcff', '#1f2a44', '#3a2a20', '#111111'];

export function isDark(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
}

export function drawBackground(canvas, template, color) {
  const [w, h] = template.size;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  // 칸이 이미 투명하게 뚫린 AI 그림(keyed)은 바탕을 칠하지 않는다
  if (!template.keyed) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
  }
  if (template.image) ctx.drawImage(template.image, 0, 0, w, h);
  template.pattern?.(ctx, w, h);
  return canvas;
}
