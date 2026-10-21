// 프레임 불러오기.
//  - 이미지 프레임: frames/normal/*.jpg|png (일반), frames/character/*.jpg|png (캐릭터)
//    사진 칸은 투명(PNG) 또는 마젠타 #FF00FF(JPG)로 비워 두면 자동으로 찾는다.
//  - 폴더 프레임(예전 방식): frames/<폴더>/frame.json + 오버레이 이미지
import { loadImage } from './compose.js';
import { keySlots } from './keying.js';

export const FRAME_TYPES = { normal: '일반', character: '캐릭터' };

function validate(frame, where) {
  if (!Array.isArray(frame.size) || frame.size.length !== 2) throw new Error(`${where}: size가 없어요`);
  if (!Array.isArray(frame.slots) || frame.slots.length === 0) throw new Error(`${where}: slots가 없어요`);
  if (!['strip', 'sheet'].includes(frame.layout)) throw new Error(`${where}: layout은 strip 또는 sheet`);
}

const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

// "01_지냥이네컷.jpg" → "지냥이네컷" (앞의 순서 번호와 확장자는 이름에서 뺀다)
const displayName = (file) => file.replace(/\.[^.]+$/, '').replace(/^\d+[\s._-]+/, '') || file;

async function frameFromImage({ path, type }, order) {
  const img = await loadImage('/frames/' + encodePath(path));
  const ratio = img.naturalWidth / img.naturalHeight;
  if (ratio > 1) throw new Error('세로 방향 이미지만 쓸 수 있어요 (가로가 더 김)');
  // 1:3 가까우면 스트립(한 장에 2줄 인쇄), 아니면 2:3 한 장
  const layout = ratio < 0.45 ? 'strip' : 'sheet';
  const size = layout === 'strip' ? [600, 1800] : [1200, 1800];
  const warn = Math.abs(ratio - size[0] / size[1]) > 0.02
    ? `비율이 ${layout === 'strip' ? '1:3' : '2:3'}이 아니라 늘려서 맞췄어요`
    : '';
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = size;
  canvas.getContext('2d').drawImage(img, 0, 0, size[0], size[1]);
  const slots = keySlots(canvas);
  if (!slots.length) throw new Error('사진 칸을 찾지 못했어요 (투명 또는 #FF00FF로 칠해 주세요)');
  const file = path.split('/').pop();
  return {
    frame: {
      id: 'img:' + path,
      name: displayName(file),
      type,
      layout,
      size,
      background: '#ffffff',
      overlayImg: canvas,
      slots,
      order,
    },
    warn: warn && `${file}: ${warn}`,
  };
}

export async function loadLocalFrames() {
  const list = await (await fetch('/api/frames')).json();
  const frames = [];
  const errors = [];

  for (const [i, item] of (list.images || []).entries()) {
    try {
      const { frame, warn } = await frameFromImage(item, i);
      frames.push(frame);
      if (warn) errors.push(warn);
    } catch (e) {
      errors.push(`${item.path}: ${e.message}`);
    }
  }

  for (const id of list.folders || []) {
    const base = `/frames/${encodeURIComponent(id)}/`;
    try {
      const frame = await (await fetch(base + 'frame.json')).json();
      validate(frame, id);
      frame.id = id;
      frame.type = frame.type === 'character' ? 'character' : 'normal';
      frame.order = 1000 + (frame.order ?? 99);
      frame.overlayImg = frame.overlay ? await loadImage(base + frame.overlay) : null;
      frames.push(frame);
    } catch (e) {
      errors.push(`${id}: ${e.message}`);
    }
  }
  frames.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return { frames, errors };
}

// Supabase custom_frames 행 → 프레임 객체 (폰에서 만든 프레임은 일반 프레임으로 취급)
export async function frameFromCloudRow(row) {
  const size = row.size || [600, 1800];
  const frame = {
    id: 'custom-' + row.code,
    name: `내 프레임 ${row.code}`,
    type: 'normal',
    layout: size[0] >= 1200 ? 'sheet' : 'strip',
    size,
    background: '#ffffff',
    slots: row.slots,
    custom: true,
    code: row.code,
  };
  validate(frame, row.code);
  frame.overlayImg = await loadImage(row.overlay_url);
  return frame;
}
