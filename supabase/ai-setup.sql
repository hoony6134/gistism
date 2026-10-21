-- AI 프레임 자동 생성용 추가 설정
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run 한 번.

-- 생성 기록 (하루 생성 한도를 세는 용도). 서버 함수만 쓰므로 공개 접근 정책은 만들지 않는다.
create table if not exists public.ai_generations (
  id bigserial primary key,
  mood text,
  created_at timestamptz not null default now()
);
create index if not exists ai_generations_created_idx on public.ai_generations (created_at);
alter table public.ai_generations enable row level security;
