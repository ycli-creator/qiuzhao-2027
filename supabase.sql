-- 在 Supabase Dashboard → SQL Editor 里整段执行一次。

create table if not exists public.qiuzhao_progress (
  who text primary key,
  status jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.qiuzhao_progress enable row level security;

drop policy if exists "qiuzhao_progress_read" on public.qiuzhao_progress;
drop policy if exists "qiuzhao_progress_insert" on public.qiuzhao_progress;
drop policy if exists "qiuzhao_progress_update" on public.qiuzhao_progress;

create policy "qiuzhao_progress_read"
  on public.qiuzhao_progress for select
  to anon, authenticated
  using (true);

create policy "qiuzhao_progress_insert"
  on public.qiuzhao_progress for insert
  to anon, authenticated
  with check (true);

create policy "qiuzhao_progress_update"
  on public.qiuzhao_progress for update
  to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update on public.qiuzhao_progress to anon, authenticated;
