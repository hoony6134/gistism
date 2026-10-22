import {
  composeSheet, composeSingle, canvasToBlob, renderFramePreview, drawFrame,
} from './compose.js';
import { loadLocalFrames, frameFromCloudRow, FRAME_TYPES } from './frames.js';
import { cloudEnabled, fetchCustomFrame, uploadPhoto, downloadPageUrl } from './cloud.js';

const C = window.BOOTH_CONFIG;
const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────── 설정 (관리자 메뉴에서 바꾼 값은 이 PC의 브라우저에 저장) ─────────
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('booth.' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('booth.' + key, JSON.stringify(value)); } catch {}
  },
};

// 촬영 설정: config.js 값이 기본, 관리자 메뉴에서 바꾸면 이 PC에 저장
const settings = {
  countdown: store.get('countdown', C.countdownSeconds),
  nextCountdown: store.get('nextCountdown', C.nextCountdownSeconds),
  extraShots: store.get('extraShots', C.extraShots),
  crop: store.get('crop', 0), // 카메라 화면 가장자리를 몇 %씩 잘라낼지 (캡처보드로 들어오는 카메라 정보 표시·검은 테두리 숨기기)
  // 사진 색감 보정 (카메라 자체 노출은 카메라에서. 여기서는 들어온 화면을 살짝 고친다)
  brightness: store.get('brightness', 0),
  contrast: store.get('contrast', 0),
  saturation: store.get('saturation', 0),
  warmth: store.get('warmth', 0),
};

// 색감 보정을 CSS/캔버스 필터 한 줄로. 미리보기·찍은 사진·캐릭터 실시간 화면에 똑같이 쓴다
function camFilter() {
  const { brightness: b, contrast: c, saturation: sa, warmth: w } = settings;
  if (!b && !c && !sa && !w) return 'none';
  return `brightness(${1 + b / 100}) contrast(${1 + c / 100}) saturate(${1 + sa / 100}) sepia(${w / 100})`;
}
function applyFilter() {
  document.documentElement.style.setProperty('--cam-filter', camFilter());
}
applyFilter();

const state = {
  screen: null,
  frames: [],
  frameErrors: [],
  mode: null,     // 'normal'(찍고 → 프레임 고르기) | 'character'(프레임 고르고 → 찍기)
  frame: null,
  shots: [],      // { canvas, thumb } (촬영 순서)
  picked: [],     // shots 인덱스 (프레임 칸 순서)
  copies: 1,
  session: null,  // { id, startedAt }
  sheet: null,    // 인쇄용 캔버스
  mirror: store.get('mirror', C.mirror),
  sound: store.get('sound', C.sound !== false),
  autoBars: store.get('autoBars', true), // 카메라 화면 양옆 검은 띠 자동 잘라내기
  cameraId: store.get('cameraId', ''),
  disabledFrames: new Set(store.get('disabledFrames', [])),
};

// ───────── 로그 · 통계 ─────────
function log(event, data = {}) {
  const entry = { t: new Date().toISOString(), event, session: state.session?.id, ...data };
  fetch('/api/log', { method: 'POST', body: JSON.stringify(entry) }).catch(() => {});
  const key = 'stats.' + new Date().toISOString().slice(0, 10);
  const stats = store.get(key, {});
  stats[event] = (stats[event] || 0) + 1;
  store.set(key, stats);
}

function toast(message, ms = 3500) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, ms);
}

function reportError(where, err) {
  console.error(where, err);
  log('error', { where, message: String(err?.message || err) });
}

// ───────── 화면 전환 · 자동 복귀 ─────────
const screenEnter = {};

// 단계 표시: 일반은 촬영이 먼저, 캐릭터는 프레임이 먼저
const STEPS = { normal: ['촬영', '사진', '프레임', '출력'], character: ['프레임', '촬영', '사진', '출력'] };
const SCREEN_STEP = { select: '프레임', pick: '사진', print: '출력' };

function renderSteps(id) {
  const list = document.querySelector(`#${id} .steps`);
  if (!list) return;
  const steps = STEPS[state.mode] || STEPS.normal;
  const at = steps.indexOf(SCREEN_STEP[id]);
  list.innerHTML = steps.map((name, i) =>
    `<li class="${i < at ? 'done' : i === at ? 'now' : ''}"${i === at ? ' aria-current="step"' : ''}>${name}</li>`).join('');
}

function show(id) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('active', el.id === id));
  state.screen = id;
  resetIdle();
  renderSteps(id);
  document.querySelectorAll('.cam-preview').forEach((v) => v.classList.toggle('mirror', state.mirror));
  screenEnter[id]?.();
}

let idleTimer;
function resetIdle() {
  clearTimeout(idleTimer);
  if (['attract', 'ready', 'shoot', 'done'].includes(state.screen)) return;
  idleTimer = setTimeout(() => {
    if (!$('#admin').hidden) return resetIdle();
    if (state.session) log('session_abandoned', { screen: state.screen });
    endSession();
    show('attract');
  }, C.idleSeconds * 1000);
}
document.addEventListener('pointerdown', resetIdle, true);
document.addEventListener('contextmenu', (e) => e.preventDefault());

document.querySelectorAll('[data-go]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.go === 'attract') endSession();
    show(btn.dataset.go);
  });
});

function startSession() {
  state.session = { id: makeSessionId(), startedAt: Date.now() };
  log('session_start');
}

function endSession() {
  clearTimeout(doneTimer);
  state.session = null;
  state.mode = null;
  state.frame = null;
  state.shots = [];
  state.picked = [];
  state.sheet = null;
}

function makeSessionId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-` +
    Math.random().toString(36).slice(2, 6);
}

// ───────── QR ─────────
function renderQr(el, text) {
  if (!window.qrcode) {
    el.innerHTML = `<span class="small">${text}</span>`;
    return;
  }
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  el.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

// ───────── 카메라 ─────────
const video = $('#video');
let currentStream = null;

// 가장자리 자르기: 미리보기는 그만큼 확대하고, 찍은 사진은 그 부분을 잘라 낸다
function applyCrop() {
  document.documentElement.style.setProperty('--cam-zoom', 1 / (1 - (2 * settings.crop) / 100));
}
applyCrop();
// 카메라가 16:9 신호 안에 좁은 화면을 보내면 양옆에 검은 세로 띠가 생긴다.
// 띠를 찾아서 빼고 실제 화면 너비에 맞춘다 (높이는 그대로).
let bars = { left: 0, right: 0 }; // 원본 픽셀 단위
const barCanvas = document.createElement('canvas');
function detectBars() {
  const W = video.videoWidth;
  const H = video.videoHeight;
  if (!W || !H) return;
  if (!state.autoBars) { bars = { left: 0, right: 0 }; return; }
  const sw = 320;
  const sh = Math.max(1, Math.round((sw * H) / W));
  barCanvas.width = sw;
  barCanvas.height = sh;
  const g = barCanvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(video, 0, 0, sw, sh);
  const d = g.getImageData(0, 0, sw, sh).data;
  // 세로줄마다 가장 밝은 픽셀. 띠는 위에서 아래까지 전부 거의 검정이다
  const colMax = new Float32Array(sw);
  for (let y = 0; y < sh; y += 2) {
    for (let x = 0; x < sw; x++) {
      const p = (y * sw + x) * 4;
      const luma = 0.3 * d[p] + 0.59 * d[p + 1] + 0.11 * d[p + 2];
      if (luma > colMax[x]) colMax[x] = luma;
    }
  }
  // 진짜 검은 띠만 자른다: 거의 완전한 검정 + 양쪽 너비가 거의 같음 + 띠 경계에서 화면이 갑자기 밝아짐.
  // (어두운 벽·커튼이 화면 가장자리에 있어도 잘리지 않게)
  const DARK = 12;
  let l = 0;
  while (l < sw / 3 && colMax[l] < DARK) l++;
  let r = sw - 1;
  while (r > (sw * 2) / 3 && colMax[r] < DARK) r--;
  if (l >= sw / 3 || r <= (sw * 2) / 3) return; // 화면 전체가 어두움 (카메라 꺼짐 등) → 이전 값 유지
  const left = l;
  const right = sw - 1 - r;
  const inside = (x) => Math.min(colMax[x], colMax[x + Math.sign(sw / 2 - x)] ?? 255);
  const sharp = (x) => inside(x) > 60;
  const symmetric = Math.abs(left - right) <= sw * 0.03;
  if (left < 3 || right < 3 || !symmetric || !sharp(l) || !sharp(r)) { bars = { left: 0, right: 0 }; return; }
  const toSrc = (n) => Math.ceil(((n + 1) * W) / sw); // 경계 1칸 여유
  bars = { left: toSrc(left), right: toSrc(right) };
}

function camRect() {
  const c = settings.crop / 100;
  const bw = video.videoWidth - bars.left - bars.right;
  const h = video.videoHeight;
  return {
    ox: bars.left + Math.round(bw * c), oy: Math.round(h * c),
    w: Math.round(bw * (1 - 2 * c)), h: Math.round(h * (1 - 2 * c)),
  };
}

// 해상도: 관리자 메뉴에서 고른 값(없으면 config.js). 캡처보드가 지원하는 가장 가까운 값으로 열린다
const cameraRes = () => store.get('cameraRes', `${C.cameraWidth}x${C.cameraHeight}`).split('x').map(Number);

async function startCamera() {
  currentStream?.getTracks().forEach((t) => t.stop());
  const [rw, rh] = cameraRes();
  const constraints = {
    audio: false,
    video: {
      width: { ideal: rw },
      height: { ideal: rh },
      frameRate: { ideal: 30 },
      ...(state.cameraId ? { deviceId: { exact: state.cameraId } } : {}),
    },
  };
  try {
    currentStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    if (state.cameraId) {
      // 저장된 카메라가 빠졌으면 아무 카메라나
      state.cameraId = '';
      return startCamera();
    }
    reportError('camera', e);
    if (!C.fakeCameraFallback) throw e;
    currentStream = fakeCameraStream();
    toast('카메라를 찾지 못해 테스트 화면을 씁니다');
  }
  video.srcObject = currentStream;
  // 시작 화면·촬영 준비 화면의 미리보기도 같은 카메라를 보여 준다
  document.querySelectorAll('.cam-preview').forEach((v) => { v.srcObject = currentStream; v.play().catch(() => {}); });
  await video.play().catch(() => {});
  await new Promise((r) => (video.videoWidth ? r() : video.addEventListener('loadedmetadata', r, { once: true })));
  bars = { left: 0, right: 0 };
  setTimeout(detectBars, 1500); // 첫 몇 프레임은 까맣게 들어오기도 해서 조금 기다렸다가
  const track = currentStream.getVideoTracks()[0];
  $('#camera-info').textContent = `${track?.label || '테스트 화면'} · ${video.videoWidth}×${video.videoHeight}`;
  setTimeout(() => {
    if (bars.left || bars.right) $('#camera-info').textContent += ` · 양옆 검은 띠 ${bars.left}+${bars.right}px 자동으로 잘라냄`;
  }, 1700);
}

function fakeCameraStream() {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d');
  const draw = (t) => {
    const g = ctx.createLinearGradient(0, 0, 1920, 1080);
    g.addColorStop(0, '#f6c28b');
    g.addColorStop(1, '#8fb6d9');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1920, 1080);
    const x = 960 + Math.sin(t / 900) * 300;
    ctx.fillStyle = 'rgba(60,40,30,0.55)';
    ctx.beginPath(); ctx.arc(x, 430, 150, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x, 900, 320, 300, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 56px sans-serif';
    ctx.fillText('TEST CAMERA  ' + new Date().toLocaleTimeString(), 60, 100);
    ctx.fillText('L', 60, 1020);
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  return canvas.captureStream(30);
}

function captureFrame() {
  const r = camRect();
  const canvas = document.createElement('canvas');
  canvas.width = r.w;
  canvas.height = r.h;
  const ctx = canvas.getContext('2d');
  if (state.mirror) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.filter = camFilter();
  ctx.drawImage(video, r.ox, r.oy, r.w, r.h, 0, 0, r.w, r.h);
  const thumb = document.createElement('canvas');
  thumb.width = 640;
  thumb.height = Math.round((640 * canvas.height) / canvas.width);
  thumb.getContext('2d').drawImage(canvas, 0, 0, thumb.width, thumb.height);
  return { canvas, thumbUrl: thumb.toDataURL('image/jpeg', 0.85) };
}

const shotPhoto = (shot) => ({ source: shot.canvas, w: shot.canvas.width, h: shot.canvas.height });

// 프레임 비율에 맞춘 미리보기 캔버스
function sizePreviewCanvas(canvas, frame, height) {
  canvas.height = height;
  canvas.width = Math.round((height * frame.size[0]) / frame.size[1]);
}

// ───────── 1. 홈 (대기 화면 겸 일반 / 캐릭터 고르기) ─────────
const customFramesOn = () => cloudEnabled() && C.customFrames !== false;
const activeFrames = (type) => state.frames.filter((f) => !state.disabledFrames.has(f.id) && (!type || f.type === type));
const hasFrames = (type) => activeFrames(type).length > 0 || (type === 'normal' && customFramesOn());

$('#booth-title').textContent = C.title;

// 촬영 전 미리보기용 예시 사진: 초점이 나간 사진처럼 부드러운 색 면 (실제 사람 사진 대신)
let samples;
function samplePhotos() {
  if (samples) return samples;
  const palettes = [
    ['#f4d3c4', '#e79c8a', '#fff1e6'], ['#cfe0f6', '#8fb0e8', '#eef5ff'],
    ['#f5e6b8', '#e8b75c', '#fffaf0'], ['#d8ead2', '#98c58d', '#f3fbef'],
  ];
  samples = palettes.map(([base, deep, light], i) => {
    const c = document.createElement('canvas');
    c.width = 900;
    c.height = 600;
    const g = c.getContext('2d');
    g.fillStyle = base;
    g.fillRect(0, 0, 900, 600);
    const blob = (x, y, r, color) => {
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, color);
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, 900, 600);
    };
    blob(220 + i * 90, 160, 420, light);
    blob(700 - i * 60, 520, 460, deep);
    blob(480, 300, 260, 'rgba(255,255,255,0.55)');
    return { source: c, w: 900, h: 600 };
  });
  return samples;
}
const sampleFill = (frame) => frame.slots.map((_, i) => samplePhotos()[i % 4]);

function renderArt(wrap, frames, height) {
  wrap.innerHTML = '';
  frames.forEach((frame) => {
    const c = document.createElement('canvas');
    sizePreviewCanvas(c, frame, height);
    renderFramePreview(c, frame, sampleFill(frame));
    wrap.append(c);
  });
}

screenEnter.attract = () => {
  for (const type of ['normal', 'character']) {
    const tile = $(`#mode-${type}`);
    tile.hidden = !hasFrames(type);
    renderArt(tile.querySelector('.tile-art'), activeFrames(type).slice(0, type === 'normal' ? 2 : 1), 900);
  }
  const showQr = customFramesOn() && C.editorUrl;
  $('#attract-qr').hidden = !showQr;
  if (showQr) renderQr($('#editor-qr'), C.editorUrl);
};

for (const type of ['normal', 'character']) {
  $(`#mode-${type}`).addEventListener('click', () => {
    startSession();
    startMode(type);
  });
}

function startMode(mode) {
  state.mode = mode;
  state.frame = null;
  log('mode_selected', { mode });
  // 일반: 촬영 준비 → 찍기 → 사진 고르기 → 프레임 / 캐릭터: 프레임 → 촬영 준비 → 프레임을 보면서 찍기
  show(mode === 'normal' ? 'ready' : 'select');
}

// ───────── 2. 촬영 준비 ─────────
const READY_SECONDS = 15; // 버튼을 안 눌러도 이만큼 지나면 촬영 시작
let readyTimer;
const shotCount = () => (state.mode === 'character' ? state.frame.slots.length : normalSlotCount());

screenEnter.ready = () => {
  detectBars();
  const slots = shotCount();
  $('#ready-shots').textContent = slots + settings.extraShots;
  $('#ready-seconds').textContent = settings.nextCountdown;
  $('#ready-pick').textContent = slots;
  // 캐릭터: 고른 프레임을 옆에 보여 준다
  const fc = $('#ready-frame');
  fc.hidden = state.mode !== 'character';
  if (!fc.hidden) {
    sizePreviewCanvas(fc, state.frame, 900);
    renderFramePreview(fc, state.frame, sampleFill(state.frame));
  }
  let left = READY_SECONDS;
  const tick = () => {
    if (state.screen !== 'ready') return;
    $('#ready-auto').textContent = `${left}초 뒤에 자동으로 시작해요`;
    if (left-- <= 0) runShoot();
    else readyTimer = setTimeout(tick, 1000);
  };
  clearTimeout(readyTimer);
  tick();
};
$('#ready-start').addEventListener('click', () => { clearTimeout(readyTimer); runShoot(); });
$('#ready-back').addEventListener('click', () => {
  clearTimeout(readyTimer);
  if (state.mode === 'character') return show('select');
  endSession();
  show('attract');
});

// ───────── 3. 프레임 선택 ─────────
let pendingFrame = null;
$('#select-next').addEventListener('click', () => pendingFrame && chooseFrame(pendingFrame));

screenEnter.select = () => {
  const normal = state.mode === 'normal';
  pendingFrame = null;
  $('#select-next').disabled = true;
  $('#select-back').textContent = normal ? '← 사진 다시 고르기' : '← 처음으로';
  $('#select-title').innerHTML = normal ? '어울리는 프레임을<br>골라주세요.' : '캐릭터 프레임을<br>골라주세요.';
  const grid = $('#frame-grid');
  grid.innerHTML = '';
  for (const frame of activeFrames(state.mode)) {
    const card = document.createElement('button');
    card.className = 'frame-card';
    const c = document.createElement('canvas');
    sizePreviewCanvas(c, frame, 600);
    // 일반 프레임은 고른 사진을 넣어서 보여 준다
    renderFramePreview(c, frame, normal ? frame.slots.map((_, i) => state.shots[state.picked[i]] && shotPhoto(state.shots[state.picked[i]])) : sampleFill(frame));
    card.append(c);
    card.insertAdjacentHTML('beforeend', `<strong></strong><span></span>`);
    card.querySelector('strong').textContent = frame.name;
    card.querySelector('span').textContent = frame.description || '';
    // 카드를 눌러 고르고 → 오른쪽 아래 "다음"
    card.addEventListener('click', () => {
      pendingFrame = frame;
      grid.querySelectorAll('.frame-card').forEach((el) => el.classList.toggle('selected', el === card));
      $('#select-next').disabled = false;
    });
    grid.append(card);
  }
  if (normal && customFramesOn()) {
    const card = document.createElement('button');
    card.className = 'frame-card custom';
    card.innerHTML = '<div class="plus">＋</div><strong>내 프레임</strong><span>폰에서 만든 4자리 번호 입력</span>';
    card.addEventListener('click', () => show('code'));
    grid.append(card);
  }
};

$('#select-back').addEventListener('click', () => {
  if (state.mode === 'normal') return show('pick');
  endSession();
  show('attract');
});

function chooseFrame(frame) {
  state.frame = frame;
  log('frame_selected', { frame: frame.id, type: frame.type, custom: Boolean(frame.custom) });
  if (state.mode === 'normal') {
    state.copies = 1;
    show('print');
  } else {
    setSlotAspect(frame.slots[0]);
    show('ready');
  }
}

// ───────── 4. 내 프레임 번호 (폰에서 만든 프레임, config.customFrames) ─────────
function makeKeypad(container, boxes, length, onComplete) {
  let value = '';
  boxes.innerHTML = '<div></div>'.repeat(length);
  const render = () => {
    [...boxes.children].forEach((b, i) => {
      b.textContent = value[i] ? (boxes.dataset.secret ? '●' : value[i]) : '';
      b.classList.toggle('filled', Boolean(value[i]));
    });
  };
  container.innerHTML = '';
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '지움', '0', '⌫'].forEach((k) => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = k;
    b.addEventListener('click', () => {
      if (k === '지움') value = '';
      else if (k === '⌫') value = value.slice(0, -1);
      else if (value.length < length) value += k;
      render();
      if (value.length === length) onComplete(value);
    });
    container.append(b);
  });
  render();
  return { reset() { value = ''; render(); } };
}

let pendingCustomFrame = null;
const codePad = makeKeypad($('#code-keypad'), $('#code-boxes'), 4, async (code) => {
  $('#code-error').textContent = '찾는 중…';
  try {
    const row = await fetchCustomFrame(code);
    if (!row) {
      $('#code-error').textContent = '번호를 찾을 수 없어요. 다시 확인해 주세요.';
      log('custom_code_miss');
      codePad.reset();
      return;
    }
    pendingCustomFrame = await frameFromCloudRow(row);
    const c = $('#code-canvas');
    sizePreviewCanvas(c, pendingCustomFrame, 900);
    renderFramePreview(c, pendingCustomFrame, []);
    $('#code-entry').hidden = true;
    $('#code-preview').hidden = false;
    $('#code-error').textContent = '';
  } catch (e) {
    reportError('custom_frame', e);
    $('#code-error').textContent = '프레임을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.';
    codePad.reset();
  }
});

screenEnter.code = () => {
  pendingCustomFrame = null;
  codePad.reset();
  $('#code-error').textContent = '';
  $('#code-entry').hidden = false;
  $('#code-preview').hidden = true;
};
$('#code-retry').addEventListener('click', () => screenEnter.code());
$('#code-use').addEventListener('click', () => pendingCustomFrame && chooseFrame(pendingCustomFrame));

// ───────── 5. 촬영 ─────────

function setViewfinderAspect(w, h) {
  $('#viewfinder').style.aspectRatio = `${w} / ${h}`;
  $('#viewfinder').style.setProperty('--vf-aspect', w / h);
}
// 사진 고르기 화면의 사진 칸 비율
function setSlotAspect(slot) {
  document.documentElement.style.setProperty('--slot-aspect', `${slot.w} / ${slot.h}`);
}

// 캐릭터 프레임 촬영: 프레임 위에 실시간 카메라를 지금 찍는 칸에 넣어서 보여 준다.
// 큰 화면은 지금 칸 주변을 확대, 오른쪽 아래 작은 화면은 프레임 전체.
const live = { on: false, slot: 0, view: null };

function liveFocus(frame, slot, aspect) {
  const pad = 0.18; // 칸 둘레로 프레임 그림이 보이게 여유
  let w = slot.w * (1 + pad * 2);
  let h = slot.h * (1 + pad * 2);
  if (w / h < aspect) w = h * aspect; else h = w / aspect;
  const [fw, fh] = frame.size;
  const clamp = (c, len, total) => (len >= total ? total / 2 : Math.min(Math.max(c, len / 2), total - len / 2));
  const cx = clamp(slot.x + slot.w / 2, w, fw);
  const cy = clamp(slot.y + slot.h / 2, h, fh);
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function livePhotos(frame) {
  const cam = { source: video, ...camRect(), mirror: state.mirror, filter: camFilter() };
  return frame.slots.map((_, k) => (k === live.slot ? cam : state.shots[k] ? shotPhoto(state.shots[k]) : null));
}

function sizeLiveCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}

function drawLive() {
  if (!live.on) return;
  const frame = state.frame;
  const big = $('#live-canvas');
  const mini = $('#live-mini');
  sizeLiveCanvas(big);
  const photos = video.videoWidth ? livePhotos(frame) : [];
  const target = liveFocus(frame, frame.slots[live.slot], big.width / big.height);
  // 다음 칸으로 넘어갈 때 부드럽게 이동
  const v = live.view && Math.abs(live.view.w / live.view.h - target.w / target.h) < 0.01 ? live.view : { ...target };
  for (const k of ['x', 'y', 'w', 'h']) v[k] += (target[k] - v[k]) * 0.18;
  live.view = v;
  const ctx = big.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, big.width, big.height);
  const s = big.width / v.w;
  ctx.setTransform(s, 0, 0, s, -v.x * s, -v.y * s);
  drawFrame(ctx, frame, photos);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  sizePreviewCanvas(mini, frame, Math.round(mini.clientHeight * Math.min(window.devicePixelRatio || 1, 1.5)) || 300);
  renderFramePreview(mini, frame, photos);
  requestAnimationFrame(drawLive);
}

function startLive(frame) {
  live.on = true;
  live.slot = 0;
  live.view = null;
  $('#shoot').classList.add('live');
  $('#live-canvas').hidden = false;
  $('#live-mini').hidden = false;
  $('#live-mini').style.aspectRatio = `${frame.size[0]} / ${frame.size[1]}`;
  requestAnimationFrame(drawLive);
}

function stopLive() {
  live.on = false;
  $('#shoot').classList.remove('live');
  $('#live-canvas').hidden = true;
  $('#live-mini').hidden = true;
}

// ───────── 소리: 파일 없이 브라우저에서 바로 만든다 (카운트다운 삑, 셔터 찰칵) ─────────
let audio;
function audioCtx() {
  if (!state.sound) return null;
  try {
    audio ||= new AudioContext();
    if (audio.state === 'suspended') audio.resume();
  } catch { return null; }
  return audio;
}
// 짧은 삑. 마지막 1초는 조금 높게
function beep(high) {
  const a = audioCtx();
  if (!a) return;
  const t = a.currentTime;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = 'sine';
  osc.frequency.value = high ? 1320 : 880;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  osc.connect(gain).connect(a.destination);
  osc.start(t);
  osc.stop(t + 0.18);
}
// 셔터: 짧은 잡음 두 번(찰-칵)
function shutterSound() {
  const a = audioCtx();
  if (!a) return;
  const t = a.currentTime;
  [[0, 3200, 0.9], [0.075, 1800, 0.7]].forEach(([dt, freq, vol]) => {
    const len = Math.floor(a.sampleRate * 0.06);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    const src = a.createBufferSource();
    src.buffer = buf;
    const filter = a.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 0.8;
    const gain = a.createGain();
    gain.gain.value = vol;
    src.connect(filter).connect(gain).connect(a.destination);
    src.start(t + dt);
  });
}
// 브라우저는 첫 터치 뒤에만 소리를 허락하므로, 첫 터치 때 미리 준비해 둔다
document.addEventListener('pointerdown', () => audioCtx(), { once: true, capture: true });

async function countdown(seconds) {
  const el = $('#countdown');
  for (let s = seconds; s > 0; s--) {
    beep(s === 1);
    el.textContent = s;
    el.classList.remove('tick');
    void el.offsetWidth;
    el.classList.add('tick');
    await sleep(1000);
  }
  el.textContent = '';
}

// 일반 모드에서 몇 장 찍을지: 켜진 일반 프레임 중 칸이 가장 많은 것 기준 (폰 프레임은 최대 4칸)
const normalSlotCount = () => Math.max(customFramesOn() ? 4 : 1, ...activeFrames('normal').map((f) => f.slots.length));

async function runShoot() {
  const character = state.mode === 'character';
  const frame = state.frame;
  const slots = shotCount();
  const total = slots + settings.extraShots;
  state.shots = [];
  state.picked = [];
  video.classList.toggle('mirror', state.mirror);
  show('shoot');
  if (!video.videoWidth) {
    try { await startCamera(); } catch {
      toast('카메라 연결을 확인해 주세요');
      endSession();
      show('attract');
      return;
    }
  }
  // 일반: 카메라 화면 그대로 크게 / 캐릭터: 프레임을 겹쳐서
  detectBars();
  const vr = camRect();
  setViewfinderAspect(vr.w, vr.h); // 검은 띠를 뺀 비율로 맞추면 화면에서도 띠가 잘려 보이지 않는다
  if (character) startLive(frame);
  const started = Date.now();
  try {
    for (let i = 0; i < total; i++) {
      if (state.screen !== 'shoot') return;
      live.slot = i % slots;
      $('#shot-counter').textContent = `${i + 1} / ${total}`;
      $('#shoot-hint').textContent = i === 0 ? '화면을 보고 포즈를 잡아주세요!' : i >= slots ? '보너스 컷! 마음껏 다르게' : '다음 포즈!';
      await countdown(i === 0 ? settings.countdown : settings.nextCountdown);
      if (state.screen !== 'shoot') return;
      const flash = $('#flash');
      flash.classList.remove('on');
      void flash.offsetWidth;
      flash.classList.add('on');
      shutterSound();
      state.shots.push(captureFrame());
      await sleep(600);
    }
  } finally {
    stopLive();
  }
  log('shoot_done', { mode: state.mode, shots: total, seconds: Math.round((Date.now() - started) / 1000) });
  // 캐릭터는 칸마다 찍은 사진을 미리 골라 둔다. 일반은 직접 고른다
  state.picked = character ? frame.slots.map((_, k) => k) : [];
  if (!character) setSlotAspect(camRect());
  show('pick');
}

// ───────── 6. 사진 고르기 ─────────
screenEnter.pick = () => {
  const need = shotCount();
  $('#pick-title').innerHTML = `사진 ${need}장을<br>골라주세요.`;
  const grid = $('#pick-grid');
  grid.innerHTML = '';
  grid.style.gridTemplateColumns = `repeat(${state.shots.length > 4 ? 3 : 2}, 1fr)`;
  state.shots.forEach((shot, idx) => {
    const btn = document.createElement('button');
    btn.className = 'pick-item';
    btn.innerHTML = `<img alt=""><span class="badge"></span>`;
    btn.querySelector('img').src = shot.thumbUrl;
    btn.addEventListener('click', () => {
      const at = state.picked.indexOf(idx);
      if (at >= 0) state.picked.splice(at, 1);
      else if (state.picked.length < need) state.picked.push(idx);
      else toast(`${need}장까지 고를 수 있어요. 빼고 싶은 사진을 먼저 눌러주세요`);
      renderPick();
    });
    grid.append(btn);
  });
  renderPick();
};

// 일반 모드: 프레임을 고르기 전이라 고른 사진을 번호 칸에 차례로 보여 준다
function drawPickedGrid(canvas, need) {
  const shot0 = state.shots[0];
  const cols = 2;
  const cw = 440;
  const ch = Math.round((cw * shot0.canvas.height) / shot0.canvas.width);
  const gap = 20;
  const rows = Math.ceil(need / cols);
  canvas.width = cols * cw + gap;
  canvas.height = rows * ch + (rows - 1) * gap;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < need; i++) {
    const x = (i % cols) * (cw + gap);
    const y = Math.floor(i / cols) * (ch + gap);
    const shot = state.shots[state.picked[i]];
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, cw, ch, 22);
    ctx.clip();
    if (shot) {
      ctx.drawImage(shot.canvas, x, y, cw, ch);
    } else {
      ctx.fillStyle = '#e8e8ed';
      ctx.fillRect(x, y, cw, ch);
      ctx.fillStyle = '#86868b';
      ctx.font = '600 72px Pretendard, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), x + cw / 2, y + ch / 2);
    }
    ctx.restore();
  }
}

function renderPick() {
  const need = shotCount();
  [...$('#pick-grid').children].forEach((btn, idx) => {
    const at = state.picked.indexOf(idx);
    btn.classList.toggle('selected', at >= 0);
    btn.querySelector('.badge').textContent = at >= 0 ? at + 1 : '';
  });
  const canvas = $('#pick-canvas');
  if (state.mode === 'normal') {
    drawPickedGrid(canvas, need);
  } else {
    sizePreviewCanvas(canvas, state.frame, 900);
    renderFramePreview(canvas, state.frame, state.frame.slots.map((_, i) => {
      const shot = state.shots[state.picked[i]];
      return shot ? shotPhoto(shot) : null;
    }));
  }
  $('#pick-done').disabled = state.picked.length !== need;
}

$('#pick-done').addEventListener('click', () => {
  if (state.mode === 'normal') return show('select');
  state.copies = 1;
  show('print');
});
$('#print-back').addEventListener('click', () => show(state.mode === 'normal' ? 'select' : 'pick'));

// ───────── 7. 인쇄 ─────────
const pickedPhotos = () => state.picked.map((i) => shotPhoto(state.shots[i]));

screenEnter.print = () => {
  state.sheet = composeSheet(state.frame, pickedPhotos(), $('#sheet-canvas'));
  $('#copies-hint').textContent = state.frame.layout === 'strip'
    ? '한 장에 두 줄이 나와요. 잘라서 나눠 가지세요'
    : '최대 ' + C.maxCopies + '장까지 뽑을 수 있어요';
  renderCopies();
};

function renderCopies() {
  $('#copies').textContent = state.copies;
  $('#copies-minus').disabled = state.copies <= 1;
  $('#copies-plus').disabled = state.copies >= C.maxCopies;
}
$('#copies-minus').addEventListener('click', () => { state.copies = Math.max(1, state.copies - 1); renderCopies(); });
$('#copies-plus').addEventListener('click', () => { state.copies = Math.min(C.maxCopies, state.copies + 1); renderCopies(); });

document.getElementById('page-style').textContent =
  `@page { size: ${C.paperWidthMm}mm ${C.paperHeightMm}mm; margin: 0; }` +
  `#print-area img { width: ${C.paperWidthMm}mm; height: ${C.paperHeightMm}mm; }`;

async function printSheet(canvas, copies) {
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.95);
  const url = URL.createObjectURL(blob);
  const area = $('#print-area');
  area.innerHTML = '';
  const loads = [];
  for (let i = 0; i < copies; i++) {
    const img = new Image();
    loads.push(new Promise((r) => { img.onload = r; img.onerror = r; }));
    img.src = url;
    area.append(img);
  }
  await Promise.all(loads);
  window.print(); // 키오스크 모드(--kiosk-printing)에서는 대화상자 없이 기본 프린터로 바로 나감
  setTimeout(() => { area.innerHTML = ''; URL.revokeObjectURL(url); }, 5000);
  return blob;
}

function saveLocal(blob, name) {
  return fetch('/api/save?name=' + encodeURIComponent(name), { method: 'POST', body: blob })
    .then((r) => { if (!r.ok) throw new Error('save ' + r.status); })
    .catch((e) => reportError('save_local', e));
}

$('#print-btn').addEventListener('click', async () => {
  const btn = $('#print-btn');
  if (btn.disabled) return;
  btn.disabled = true;
  const session = state.session || { id: makeSessionId(), startedAt: Date.now() };
  const frame = state.frame;
  const photos = pickedPhotos();
  const shots = state.shots.slice();
  try {
    const sheetBlob = await printSheet(state.sheet, state.copies);
    log('print', { frame: frame.id, copies: state.copies, seconds: Math.round((Date.now() - session.startedAt) / 1000) });
    show('done');
    startDoneScreen(frame, photos, session.id);
    // 결과 자동 저장 (원본 포함) — 프린터 오류 시 output 폴더에서 다시 뽑을 수 있다
    saveLocal(sheetBlob, `${session.id}_sheet.jpg`);
    shots.forEach(async (shot, i) => {
      saveLocal(await canvasToBlob(shot.canvas, 'image/jpeg', 0.92), `${session.id}_shot${i + 1}.jpg`);
    });
  } catch (e) {
    reportError('print', e);
    toast('인쇄에 실패했어요. 진행 요원을 불러주세요');
  } finally {
    btn.disabled = false;
  }
});

// ───────── 8. 완료 ─────────
let doneTimer;
async function startDoneScreen(frame, photos, sessionId) {
  let left = C.doneSeconds;
  const tick = () => {
    $('#done-timer').textContent = `(${left})`;
    if (left-- <= 0) {
      endSession();
      show('attract');
    } else {
      doneTimer = setTimeout(tick, 1000);
    }
  };
  clearTimeout(doneTimer);
  tick();

  $('#survey-card').hidden = !C.surveyUrl;
  if (C.surveyUrl) renderQr($('#survey-qr'), C.surveyUrl);

  const card = $('#download-card');
  card.hidden = !cloudEnabled();
  if (!cloudEnabled()) return;
  $('#download-qr').innerHTML = '<span class="spinner"></span>';
  $('#download-note').textContent = '업로드 중…';
  try {
    const single = composeSingle(frame, photos);
    const url = await uploadPhoto(await canvasToBlob(single, 'image/jpeg', 0.92), `${sessionId}.jpg`);
    if (state.screen !== 'done') return;
    renderQr($('#download-qr'), downloadPageUrl(url));
    $('#download-note').textContent = '48시간 동안 받을 수 있어요';
    log('upload_ok');
  } catch (e) {
    reportError('upload', e);
    $('#download-qr').innerHTML = '';
    $('#download-note').textContent = '지금은 파일 받기를 쓸 수 없어요';
  }
}

// ───────── 관리자 ─────────
let hotspotTaps = [];
$('#admin-hotspot').addEventListener('pointerdown', () => {
  const now = Date.now();
  hotspotTaps = hotspotTaps.filter((t) => now - t < 3000).concat(now);
  if (hotspotTaps.length >= 5) {
    hotspotTaps = [];
    openAdmin();
  }
});

$('#pin-boxes').dataset.secret = '1';
const pinPad = makeKeypad($('#pin-keypad'), $('#pin-boxes'), C.adminPin.length, (pin) => {
  if (pin === C.adminPin) {
    $('#admin-lock').hidden = true;
    $('#admin-body').hidden = false;
    renderAdmin();
  } else {
    toast('PIN이 틀렸어요');
    pinPad.reset();
  }
});

function openAdmin() {
  pinPad.reset();
  $('#admin-lock').hidden = false;
  $('#admin-body').hidden = true;
  $('#admin').hidden = false;
}
const closeAdmin = () => { $('#admin').hidden = true; resetIdle(); };
$('#admin-cancel').addEventListener('click', closeAdmin);
$('#admin-close').addEventListener('click', closeAdmin);

async function renderAdmin() {
  const stats = store.get('stats.' + new Date().toISOString().slice(0, 10), {});
  $('#admin-stats').innerHTML = [
    ['시작', stats.session_start || 0],
    ['인쇄', stats.print || 0],
    ['오류', stats.error || 0],
  ].map(([k, v]) => `<div><b>${v}</b>${k}</div>`).join('');

  const select = $('#camera-select');
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  select.innerHTML = '<option value="">자동 선택</option>' + devices
    .map((d, i) => `<option value="${d.deviceId}">${d.label || '카메라 ' + (i + 1)}</option>`).join('');
  select.value = state.cameraId;
  $('#camera-res').value = cameraRes().join('x');
  $('#mirror-check').checked = state.mirror;
  $('#sound-check').checked = state.sound;
  $('#bars-check').checked = state.autoBars;

  const list = $('#admin-frames');
  list.innerHTML = '';
  for (const f of state.frames) {
    const label = document.createElement('label');
    label.className = 'check';
    label.innerHTML = '<input type="checkbox"> <span></span>';
    label.querySelector('span').textContent = `[${FRAME_TYPES[f.type] || '일반'}] ${f.name} · ${f.slots.length}칸`;
    const input = label.querySelector('input');
    input.checked = !state.disabledFrames.has(f.id);
    input.addEventListener('change', () => {
      if (input.checked) state.disabledFrames.delete(f.id);
      else state.disabledFrames.add(f.id);
      store.set('disabledFrames', [...state.disabledFrames]);
    });
    list.append(label);
  }
  $('#frame-errors').textContent = state.frameErrors.join(' / ');
  renderSettings();
  renderDisplay();
  renderPrinters();
}

// 촬영 설정 (− / + 버튼)
const SETTING_ROWS = [
  ['countdown', '첫 장 카운트다운', '초', 1, 20],
  ['nextCountdown', '다음 장 카운트다운', '초', 1, 20],
  ['extraShots', '보너스 컷 (칸 수보다 더 찍기)', '장', 0, 6],
  ['crop', '카메라 가장자리 자르기', '%', 0, 25],
];
// [키, 이름, 단위, 최소, 최대, 한 번에 바뀌는 양]
const COLOR_ROWS = [
  ['brightness', '밝기', '', -40, 40, 5],
  ['contrast', '대비', '', -40, 40, 5],
  ['saturation', '채도 (색 진하기)', '', -60, 60, 10],
  ['warmth', '따뜻하게 (노란 톤)', '', 0, 40, 5],
];
function renderSettings() {
  renderRows($('#admin-settings'), SETTING_ROWS);
  renderRows($('#admin-color'), COLOR_ROWS);
}
function renderRows(wrap, rows) {
  wrap.innerHTML = '';
  for (const [key, label, unit, min, max, step = 1] of rows) {
    const row = document.createElement('div');
    row.className = 'setting-row';
    row.innerHTML = `<span></span><div class="mini-stepper"><button class="btn">−</button><b></b><button class="btn">+</button></div>`;
    row.querySelector('span').textContent = label;
    const [minus, plus] = row.querySelectorAll('button');
    const render = () => {
      const v = settings[key];
      row.querySelector('b').textContent = step > 1 && v > 0 ? `+${v}` : `${v}${unit}`;
      minus.disabled = settings[key] <= min;
      plus.disabled = settings[key] >= max;
    };
    const change = (d) => {
      settings[key] = Math.min(max, Math.max(min, settings[key] + d));
      store.set(key, settings[key]);
      if (key === 'crop') applyCrop();
      applyFilter();
      render();
    };
    minus.addEventListener('click', () => change(-step));
    plus.addEventListener('click', () => change(step));
    render();
    wrap.append(row);
  }
}

// 화면: 전체화면 / 창 모드 / 띄울 모니터 고르기 (모니터 선택은 Chrome·Edge의 창 관리 권한 사용)
const screenKey = (s) => `${s.left},${s.top},${s.width},${s.height}`;

async function goFullscreen(screen) {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    await document.documentElement.requestFullscreen(screen ? { screen, navigationUI: 'hide' } : { navigationUI: 'hide' });
  } catch (e) {
    toast('전체화면으로 바꾸지 못했어요: ' + e.message);
  }
}

function renderDisplay() {
  $('#display-state').textContent = document.fullscreenElement ? '지금: 전체화면' : '지금: 창 모드';
  const list = $('#screen-list');
  if (!('getScreenDetails' in window)) {
    list.innerHTML = '<p class="small">이 브라우저는 모니터 선택을 지원하지 않아요. 창 모드로 바꾼 뒤 창을 원하는 모니터로 끌어다 놓고 전체화면을 누르세요.</p>';
  }
}

$('#fullscreen-btn').addEventListener('click', async () => {
  store.set('display', 'fullscreen');
  await goFullscreen(null);
  renderDisplay();
});
$('#window-btn').addEventListener('click', async () => {
  store.set('display', 'window');
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  renderDisplay();
  toast('창 모드예요. 창을 원하는 모니터로 옮길 수 있어요');
});
$('#screens-btn').addEventListener('click', async () => {
  const list = $('#screen-list');
  try {
    const details = await window.getScreenDetails();
    list.innerHTML = '';
    details.screens.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = `${i + 1}번 모니터 · ${s.width}×${s.height}${s.isPrimary ? ' (주 모니터)' : ''}${s === details.currentScreen ? ' · 지금 여기' : ''}`;
      b.addEventListener('click', async () => {
        store.set('screen', screenKey(s));
        store.set('display', 'fullscreen');
        await goFullscreen(s);
        renderDisplay();
      });
      list.append(b);
    });
  } catch (e) {
    list.innerHTML = '<p class="small error">모니터 목록을 불러오지 못했어요. 창 관리 권한을 허용해 주세요.</p>';
  }
});
document.addEventListener('fullscreenchange', () => !$('#admin').hidden && renderDisplay());

// 프로그램은 창으로 열리고, 첫 터치 때 저장된 방식(기본: 전체화면)으로 바뀐다.
// 브라우저는 터치·클릭이 있어야 전체화면을 허락한다. 새로고침 뒤에도 첫 터치에 다시 적용된다.
document.addEventListener('pointerdown', async () => {
  if (document.fullscreenElement || store.get('display', 'fullscreen') !== 'fullscreen') return;
  let target = null;
  const saved = store.get('screen', '');
  if (saved && 'getScreenDetails' in window) {
    try {
      const details = await window.getScreenDetails();
      target = details.screens.find((s) => screenKey(s) === saved) || null;
    } catch {}
  }
  await goFullscreen(target);
}, true);

$('#camera-select').addEventListener('change', async (e) => {
  state.cameraId = e.target.value;
  store.set('cameraId', state.cameraId);
  await startCamera().catch((err) => toast('카메라 오류: ' + err.message));
});
$('#camera-res').addEventListener('change', async (e) => {
  store.set('cameraRes', e.target.value);
  await startCamera().catch((err) => toast('카메라 오류: ' + err.message));
});
$('#bars-check').addEventListener('change', (e) => {
  state.autoBars = e.target.checked;
  store.set('autoBars', state.autoBars);
  detectBars();
  toast(state.autoBars ? '검은 띠가 있으면 자동으로 잘라내요' : '카메라 화면을 자르지 않고 그대로 써요');
});
$('#sound-check').addEventListener('change', (e) => {
  state.sound = e.target.checked;
  store.set('sound', state.sound);
  if (state.sound) shutterSound(); // 켜면 바로 한 번 들려 준다
});
$('#mirror-check').addEventListener('change', (e) => {
  state.mirror = e.target.checked;
  store.set('mirror', state.mirror);
});
$('#reload').addEventListener('click', () => location.reload());

// 카메라 화면 테스트: 실제로 찍히는 영역을 그대로 보여 준다 (좌우 반전·검은 띠·가장자리 자르기·색감 보정 모두 반영)
let camTest = false;
function setCamTest(on) {
  camTest = on;
  $('#cam-test-wrap').hidden = !on;
  $('#cam-test-info').hidden = !on;
  $('#cam-test-btn').textContent = on ? '테스트 끄기' : '카메라 화면 테스트';
  if (on) requestAnimationFrame(drawCamTest);
}
function drawCamTest() {
  if (!camTest) return;
  if ($('#admin').hidden) return setCamTest(false); // 관리자 메뉴를 닫으면 같이 끈다
  const r = camRect();
  if (video.videoWidth && r.w > 0) {
    const c = $('#cam-test');
    const w = 960;
    const h = Math.round((w * r.h) / r.w);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext('2d');
    g.save();
    if (state.mirror) { g.translate(w, 0); g.scale(-1, 1); }
    g.filter = camFilter();
    g.drawImage(video, r.ox, r.oy, r.w, r.h, 0, 0, w, h);
    g.restore();
    const cut = bars.left || bars.right ? ` · 양옆 검은 띠 ${bars.left}+${bars.right}px 잘라냄` : '';
    $('#cam-test-info').textContent = `찍히는 영역 ${r.w}×${r.h} (카메라 원본 ${video.videoWidth}×${video.videoHeight})${cut}`;
  }
  requestAnimationFrame(drawCamTest);
}
$('#cam-test-btn').addEventListener('click', async () => {
  if (camTest) return setCamTest(false);
  if (!video.videoWidth) {
    try { await startCamera(); } catch (e) { return toast('카메라를 열지 못했어요: ' + e.message, 6000); }
  }
  detectBars();
  setCamTest(true);
});
// 현황 초기화: 실수로 누르지 않게 3초 안에 한 번 더 눌러야 지운다
let resetArmed = 0;
$('#stats-reset').addEventListener('click', (e) => {
  if (Date.now() - resetArmed > 3000) {
    resetArmed = Date.now();
    e.target.textContent = '한 번 더 누르면 초기화';
    setTimeout(() => { e.target.textContent = '현황 초기화'; }, 3000);
    return;
  }
  resetArmed = 0;
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('booth.stats.')).forEach((k) => localStorage.removeItem(k));
  } catch {}
  e.target.textContent = '현황 초기화';
  renderAdmin();
  toast('현황을 0으로 초기화했어요');
});
$('#test-print').addEventListener('click', async () => {
  const frame = activeFrames()[0] || state.frames[0];
  if (!frame) return toast('프레임이 없어요');
  try {
    await printSheet(composeSheet(frame, []), 1);
    toast('인쇄를 보냈어요');
    log('test_print');
  } catch (e) {
    reportError('test_print', e);
    toast(e.message, 6000);
  }
});

// 프린터: 고른 프린터를 이 PC의 기본 프린터로 정한다 (인쇄는 브라우저 인쇄로 기본 프린터에 나감)
async function renderPrinters() {
  const select = $('#printer-select');
  const note = $('#printer-note');
  let list = { printers: [], default: '' };
  try {
    list = await (await fetch('/api/printers')).json();
  } catch {
    note.textContent = '프린터 목록을 불러오지 못했어요 (서버 확인)';
    return;
  }
  select.innerHTML = '';
  if (!list.default) select.append(new Option('기본 프린터 없음 — 골라 주세요', ''));
  for (const name of list.printers) select.append(new Option(name + (name === list.default ? ' (지금 기본)' : ''), name));
  select.value = list.default;
  note.textContent = list.default
    ? `지금 '${list.default}'(으)로 인쇄돼요. 다른 프린터를 고르면 그 프린터가 이 PC의 기본 프린터가 돼요.`
    : '인쇄할 프린터를 고르세요.';
}
$('#printer-select').addEventListener('change', async (e) => {
  const name = e.target.value;
  if (!name) return;
  try {
    const r = await fetch(`/api/printer-default?printer=${encodeURIComponent(name)}`, { method: 'POST' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
    toast(`${name}을(를) 기본 프린터로 정했어요`);
  } catch (err) {
    toast('기본 프린터를 바꾸지 못했어요: ' + err.message, 6000);
  }
  renderPrinters();
});
$('#printer-refresh').addEventListener('click', renderPrinters);

// ───────── 시작 ─────────
async function init() {
  try {
    const { frames, errors } = await loadLocalFrames();
    state.frames = frames;
    state.frameErrors = errors;
    if (errors.length) toast('일부 프레임을 불러오지 못했어요 (관리자 메뉴 확인)', 6000);
  } catch (e) {
    reportError('frames', e);
    toast('프레임 목록을 불러오지 못했어요. 서버가 켜져 있는지 확인하세요', 8000);
  }
  // qrcode 스크립트(defer)가 늦게 올 수 있어 대기 화면은 load 후 한 번 더 그린다
  show('attract');
  window.addEventListener('load', () => state.screen === 'attract' && screenEnter.attract());
  startCamera().catch(() => toast('카메라를 찾지 못했어요. 연결을 확인해 주세요', 8000));
}

init();
