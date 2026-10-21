// Supabase 연동 (라이브러리 없이 REST로 직접 호출).
const C = window.BOOTH_CONFIG;

export const cloudEnabled = () => Boolean(C.supabaseUrl && C.supabaseAnonKey);

function headers(extra = {}) {
  const h = { apikey: C.supabaseAnonKey, ...extra };
  // 예전 형식(JWT) anon 키만 Authorization 헤더에 넣는다. sb_publishable_ 키는 apikey만으로 충분.
  if (C.supabaseAnonKey.startsWith('eyJ')) h.Authorization = 'Bearer ' + C.supabaseAnonKey;
  return h;
}

async function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(label + ' 시간 초과')), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(t);
  }
}

// 4자리 번호로 최근 커스텀 프레임 찾기. 없으면 null.
export async function fetchCustomFrame(code) {
  const since = new Date(Date.now() - C.customFrameMaxAgeHours * 3600e3).toISOString();
  const url = `${C.supabaseUrl}/rest/v1/custom_frames?select=*&code=eq.${encodeURIComponent(code)}` +
    `&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=1`;
  const res = await withTimeout(fetch(url, { headers: headers() }), 8000, '프레임 조회');
  if (!res.ok) throw new Error('프레임 조회 실패 (' + res.status + ')');
  const rows = await res.json();
  return rows[0] || null;
}

// 완성 사진 업로드 → 공개 URL
export async function uploadPhoto(blob, name) {
  const path = `${new Date().toISOString().slice(0, 10)}/${name}`;
  const res = await withTimeout(fetch(`${C.supabaseUrl}/storage/v1/object/photos/${path}`, {
    method: 'POST',
    headers: headers({ 'Content-Type': blob.type, 'x-upsert': 'false' }),
    body: blob,
  }), 30000, '사진 업로드');
  if (!res.ok) throw new Error('사진 업로드 실패 (' + res.status + ')');
  return `${C.supabaseUrl}/storage/v1/object/public/photos/${path}`;
}

// 다운로드 QR이 가리킬 주소. 에디터 사이트의 photo.html이 있으면 그쪽(저장 안내 포함).
export function downloadPageUrl(publicUrl) {
  if (!C.editorUrl) return publicUrl;
  const base = C.editorUrl.endsWith('/') ? C.editorUrl : C.editorUrl + '/';
  return base + 'photo.html#' + encodeURIComponent(publicUrl);
}
