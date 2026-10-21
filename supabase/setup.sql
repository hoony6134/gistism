-- 포토부스 Supabase 설정
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run 한 번.

-- 1) 폰에서 만든 커스텀 프레임
create table if not exists public.custom_frames (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[0-9]{4}$'),
  overlay_url text not null,
  slots jsonb not null,
  size jsonb not null default '[600, 1800]',
  created_at timestamptz not null default now()
);
create index if not exists custom_frames_code_idx on public.custom_frames (code, created_at desc);

alter table public.custom_frames enable row level security;

drop policy if exists "누구나 프레임 등록" on public.custom_frames;
create policy "누구나 프레임 등록" on public.custom_frames
  for insert to anon with check (true);

drop policy if exists "누구나 프레임 조회" on public.custom_frames;
create policy "누구나 프레임 조회" on public.custom_frames
  for select to anon using (true);

-- 2) 파일 저장소: frames(프레임 PNG), photos(완성 사진 JPG). 공개 읽기, 크기·형식 제한.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('frames', 'frames', true, 5242880, array['image/png']),
  ('photos', 'photos', true, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "포토부스 업로드" on storage.objects;
create policy "포토부스 업로드" on storage.objects
  for insert to anon with check (bucket_id in ('frames', 'photos'));

-- 3) 행사가 끝나면: 대시보드 → Storage 에서 frames, photos 버킷을 비우고 아래를 실행
-- delete from public.custom_frames;
