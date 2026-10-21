// 포토부스 AI 프레임 생성 (Supabase Edge Function)
// 폰 에디터가 캐릭터 이름과 분위기를 보내면 Gemini 이미지 모델로 2×2 캐릭터 프레임을 그려서 돌려준다.
//
// 필요한 비밀 값 (Supabase 대시보드 → Edge Functions → Secrets):
//   GEMINI_API_KEY   Google AI Studio API 키 (결제 등록 필요)
// 선택:
//   GEMINI_MODEL     기본 gemini-nano-banana-2.1
//   DAILY_LIMIT      하루 최대 생성 수, 기본 300
//   GUIDE_URL        사진 칸 가이드 이미지 주소, 기본 https://srpphotobuth.netlify.app/ai-guide-2x2.png
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 는 Supabase가 자동으로 넣어 준다.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 요청문은 폰 에디터의 editor/ai-prompt.js 와 같은 내용 (첨부한 가이드 그림 안내만 추가)
const buildPrompt = (name: string, mood: string) => `"${name}" 캐릭터로 네컷 사진(포토부스) 프레임 이미지를 한 장 그려줘.
첨부한 그림은 "가이드 이미지"(사진 칸 위치)야. 회색 칸 위치와 크기를 그대로 지키고, 가이드의 점선·글자는 그리지 마.

[먼저 검색]
- 그리기 전에 생김새 기준이 될 그림을 아래 순서로 검색해. 앞의 것이 없으면 다음 것으로 넘어가:
  1) "${name} 카카오 이모티콘" (이모티콘 스토어 그림이 가장 정확)
  2) "${name} 공식 이미지" 또는 공식 홈페이지·공식 SNS·공식 굿즈 그림
  3) 원작(애니메이션·게임·웹툰·책) 속 장면
- 팬아트나 다른 사람이 따라 그린 그림은 기준으로 쓰지 마.
- 검색해도 이 캐릭터를 찾을 수 없으면 지어내서 그리지 말고, "이 캐릭터를 찾지 못했어요"라고만 답해.
- 그다음 "${name} 네컷 프레임", "${name} 포토이즘 인생네컷 콜라보 프레임"도 검색해.
- 검색해서 나온 실제 ${name} 콜라보 네컷 프레임들의 구성(캐릭터 배치, 칸 주변 꾸밈, 색감, 분위기)을 참고해서 비슷한 느낌으로 만들어. 콜라보 프레임이 없는 캐릭터면 기준 그림의 색감과 분위기에 맞춰 만들어.

[캐릭터 - 변형 금지]
- 캐릭터는 위에서 찾은 기준 그림 속 모습 그대로 그려: 얼굴 생김새, 눈·코·입 모양, 몸 비율, 선 굵기, 색을 똑같이.
- 재해석, 다른 화풍, 새 디자인, 다른 동물·다른 캐릭터처럼 보이게 바꾸는 것 모두 금지. 기준 그림에 실제로 있는 포즈·표정을 골라서 그대로 따라 그려.
- 캐릭터는 그림 전체에서 딱 5번만 그려: 사진 칸 4개마다 하나씩 칸 모서리에 걸치게 (4번, 칸마다 꼭 하나씩, 빠지는 칸 없이) + 맨 아래 이름 글자 옆에 크게 1번. 이보다 많거나 적게 그리지 마.

[글자]
- 맨 아래 여백에 캐릭터 이름 로고 글자를 크고 귀엽게 넣어 (예: "가나디 GANADI"처럼 한글 이름 + 영문 이름). 검색한 콜라보 프레임의 로고 느낌을 참고해.
- 원작 말투로 된 짧은 문구 하나 (10자 이내)를 이름 근처에 넣어.
- 글자는 맞춤법 그대로 정확하게, 사진 칸 안에는 글자를 넣지 마.

[분위기]
${mood || '캐릭터에 어울리게 귀엽고 밝게'}

[그림 규칙 - 반드시 지킬 것]
1. 세로로 긴 2:3 비율 한 장. 가로 1200 × 세로 1800 픽셀 캔버스라고 생각하고 그려.
2. 사진 칸 4개를 2×2로 배치하고, 칸 안은 순수한 마젠타색(#FF00FF) 단색으로 꽉 채워. (마젠타는 사진이 들어갈 자리 표시야. 나중에 프로그램이 지운다)
3. 4칸은 모두 똑같은 크기의 반듯한 직사각형. 위의 두 칸은 윗변과 아랫변 높이가 서로 같고, 아래 두 칸도 같아. 위치는 정확히 (1200×1800 픽셀 기준, 괄호는 그림 전체 대비 %):
   - 왼쪽 위: x 50~585, y 60~800 (가로 4.2~48.8%, 세로 3.3~44.4%)
   - 오른쪽 위: x 615~1150, y 60~800 (가로 51.3~95.8%, 세로 3.3~44.4%)
   - 왼쪽 아래: x 50~585, y 830~1570 (가로 4.2~48.8%, 세로 46.1~87.2%)
   - 오른쪽 아래: x 615~1150, y 830~1570 (가로 51.3~95.8%, 세로 46.1~87.2%)
   - 칸 하나는 가로 535 × 세로 740, 칸 사이 간격 30. 맨 아래 230픽셀(13%)이 캐릭터 이름 글자와 큰 캐릭터 자리.
4. 캐릭터가 칸 가장자리에 걸치거나 칸 안으로 들어와도 괜찮아. 그래도 칸 자체의 모양과 크기는 위 좌표 그대로 유지하고, 캐릭터가 없는 칸 부분은 전부 마젠타로 남겨.
5. 하트·별·반짝이·구름·꽃 같은 장식과 말풍선은 [분위기]에서 따로 요청한 경우에만 넣어.
6. 칸 바깥 배경은 분위기에 어울리는 부드러운 단색이나 연한 패턴. 마젠타나 비슷한 진한 자홍색은 칸에만 쓰고 다른 곳에는 쓰지 마.
7. 배경을 투명하게 하거나 체크무늬(투명 표시)를 그리지 마.
8. 실존 인물의 얼굴은 그리지 마. 폭력적·선정적 내용 금지.
9. 설명은 짧게 하고 반드시 이미지를 생성해서 보여줘.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function todayCount(): Promise<number> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const since = new Date();
  since.setUTCHours(since.getUTCHours() - 24);
  const res = await fetch(`${url}/rest/v1/ai_generations?select=id&created_at=gte.${since.toISOString()}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact', Range: '0-0' },
  });
  const range = res.headers.get('content-range') || '*/0'; // 예: 0-0/123
  return Number(range.split('/')[1]) || 0;
}

async function recordGeneration(mood: string) {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  await fetch(`${url}/rest/v1/ai_generations`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ mood: mood.slice(0, 100) }),
  });
}

async function guideBase64(): Promise<string> {
  const url = Deno.env.get('GUIDE_URL') || 'https://srpphotobuth.netlify.app/ai-guide-2x2.png';
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

// 응답에서 그림 꺼내기 (output_image 또는 steps 안의 image 블록)
// deno-lint-ignore no-explicit-any
function pickImage(data: any): { data: string; mime: string } | null {
  if (data?.output_image?.data) return { data: data.output_image.data, mime: data.output_image.mime_type || 'image/png' };
  for (const step of data?.steps || []) {
    for (const block of step?.content || []) {
      if (block?.type === 'image' && block.data) return { data: block.data, mime: block.mime_type || 'image/png' };
    }
  }
  return null;
}

async function callGemini(input: unknown[], aspect: string | null) {
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-nano-banana-2.1';
  const response_format: Record<string, string> = { type: 'image', image_size: '1K' };
  if (aspect) response_format.aspect_ratio = aspect;
  return await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': Deno.env.get('GEMINI_API_KEY')! },
    body: JSON.stringify({ model, input, response_format }),
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (!Deno.env.get('GEMINI_API_KEY')) return json({ error: 'no_key', message: 'GEMINI_API_KEY가 설정되지 않았어요' }, 500);

  let body: { characterName?: string; mood?: string };
  try { body = await req.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const name = String(body.characterName || '').trim().slice(0, 40);
  const mood = String(body.mood || '').slice(0, 100);
  if (!name) return json({ error: 'no_name', message: '캐릭터 이름을 써 주세요' }, 400);

  const limit = Number(Deno.env.get('DAILY_LIMIT') || 300);
  if (await todayCount() >= limit) return json({ error: 'daily_limit', message: '오늘 AI 생성 한도를 다 썼어요. 직접 꾸미기를 이용해 주세요' }, 429);

  const input: unknown[] = [
    { type: 'text', text: buildPrompt(name, mood) },
    { type: 'image', mime_type: 'image/png', data: await guideBase64() },
  ];

  // 2:3 비율을 지원하지 않는 모델이면 비율 없이 다시 시도 (에디터가 2:3으로 맞춰 자른다)
  let res = await callGemini(input, '2:3');
  if (res.status === 400) res = await callGemini(input, null);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('gemini error', res.status, JSON.stringify(data).slice(0, 500));
    return json({ error: 'gemini', status: res.status, message: 'AI가 그림을 만들지 못했어요. 잠시 후 다시 시도해 주세요' }, 502);
  }
  const image = pickImage(data);
  if (!image) return json({ error: 'no_image', message: 'AI가 그림 대신 글로 답했어요. 다시 시도해 주세요' }, 502);

  await recordGeneration(`${name} / ${mood}`);
  return json({ image: image.data, mime: image.mime });
});
