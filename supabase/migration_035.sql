-- =====================================================================
--  035 — v36
--  1. 파트 악보: 본 콘티 곡 말고 예배 진행곡(축복송 · 성찬 · 봉헌송 · 축도송 · 등단송) · 특별순서에도
--     · part_sheets / part_picks 에 proc_id(worship_proc) · extra_id(service_extras) — 셋 중 하나만
--     · 파일 자리: parts/<곡 id>/ · parts/p<진행곡 id>/ · parts/x<특별순서 id>/
--  2. 익명 기도제목: prayers.anon — 팀원에게는 누구 것인지(member_id · author_id) 안 보여요. 리더십 · 올린 사람 · 그 사람 본인만
--     · 팀원은 표에서 member_id · author_id 칸을 직접 읽을 수 없어요 → prayer_rows(시작 주) 함수로 읽어요
--  3. 양육 출석 등급: nurture_grades(팀원마다 A~E) · nurture_sync(마지막 가져온 결과) — 리더십만 읽어요
--     · 쓰기는 서버(api/members-bulk 'nurture-sync' · api/cron 새벽)만
--  다시 돌려도 괜찮아요.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 파트 악보 — 진행곡 · 특별순서
-- ---------------------------------------------------------------------
alter table public.part_sheets alter column song_id drop not null;
alter table public.part_sheets add column if not exists proc_id bigint references public.worship_proc(id) on delete cascade;
alter table public.part_sheets add column if not exists extra_id bigint references public.service_extras(id) on delete cascade;
alter table public.part_sheets drop constraint if exists part_sheets_path_check;
alter table public.part_sheets drop constraint if exists part_sheets_check;
alter table public.part_sheets drop constraint if exists part_sheets_target_check;
alter table public.part_sheets add constraint part_sheets_target_check check (
  num_nonnulls(song_id, proc_id, extra_id) = 1
  and path ~ '^parts/[px]?[0-9]+/[0-9a-f-]{36}\.pdf$'
  and path like 'parts/' || coalesce(song_id::text, 'p' || proc_id::text, 'x' || extra_id::text) || '/%');
create index if not exists part_sheets_proc_idx on public.part_sheets (proc_id) where proc_id is not null;
create index if not exists part_sheets_extra_idx on public.part_sheets (extra_id) where extra_id is not null;

create or replace function public.part_sheets_fill()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.name := trim(new.name);
  new.key := nullif(trim(coalesce(new.key, '')), '');
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.by_name := left((select name from public.members where id = auth.uid()), 30);
    new.created_at := now();
  else
    new.created_by := old.created_by; new.by_name := old.by_name; new.created_at := old.created_at;
    new.song_id := old.song_id; new.proc_id := old.proc_id; new.extra_id := old.extra_id;
    new.path := old.path; new.part := old.part;
  end if;
  return new;
end;
$$;

-- 예배마다 내가 고른 파트 악보: 곡 · 진행곡 · 특별순서 (tgt = s:곡 · p:진행곡 · x:특별순서)
alter table public.part_picks add column if not exists proc_id bigint references public.worship_proc(id) on delete cascade;
alter table public.part_picks add column if not exists extra_id bigint references public.service_extras(id) on delete cascade;
alter table public.part_picks add column if not exists tgt text generated always as
  (coalesce('s:' || song_id::text, 'p:' || proc_id::text, 'x:' || extra_id::text)) stored;
alter table public.part_picks drop constraint if exists part_picks_pkey;
alter table public.part_picks alter column song_id drop not null;
alter table public.part_picks drop constraint if exists part_picks_target_check;
alter table public.part_picks add constraint part_picks_target_check check (num_nonnulls(song_id, proc_id, extra_id) = 1);
alter table public.part_picks add constraint part_picks_pkey primary key (member_id, service_id, tgt);

-- Storage 올리기: parts/<곡>/ · parts/p<진행곡>/ · parts/x<특별순서>/ (그 포지션 확인은 표에 넣을 때)
create or replace function public.can_upload_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_name ~ '^(sheets|originals)/' then public.can_upload_sheet()
    when p_name ~ '^(book|proc)/' then public.is_admin()
    when p_name ~ '^backup/' then public.can_lead_backup()
    when p_name ~ '^applied/[0-9a-f-]{36}/' then public.is_admin() or public.can_edit_conti(substring(p_name from 9 for 36)::uuid)
    when p_name ~ '^extra/[0-9a-f-]{36}/' then public.can_edit_conti(substring(p_name from 7 for 36)::uuid)
    when p_name ~ '^parts/[px]?[0-9]+/[0-9a-f-]{36}\.pdf$' then public.is_member() and cardinality(public.my_parts()) > 0
    else false end;
$$;
revoke all on function public.can_upload_object(text) from public, anon;
grant execute on function public.can_upload_object(text) to authenticated;


-- ---------------------------------------------------------------------
-- 2. 익명 기도제목
-- ---------------------------------------------------------------------
alter table public.prayers add column if not exists anon boolean not null default false;

-- 올린 뒤에 익명 ↔ 이름 바꾸기는 막아요 (이름이 한 번 보였으면 되돌릴 수 없으니 지우고 다시 올리기)
create or replace function public.prayers_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.body := trim(new.body);
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.members where id = new.member_id and is_active) then
      raise exception '활동 중인 팀원의 기도제목만 올릴 수 있어요.';
    end if;
    new.week_of := public.prayer_week(now());
    new.created_at := now();
    new.hidden_at := null;
    new.hidden_by := null;
    if auth.uid() is not null then new.author_id := auth.uid(); end if;
  else
    if new.member_id is distinct from old.member_id or new.author_id is distinct from old.author_id
       or new.week_of is distinct from old.week_of or new.created_at is distinct from old.created_at then
      raise exception '기도제목의 사람·주간은 바꿀 수 없어요. 지우고 다시 올려 주세요.';
    end if;
    if new.anon is distinct from old.anon then
      raise exception '익명 여부는 바꿀 수 없어요. 지우고 다시 올려 주세요.';
    end if;
    if new.hidden_at is distinct from old.hidden_at then
      if auth.uid() is not null and not public.is_admin() then
        raise exception '기도제목 숨기기는 리더십만 할 수 있어요.';
      end if;
      new.hidden_by := case when new.hidden_at is null then null else coalesce(auth.uid(), new.hidden_by) end;
      return new;   -- 숨기기·복원은 내용 수정 시간을 바꾸지 않음
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- 팀원은 누구 것인지 칸(member_id · author_id · hidden_by)을 표에서 직접 못 읽어요 → prayer_rows로
revoke select on public.prayers from anon, authenticated;
grant select (id, body, urgent, week_of, created_at, updated_at, hidden_at, anon) on public.prayers to authenticated;

-- 기도제목 목록: 익명이면 리더십 · 올린 사람 · 그 사람 본인이 아닌 한 member_id · author_id를 비워요
--  숨긴 것은 리더십만 · mine = 내가 올렸거나 내 기도제목
create or replace function public.prayer_rows(p_from date default null)
returns table (id bigint, member_id uuid, author_id uuid, body text, urgent boolean, week_of date, created_at timestamptz,
               updated_at timestamptz, hidden_at timestamptz, hidden_by uuid, anon boolean, mine boolean)
language sql
stable
security definer
set search_path = public
as $$
  with v as (select auth.uid() as me, public.is_admin() as adm, public.is_member() as mem)
  select p.id,
         case when not p.anon or v.adm or p.author_id = v.me or p.member_id = v.me then p.member_id end,
         case when not p.anon or v.adm or p.author_id = v.me or p.member_id = v.me then p.author_id end,
         p.body, p.urgent, p.week_of, p.created_at, p.updated_at, p.hidden_at,
         case when v.adm then p.hidden_by end, p.anon,
         (p.author_id = v.me or p.member_id = v.me)
    from public.prayers p, v
   where v.mem and (p_from is null or p.week_of >= p_from) and (p.hidden_at is null or v.adm)
   order by p.created_at;
$$;
revoke all on function public.prayer_rows(date) from public, anon;
grant execute on function public.prayer_rows(date) to authenticated;


-- ---------------------------------------------------------------------
-- 3. 양육 출석 등급 (폴투 양육 플랫폼 → 전화번호로 맞춰서)
-- ---------------------------------------------------------------------
create table if not exists public.nurture_grades (
  member_id   uuid primary key references public.members(id) on delete cascade,
  grade       text not null check (grade in ('A', 'B', 'C', 'D', 'E')),
  prev_grade  text check (prev_grade in ('A', 'B', 'C', 'D', 'E')),
  changed_at  timestamptz,           -- 등급이 바뀐 때 (처음 가져온 때 포함)
  synced_at   timestamptz not null default now()
);
alter table public.nurture_grades enable row level security;
drop policy if exists nurture_grades_read on public.nurture_grades;
create policy nurture_grades_read on public.nurture_grades for select using (public.is_admin());
revoke all on public.nurture_grades from anon, authenticated;
grant select on public.nurture_grades to authenticated;

-- 마지막으로 가져온 결과 (한 줄)
create table if not exists public.nurture_sync (
  id          smallint primary key default 1 check (id = 1),
  synced_at   timestamptz,
  ok          boolean,
  matched     int,
  missing     jsonb,                 -- 양육 명단에서 못 찾은 팀원 [{ id, name }]
  error       text,
  by_name     text                   -- 누가 눌렀는지 (새벽 자동이면 비움)
);
alter table public.nurture_sync enable row level security;
drop policy if exists nurture_sync_read on public.nurture_sync;
create policy nurture_sync_read on public.nurture_sync for select using (public.is_admin());
revoke all on public.nurture_sync from anon, authenticated;
grant select on public.nurture_sync to authenticated;

-- 확인: select count(*) from nurture_grades;  select * from prayer_rows(current_date - 7);
