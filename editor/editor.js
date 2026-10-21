import { TEMPLATES, AI_TEMPLATE, BG_COLORS, isDark, drawBackground } from './templates.js';
import { keyToGuide } from './ai-frame.js';
import { makeCharacter, layoutCharacters } from './characters.js';

const C = window.EDITOR_CONFIG;
const $ = (sel) => document.querySelector(sel);
const EMOJIS = ['🐱', '😺', '😻', '🐾', '🐈', '🐈‍⬛', '💛', '🧡', '❤️', '💕', '⭐', '✨',
  '🌟', '🎓', '📚', '✏️', '💯', '🅰️', '🎉', '🎀', '🌸', '🌈', '☁️', '🍀',
  '🔥', '👑', '😎', '🥳', '😆', '🫶', '👍', '📸', '🍰', '☕', '🎵', '💌'];
const TEXT_COLORS = ['#3a2a20', '#ffffff', '#111111', '#f08a3c', '#e8455a', '#2f6fdb', '#1d8a5b', '#ffd36b'];
const FONT = 'Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

let template = null;
let bgColor = '#ffffff';
let stage, bgLayer, bgImage, contentLayer, slotLayer, transformer;
let selected = null;
let slotShape = 'rect'; // 사진 칸 모양: rect(사각) / round(둥근) / cloud(구름)

// 사진 칸 모양 경로. 모양은 항상 칸 사각형 안에 들어가므로, 부스가 사각 사진을 깔면 모양대로 보인다.
function slotPath(ctx, s, shape) {
  const { x, y, w, h } = s;
  if (shape === 'round') {
    const r = Math.min(w, h) * 0.14;
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    return;
  }
  if (shape === 'cloud') {
    // 안쪽 사각형 가장자리를 따라 바깥으로 볼록한 물결을 이어 붙인다
    const r = Math.min(w, h) * 0.05;
    const L = x + r, T = y + r, R = x + w - r, B = y + h - r;
    const bumps = (len) => Math.max(3, Math.round(len / (r * 5)));
    const side = (x0, y0, x1, y1, ox, oy) => {
      const n = bumps(Math.hypot(x1 - x0, y1 - y0));
      for (let k = 0; k < n; k++) {
        const ax = x0 + ((x1 - x0) * k) / n, ay = y0 + ((y1 - y0) * k) / n;
        const bx = x0 + ((x1 - x0) * (k + 1)) / n, by = y0 + ((y1 - y0) * (k + 1)) / n;
        ctx.quadraticCurveTo((ax + bx) / 2 + ox * 2 * r, (ay + by) / 2 + oy * 2 * r, bx, by);
      }
    };
    ctx.moveTo(L, T);
    side(L, T, R, T, 0, -1);
    side(R, T, R, B, 1, 0);
    side(R, B, L, B, 0, 1);
    side(L, B, L, T, -1, 0);
    ctx.closePath();
    return;
  }
  ctx.rect(x, y, w, h);
}

function drawSlots() {
  slotLayer.destroyChildren();
  const t = template;
  t.slots.forEach((s, i) => {
    slotLayer.add(new Konva.Shape({
      sceneFunc: (con, shape) => { con.beginPath(); slotPath(con, s, t.keyed ? 'rect' : slotShape); con.fillStrokeShape(shape); },
      fill: t.keyed ? '#b5aca3' : 'rgba(90, 80, 70, 0.45)', stroke: '#fff', strokeWidth: 4, dash: [16, 10],
    }));
    slotLayer.add(new Konva.Text({ x: s.x, y: s.y + s.h / 2 - 24, width: s.w, align: 'center', text: `사진 ${i + 1}`, fontSize: 44, fontStyle: 'bold', fontFamily: FONT, fill: '#fff' }));
  });
  slotLayer.batchDraw();
}
let textColor = TEXT_COLORS[0];

function toast(msg, ms = 3000) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, ms);
}

function showStep(id) {
  document.querySelectorAll('.step').forEach((s) => s.classList.toggle('active', s.id === id));
}

// ───────── 1. 템플릿 ─────────
function renderTemplates() {
  const grid = $('#template-grid');
  grid.innerHTML = '';
  for (const t of TEMPLATES) {
    const btn = document.createElement('button');
    const c = drawBackground(document.createElement('canvas'), t, t.color);
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(120, 110, 100, 0.35)';
    t.slots.forEach((s) => ctx.fillRect(s.x, s.y, s.w, s.h));
    if (t.outline) {
      ctx.strokeStyle = t.outline;
      ctx.lineWidth = 4;
      t.slots.forEach((s) => ctx.strokeRect(s.x, s.y, s.w, s.h));
    }
    ctx.fillStyle = isDark(t.color) ? '#fff' : '#3a2a20';
    ctx.font = `800 ${t.size[0] / 10}px ${FONT}`;
    ctx.textAlign = 'center';
    if (t.titleTop) {
      ctx.font = `800 ${t.size[0] / 14}px ${FONT}`;
      ctx.fillText(t.title, t.size[0] / 2, 85);
    } else {
      ctx.fillText(t.title, t.size[0] / 2, t.size[1] - t.size[1] * 0.07);
    }
    btn.append(c, t.name);
    btn.addEventListener('click', () => startEditing(t));
    grid.append(btn);
  }
}

// ───────── 2. 꾸미기 ─────────
function fitStage() {
  const wrap = $('#stage-wrap');
  const [w, h] = template.size;
  const s = Math.min((wrap.clientWidth - 8) / w, (wrap.clientHeight - 8) / h);
  stage.size({ width: Math.floor(w * s), height: Math.floor(h * s) });
  stage.scale({ x: s, y: s });
}

function startEditing(t) {
  template = t;
  bgColor = t.color;
  showStep('step-edit');
  stage?.destroy();
  stage = new Konva.Stage({ container: 'stage', width: 10, height: 10 });
  bgLayer = new Konva.Layer({ listening: true });
  contentLayer = new Konva.Layer();
  slotLayer = new Konva.Layer({ listening: false });
  // 사진 칸 표시는 배경 바로 위, 꾸밈은 그 위 (스티커를 사진 칸 위에 올려도 보이게)
  // 칸이 뚫린 AI 그림은 칸 표시를 그림 '아래'에 둬서, 칸에 걸친 캐릭터가 보이게 한다
  if (t.keyed) stage.add(slotLayer, bgLayer, contentLayer);
  else stage.add(bgLayer, slotLayer, contentLayer);

  bgImage = new Konva.Image({ image: drawBackground(document.createElement('canvas'), t, bgColor), x: 0, y: 0 });
  bgLayer.add(bgImage);

  slotShape = t.shape || 'rect';
  drawSlots();

  transformer = new Konva.Transformer({
    rotateEnabled: true,
    keepRatio: true,
    enabledAnchors: ['top-right', 'bottom-left', 'bottom-right'], // 왼쪽 위는 삭제 버튼 자리
    anchorSize: 22,
    anchorCornerRadius: 11,
    borderStroke: '#f08a3c',
    anchorStroke: '#f08a3c',
    rotateAnchorOffset: 36,
  });
  contentLayer.add(transformer);

  // 템플릿 기본 문구 (AI 프레임은 그림에 이미 꾸밈이 있으니 생략)
  const bottom = t.slots.reduce((m, s) => Math.max(m, s.y + s.h), 0);
  const titleColor = isDark(t.color) ? '#ffffff' : '#3a2a20';
  if (t.titleTop) addText(t.title, titleColor, t.slots[0].y / 2, t.size[0] / 14);
  else if (t.title) addText(t.title, titleColor, bottom + (t.size[1] - bottom) / 2);
  if (characters.length) placeCharacters();
  // AI 그림에는 배경색 바꾸기가 의미 없으므로 숨김
  document.querySelector('[data-sheet="sheet-bg"]').hidden = Boolean(t.image);

  stage.on('click tap', (e) => {
    if (e.target === stage || e.target === bgImage) select(null);
    else {
      let node = e.target;
      while (node.getParent() !== contentLayer) node = node.getParent();
      if (node !== transformer) select(node);
    }
  });

  fitStage();
  select(null);
}

window.addEventListener('resize', () => {
  if (stage && $('#step-edit').classList.contains('active')) { fitStage(); placeDeleteButton(); }
});

function select(node) {
  selected = node;
  transformer.nodes(node ? [node] : []);
  if (node) node.moveToTop(), transformer.moveToTop();
  $('#text-tool').lastChild.textContent = isTextNode(node) ? '글자 수정' : '글자';
  placeDeleteButton();
}

// 스티커(이모지)도 Konva.Text라서 이름표로 구분한다
const isTextNode = (node) => node instanceof Konva.Text && node.name() !== 'sticker';

// 선택한 요소의 왼쪽 위 모서리에 삭제 버튼을 띄운다
function placeDeleteButton() {
  const btn = $('#item-delete');
  if (!selected) { btn.hidden = true; return; }
  const r = selected.getClientRect();
  const stageBox = stage.container().getBoundingClientRect();
  const wrapBox = $('#stage-wrap').getBoundingClientRect();
  const x = Math.min(Math.max(stageBox.left - wrapBox.left + r.x, 18), wrapBox.width - 18);
  const y = Math.min(Math.max(stageBox.top - wrapBox.top + r.y, 18), wrapBox.height - 18);
  btn.style.left = x + 'px';
  btn.style.top = y + 'px';
  btn.hidden = false;
}

function addNode(node) {
  node.draggable(true);
  node.on('dragmove transform', placeDeleteButton);
  node.on('dragstart transformstart', () => { $('#item-delete').hidden = true; });
  node.on('dragend transformend', placeDeleteButton);
  contentLayer.add(node);
  select(node);
}

// 위치를 정하지 않으면 사진 칸 아래 여백 가운데, 아니면 화면 가운데
function centerOf(node, y) {
  const [w, h] = template.size;
  const r = node.getClientRect({ relativeTo: contentLayer });
  node.position({ x: w / 2 - r.width / 2, y: (y ?? h / 2) - r.height / 2 });
}

function addText(text, color, y, size = template.size[0] / 8.5) {
  const node = new Konva.Text({ text, fill: color, fontSize: size, fontStyle: 'bold', fontFamily: FONT });
  centerOf(node, y);
  addNode(node);
}

// 스티커
const emojiGrid = $('#emoji-grid');
EMOJIS.forEach((emoji) => {
  const b = document.createElement('button');
  b.textContent = emoji;
  b.addEventListener('click', () => {
    const node = new Konva.Text({ name: 'sticker', text: emoji, fontSize: template.size[0] / 4.5, fontFamily: FONT });
    // 사진 칸 아래 여백에 놓고, 겹치지 않게 좌우로 조금씩 흩뿌리기
    const bottom = template.slots.reduce((m, s) => Math.max(m, s.y + s.h), 0);
    centerOf(node, bottom + (template.size[1] - bottom) / 2);
    node.move({ x: (Math.random() - 0.5) * template.size[0] * 0.6, y: 0 });
    addNode(node);
    closeSheets();
  });
  emojiGrid.append(b);
});

// 캐릭터: 여러 장 올리면 배경을 지우고 사진 칸 모서리·가장자리에 자동 배치
const characters = [];
let layoutShift = 0;

function placeCharacters() {
  contentLayer.find('.auto-char').forEach((n) => n.destroy());
  for (const it of layoutCharacters(template, characters, layoutShift)) {
    const node = new Konva.Image({ ...it, name: 'auto-char' });
    addNode(node);
  }
  select(null);
}

$('#char-add').addEventListener('click', () => $('#char-input').click());
$('#char-input').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  $('#busy').hidden = false;
  try {
    for (const f of files.slice(0, 10)) {
      try { characters.push(await makeCharacter(f)); } catch { /* 열 수 없는 파일은 건너뜀 */ }
    }
  } finally {
    $('#busy').hidden = true;
  }
  if (!characters.length) return toast('그림을 열 수 없어요. PNG나 JPG로 올려주세요');
  placeCharacters();
  closeSheets();
  toast(`캐릭터 ${characters.length}개를 배치했어요. 손으로 옮기거나 "다시 배치"를 눌러 보세요`, 4000);
});
$('#char-shuffle').addEventListener('click', () => {
  if (!characters.length) return toast('먼저 캐릭터 그림을 올려주세요');
  layoutShift++;
  placeCharacters();
});
$('#char-clear').addEventListener('click', () => {
  characters.length = 0;
  contentLayer.find('.auto-char').forEach((n) => n.destroy());
  select(null);
  closeSheets();
});

// 사진
$('#add-photo').addEventListener('click', () => $('#photo-input').click());
$('#photo-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const bitmap = await createImageBitmap(file);
    const max = 1000;
    const s = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bitmap.width * s);
    c.height = Math.round(bitmap.height * s);
    c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
    const width = template.size[0] * 0.45;
    const node = new Konva.Image({ image: c, width, height: (width * c.height) / c.width });
    centerOf(node);
    addNode(node);
  } catch {
    toast('이 사진은 열 수 없어요. 다른 사진을 골라주세요');
  }
});

// 글자
function swatches(container, colors, current, onPick) {
  container.innerHTML = '';
  colors.forEach((c) => {
    const b = document.createElement('button');
    b.style.background = c;
    b.classList.toggle('on', c === current);
    b.addEventListener('click', () => {
      [...container.children].forEach((x) => x.classList.toggle('on', x === b));
      onPick(c);
    });
    container.append(b);
  });
}

function openTextSheet() {
  const editing = isTextNode(selected);
  $('#text-sheet-title').textContent = editing ? '글자 수정' : '글자 넣기';
  $('#text-apply').textContent = editing ? '바꾸기' : '넣기';
  $('#text-input').value = editing ? selected.text() : '';
  textColor = editing ? selected.fill() : textColor;
  swatches($('#text-colors'), TEXT_COLORS, textColor, (c) => { textColor = c; });
  setTimeout(() => $('#text-input').focus(), 50);
}

$('#text-apply').addEventListener('click', () => {
  const text = $('#text-input').value.trim();
  if (!text) return toast('글자를 입력해 주세요');
  const editing = isTextNode(selected);
  if (editing) {
    selected.text(text);
    selected.fill(textColor);
    transformer.forceUpdate();
  } else if ($('#text-bubble').checked) {
    addBubble(text, textColor);
  } else {
    addText(text, textColor);
  }
  closeSheets();
});

// 말풍선: 흰 말풍선 + 꼬리(아래) + 글자. 그룹이라 통째로 옮기고 키울 수 있다
function addBubble(text, color) {
  const label = new Konva.Label({ name: 'bubble' });
  label.add(new Konva.Tag({
    fill: '#ffffff', stroke: '#3a2a20', strokeWidth: 4, cornerRadius: 26, lineJoin: 'round',
    pointerDirection: 'down', pointerWidth: 26, pointerHeight: 22,
  }));
  label.add(new Konva.Text({ text, fontSize: template.size[0] / 13, fontStyle: 'bold', fontFamily: FONT, fill: color, padding: 18 }));
  centerOf(label);
  addNode(label);
}

// 배경
function openBgSheet() {
  swatches($('#bg-colors'), BG_COLORS, bgColor, (c) => {
    bgColor = c;
    bgImage.image(drawBackground(document.createElement('canvas'), template, bgColor));
  });
  document.querySelectorAll('#slot-shapes button').forEach((b) => b.classList.toggle('on', b.dataset.shape === slotShape));
}
document.querySelectorAll('#slot-shapes button').forEach((b) => {
  b.addEventListener('click', () => {
    slotShape = b.dataset.shape;
    document.querySelectorAll('#slot-shapes button').forEach((x) => x.classList.toggle('on', x === b));
    drawSlots();
  });
});

// 삭제
$('#item-delete').addEventListener('click', () => {
  if (!selected) return;
  selected.destroy();
  select(null);
});

// 시트 열고 닫기
function closeSheets() { document.querySelectorAll('.sheet').forEach((s) => { s.hidden = true; }); }
document.querySelectorAll('[data-sheet]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.sheet;
    const wasOpen = !$('#' + id).hidden;
    closeSheets();
    if (wasOpen) return;
    if (id === 'sheet-text') openTextSheet();
    if (id === 'sheet-bg') openBgSheet();
    $('#' + id).hidden = false;
  });
});
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeSheets));

$('#back-template').addEventListener('click', () => {
  if (contentLayer.getChildren((n) => n !== transformer).length > 1 && !confirmDiscard()) return;
  closeSheets();
  select(null);
  showStep('step-template');
});

// 확인 대화상자 대신 한 번 더 누르게 한다
let discardArmed = 0;
function confirmDiscard() {
  if (Date.now() - discardArmed < 3000) return true;
  discardArmed = Date.now();
  toast('꾸민 내용이 사라져요. 한 번 더 누르면 템플릿으로 돌아가요');
  return false;
}

// ───────── 3. 저장 ─────────
// 배경(사진 칸은 투명하게 뚫음) 위에 꾸밈을 그대로 얹는다 → 사진 칸 위 스티커도 사진 위에 남는다
function exportOverlay() {
  select(null);
  const [w, h] = template.size;
  const ratio = w / stage.width();
  const snap = (layer) => {
    [bgLayer, slotLayer, contentLayer].forEach((l) => l.visible(l === layer));
    const c = stage.toCanvas({ pixelRatio: ratio });
    [bgLayer, slotLayer, contentLayer].forEach((l) => l.visible(true));
    return c;
  };
  const bg = snap(bgLayer);
  const content = snap(contentLayer);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  ctx.drawImage(bg, 0, 0, w, h);
  if (!template.keyed) { // AI 그림은 칸이 이미 뚫려 있고, 칸에 걸친 캐릭터를 살려야 하므로 자르지 않음
    ctx.globalCompositeOperation = 'destination-out';
    template.slots.forEach((s) => { ctx.beginPath(); slotPath(ctx, s, slotShape); ctx.fill(); });
    ctx.globalCompositeOperation = 'source-over';
    if (template.outline) { // 칸 모양을 따라 얇은 테두리
      ctx.strokeStyle = template.outline;
      ctx.lineWidth = 4;
      template.slots.forEach((s) => { ctx.beginPath(); slotPath(ctx, s, slotShape); ctx.stroke(); });
    }
  }
  ctx.drawImage(content, 0, 0, w, h);
  return out;
}

function headers(extra = {}) {
  const h = { apikey: C.supabaseAnonKey, ...extra };
  if (C.supabaseAnonKey.startsWith('eyJ')) h.Authorization = 'Bearer ' + C.supabaseAnonKey;
  return h;
}

async function codeInUse(code) {
  const since = new Date(Date.now() - C.maxAgeHours * 3600e3).toISOString();
  const res = await fetch(`${C.supabaseUrl}/rest/v1/custom_frames?select=code&code=eq.${code}&created_at=gte.${encodeURIComponent(since)}&limit=1`, { headers: headers() });
  if (!res.ok) throw new Error('번호 확인 실패 ' + res.status);
  return (await res.json()).length > 0;
}

async function saveFrame(canvas) {
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.png`;
  const up = await fetch(`${C.supabaseUrl}/storage/v1/object/frames/${path}`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'image/png', 'x-upsert': 'false' }),
    body: blob,
  });
  if (!up.ok) throw new Error('업로드 실패 ' + up.status);
  const overlayUrl = `${C.supabaseUrl}/storage/v1/object/public/frames/${path}`;

  let code;
  for (let i = 0; i < 10; i++) {
    const candidate = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    if (!(await codeInUse(candidate))) { code = candidate; break; }
  }
  if (!code) throw new Error('번호를 만들지 못했어요');

  const ins = await fetch(`${C.supabaseUrl}/rest/v1/custom_frames`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({ code, overlay_url: overlayUrl, slots: template.slots, size: template.size }),
  });
  if (!ins.ok) throw new Error('저장 실패 ' + ins.status);
  return code;
}

$('#finish').addEventListener('click', async () => {
  closeSheets();
  if (!C.supabaseUrl || !C.supabaseAnonKey) return toast('설정(config.js)에 Supabase 주소가 없어요');
  $('#busy').hidden = false;
  try {
    const overlay = exportOverlay();
    const code = await saveFrame(overlay);
    // 완료 화면 미리보기는 배경 위에 칸을 회색으로
    const preview = document.createElement('canvas');
    [preview.width, preview.height] = template.size;
    const ctx = preview.getContext('2d');
    ctx.fillStyle = '#cfc8bf';
    template.slots.forEach((s) => { ctx.beginPath(); slotPath(ctx, s, slotShape); ctx.fill(); });
    ctx.drawImage(overlay, 0, 0);
    $('#done-preview').src = preview.toDataURL('image/jpeg', 0.85);
    $('#code').textContent = code;
    showStep('step-done');
  } catch (e) {
    console.error(e);
    toast('저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러주세요', 4000);
  } finally {
    $('#busy').hidden = true;
  }
});

$('#restart').addEventListener('click', () => showStep('step-template'));

// ───────── AI 프레임 ─────────
// 캐릭터 이름 + 분위기 → 요청문. 화면의 칸에 항상 최신 요청문을 띄워 둔다
function currentAiPrompt() {
  const name = $('#ai-name').value.trim();
  if (!name) { toast('캐릭터 이름을 먼저 써 주세요'); $('#ai-name').focus(); return null; }
  const mood = [...aiMoods, $('#ai-mood-text').value.trim()].filter(Boolean).join(', ');
  return { name, mood, prompt: window.buildAiPrompt(name, mood) };
}
function refreshPromptBox() {
  const name = $('#ai-name').value.trim();
  const mood = [...aiMoods, $('#ai-mood-text').value.trim()].filter(Boolean).join(', ');
  $('#ai-prompt-box').value = name ? window.buildAiPrompt(name, mood) : '';
  $('#ai-copy').textContent = '📋 요청문 복사';
}
$('#ai-name').addEventListener('input', refreshPromptBox);
$('#ai-mood-text').addEventListener('input', refreshPromptBox);

// 복사: 화면의 칸을 선택해서 execCommand로 복사(아이폰 포함 대부분 동작). 동기라서 앱 열기 직전에도 쓸 수 있다
function copyPromptSync() {
  refreshPromptBox();
  const box = $('#ai-prompt-box');
  let ok = false;
  try {
    box.removeAttribute('readonly');
    box.focus();
    box.select();
    box.setSelectionRange(0, box.value.length);
    ok = document.execCommand('copy');
  } catch { ok = false; }
  box.setAttribute('readonly', '');
  box.blur();
  if (ok) $('#ai-copy').textContent = '✓ 복사됐어요';
  return ok;
}

$('#ai-copy').addEventListener('click', async () => {
  if (!currentAiPrompt()) return;
  let ok = copyPromptSync();
  if (!ok) {
    try { await navigator.clipboard.writeText($('#ai-prompt-box').value); ok = true; } catch { ok = false; }
    if (ok) $('#ai-copy').textContent = '✓ 복사됐어요';
  }
  if (ok) toast('복사했어요. 아래 AI 앱을 열고 붙여넣으세요', 3500);
  else toast('자동 복사가 막혔어요. 요청문 칸을 길게 눌러 "전체 선택 → 복사" 해 주세요', 5000);
});

// AI 앱 버튼: 누르면 요청문을 복사하고 앱을 연다.
// 안드로이드는 intent 주소로 설치된 앱을 바로 실행(없으면 웹으로), 아이폰은 https 주소가 유니버설 링크로 앱을 연다
const isAndroid = /Android/i.test(navigator.userAgent);
document.querySelectorAll('[data-ai-pkg]').forEach((a) => {
  if (isAndroid) {
    a.href = `intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${a.dataset.aiPkg};S.browser_fallback_url=${encodeURIComponent(a.href)};end`;
    a.removeAttribute('target');
  }
  a.addEventListener('click', (e) => {
    if (!currentAiPrompt()) { e.preventDefault(); return; }
    if (copyPromptSync()) toast('요청문을 복사했어요. 앱 입력창에 붙여넣고 보내세요', 4000);
  });
});

// AI 그림(비트맵) → 1200×1800으로 맞추고 가이드 칸에 맞춰 칸 색을 투명하게 → 결과 상태
function prepareAiImage(img) {
  const [w, h] = AI_TEMPLATE.size;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  // 비율이 다르면 가운데 기준으로 꽉 채우고 넘치는 부분은 자름
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  c.getContext('2d').drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  const k = keyToGuide(c, AI_TEMPLATE.slots);
  return { canvas: c, status: k.status, fitted: !!k.fitted, cropped: Math.abs(img.width / img.height - w / h) > 0.08 };
}

function openAiResult(r) {
  startEditing({ ...AI_TEMPLATE, image: r.canvas, keyed: true });
  toast(r.fitted ? 'AI가 칸을 조금 어긋나게 그려서 사진 칸 위치에 맞게 늘이고 옮겼어요' : r.cropped ? '세로 2:3 그림이 아니라 가장자리가 조금 잘렸어요' : '사진 칸에 걸친 캐릭터는 사진 위에 그대로 남아요. 스티커·글자를 더 얹을 수 있어요', 4500);
}

// AI 앱에서 그린 그림 올리기
$('#ai-upload').addEventListener('click', () => $('#ai-input').click());
$('#ai-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let r;
  try { r = prepareAiImage(await createImageBitmap(file)); } catch { return toast('이 그림은 열 수 없어요. PNG나 JPG로 저장해서 올려주세요'); }
  if (r.status === 'mismatch') return toast('AI가 사진 칸을 다른 위치에 그렸어요. AI에게 "사진 칸 위치를 요청문대로 다시 그려줘"라고 해 주세요', 7000);
  if (r.status === 'none') return toast('사진 칸(분홍 칸)을 찾지 못했어요. AI에게 "사진 칸 4개를 마젠타색으로 채워서 다시 그려줘"라고 해 주세요', 7000);
  openAiResult(r);
});

// ───────── 분위기 버튼 ─────────
const MOODS = ['귀엽게', '파스텔', '벚꽃', '우주', '바다', '시험기간', '생일', '크리스마스', '레트로'];
const aiMoods = new Set();
MOODS.forEach((m) => {
  const b = document.createElement('button');
  b.className = 'chip';
  b.textContent = m;
  b.addEventListener('click', () => {
    if (aiMoods.has(m)) aiMoods.delete(m); else aiMoods.add(m);
    b.classList.toggle('on', aiMoods.has(m));
    refreshPromptBox();
  });
  $('#ai-moods').append(b);
});

// ───────── (유료) 앱 안에서 바로 생성: 서버 함수 → Gemini API. config.aiAutoEnabled가 true일 때만 버튼 보임 ─────────
$('#ai-generate').hidden = !C.aiAutoEnabled;
$('.ai-card').hidden = !C.aiEnabled;

// 같은 폰에서 하루 생성 횟수 제한 (서버에도 하루 전체 한도가 따로 있음)
function aiUsedToday() {
  try {
    const v = JSON.parse(localStorage.getItem('aiUse') || '{}');
    return v.day === new Date().toDateString() ? v.n : 0;
  } catch { return 0; }
}
function aiCountUse() {
  try { localStorage.setItem('aiUse', JSON.stringify({ day: new Date().toDateString(), n: aiUsedToday() + 1 })); } catch {}
}

async function requestAiFrame(name, mood) {
  const res = await fetch(`${C.supabaseUrl}/functions/v1/generate-frame`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ characterName: name, mood }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || 'AI 생성에 실패했어요');
  aiCountUse();
  const blob = await (await fetch(`data:${body.mime};base64,${body.image}`)).blob();
  return prepareAiImage(await createImageBitmap(blob));
}

$('#ai-generate').addEventListener('click', async () => {
  const p = currentAiPrompt();
  if (!p) return;
  const limit = C.aiPerDevice ?? 5;
  if (aiUsedToday() >= limit) return toast(`AI 생성은 하루 ${limit}번까지예요. 직접 꾸미기를 이용해 주세요`, 4500);
  const busyText = $('#busy p');
  $('#busy').hidden = false;
  try {
    busyText.textContent = 'AI가 프레임을 그리는 중… (20초쯤 걸려요)';
    let r = await requestAiFrame(p.name, p.mood);
    // 칸 위치를 틀리게 그렸으면 한 번 더 자동으로
    if (r.status !== 'ok' && aiUsedToday() < limit) {
      busyText.textContent = '사진 칸이 어긋나서 한 번 더 그리는 중…';
      r = await requestAiFrame(p.name, p.mood);
    }
    if (r.status !== 'ok') return toast('AI가 사진 칸을 정확히 못 그렸어요. 다시 생성하거나 직접 꾸미기를 이용해 주세요', 6000);
    openAiResult(r);
  } catch (err) {
    toast(err.message || 'AI 생성에 실패했어요', 5000);
  } finally {
    $('#busy').hidden = true;
    busyText.textContent = '저장 중…';
  }
});

renderTemplates();
