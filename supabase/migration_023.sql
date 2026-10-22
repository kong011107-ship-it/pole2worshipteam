-- =====================================================================
-- migration_023 (v24) — 성찬 찬양 · 내 메모(악보 필기)
--  · services.communion : 그 주일 성찬식 여부 (비우면 자동: 첫째 주 주일)
--  · has_communion(예배) · communion_on(날짜)
--  · worship_proc 종류에 성찬 찬양 1 · 2 (communion · communion2) — 순서: 축복 → 성찬 1 · 2 → 봉헌 → 축도 (→ 등단)
--  · 성찬식이 없는 주일 · 사역에는 성찬 찬양을 보내지 않음. 목표 RT도 성찬식 여부를 따름
--  · set_communion(예배, 켬/끔/자동) : 리더십
--  · sheet_notes : 내 메모(획) — 회원 × 악보 × 쪽, 본인만 읽고 씀
-- 다시 실행해도 안전합니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 성찬식 여부
-- ---------------------------------------------------------------------
alter table public.services add column if not exists communion boolean;
comment on column public.services.communion is '성찬식 여부 (null = 자동: 첫째 주 주일)';

-- 그 예배에 성찬식이 있는지 (사역은 없음)
create or replace function public.has_communion(p_service uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select s.ministry_id is null and coalesce(s.communion, extract(day from s.service_date) <= 7)
                     from public.services s where s.id = p_service), false);
$$;

-- 그 날짜가 속한 주(그날~다가오는 주일)의 주일에 성찬식이 있는지 — 백업찬양 화면이 씀
create or replace function public.communion_on(p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with d as (select (coalesce(p_date, current_date) + ((7 - extract(dow from coalesce(p_date, current_date))::int) % 7))::date as sun)
  select coalesce((select coalesce(s.communion, extract(day from s.service_date) <= 7)
                     from public.services s, d where s.service_date = d.sun and s.ministry_id is null limit 1),
                  extract(day from (select sun from d)) <= 7);
$$;

-- 리더십: 이 주일 성찬식 켬 / 끔 / 자동(null)
create or replace function public.set_communion(p_service uuid, p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare s public.services;
begin
  if not public.is_admin() then raise exception '리더십만 바꿀 수 있어요' using errcode = '42501'; end if;
  select * into s from public.services where id = p_service;
  if not found then raise exception '예배를 찾을 수 없어요' using errcode = 'P0002'; end if;
  if s.ministry_id is not null then raise exception '사역 예배에는 성찬식을 정하지 않아요' using errcode = '22023'; end if;
  -- 자동과 같으면 비워 둠 (나중에 날짜 규칙을 따라감)
  update public.services set communion = case when p_on is null or p_on = (extract(day from service_date) <= 7) then null else p_on end
   where id = p_service;
  return public.has_communion(p_service);
end $$;

revoke all on function public.has_communion(uuid) from public, anon;
revoke all on function public.communion_on(date) from public, anon;
revoke all on function public.set_communion(uuid, boolean) from public, anon;
grant execute on function public.has_communion(uuid) to authenticated, service_role;
grant execute on function public.communion_on(date) to authenticated, service_role;
grant execute on function public.set_communion(uuid, boolean) to authenticated;


-- ---------------------------------------------------------------------
-- 2. 예배 진행곡: 성찬 찬양 1 · 2
-- ---------------------------------------------------------------------
do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'public.worship_proc'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%blessing%' loop
    execute format('alter table public.worship_proc drop constraint %I', c);
  end loop;
end $$;
alter table public.worship_proc add constraint worship_proc_kind_check
  check (kind in ('blessing', 'communion', 'communion2', 'offering', 'benediction', 'entrance'));

-- 그날 쓰는 예배 진행곡 — p_communion이 아니면 성찬 찬양을 뺌
create or replace function public.proc_list(p_date date, p_communion boolean)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.is_member() then null else coalesce((
    select json_agg(json_build_object('id', w.id, 'kind', w.kind, 'title', w.title, 'key', w.key, 'path', w.path, 'pages', w.pages,
                                      'images', w.images, 'start_date', w.start_date)
                    order by array_position(array['blessing', 'communion', 'communion2', 'offering', 'benediction', 'entrance'], w.kind))
      from (select distinct on (kind) * from public.worship_proc where start_date <= coalesce(p_date, current_date)
             order by kind, start_date desc, id desc) w
     where coalesce(p_communion, false) or w.kind not in ('communion', 'communion2')), '[]'::json) end;
$$;
-- 백업찬양 화면: 그 주 주일 성찬식을 따라감
create or replace function public.proc_on(p_date date)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select public.proc_list(p_date, public.communion_on(p_date));
$$;
revoke all on function public.proc_list(date, boolean) from public, anon;
revoke all on function public.proc_on(date) from public, anon;
grant execute on function public.proc_list(date, boolean) to authenticated;
grant execute on function public.proc_on(date) to authenticated;

-- 백업찬양 진행: 예배 진행곡 ref에 성찬 찬양
alter table public.backup_live drop constraint if exists backup_live_now_ref_check;
alter table public.backup_live drop constraint if exists backup_live_next_ref_check;
alter table public.backup_live add constraint backup_live_now_ref_check
  check (now_ref ~ '^(b:[0-9]+|p:(blessing|communion|communion2|offering|benediction|entrance))$');
alter table public.backup_live add constraint backup_live_next_ref_check
  check (next_ref ~ '^(b:[0-9]+|p:(blessing|communion|communion2|offering|benediction|entrance))$');


-- ---------------------------------------------------------------------
-- 3. 목표 RT: 성찬식 주일 · 나머지 주일 (설정 이름은 그대로 rt_first)
-- ---------------------------------------------------------------------
create or replace function public.conti_target(p_service uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sl.target_sec,
    case when s.ministry_id is null then
      case when public.has_communion(s.id) then coalesce((ts.conti ->> 'rt_first')::int, 1200)
           else coalesce((ts.conti ->> 'rt_other')::int, 1500) end end)
  from public.services s
  left join public.setlists sl on sl.service_id = s.id
  left join public.team_settings ts on ts.id = 1
  where s.id = p_service;
$$;


-- ---------------------------------------------------------------------
-- 4. 콘티 읽기: 성찬식 여부 · 성찬식이 있는 주만 성찬 찬양
-- ---------------------------------------------------------------------
create or replace function public.conti_one(p_service uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.is_member() then null else (
    select json_build_object(
      'id', s.id, 'date', s.service_date, 'ministry_id', s.ministry_id, 'ministry_name', mi.name, 'label', s.label,
      'start_time', s.start_time, 'end_time', s.end_time, 'published', s.status = 'published',
      'communion', public.has_communion(s.id), 'communion_set', s.communion,
      'can_edit', public.can_edit_conti(s.id), 'can_edit_sheets', public.can_edit_sheets(s.id),
      'can_applied', public.is_admin() or public.can_edit_conti(s.id),
      'deadline', public.conti_deadline(s.id), 'target_sec', public.conti_target(s.id),
      'practice_cancelled', s.ministry_id is null and coalesce((select practice_cancelled from public.team_meetings where meeting_date = s.service_date - 1), false),
      'lineup', coalesce((select json_agg(json_build_object('pos', a.position_code, 'slot', a.slot, 'member_id', a.member_id,
          'name', coalesce(m.name, g.name, a.former_name), 'guest', a.is_guest, 'sl', a.is_singer_leader, 'bm', a.is_band_master)
          order by p.sort_order, a.slot)
        from public.assignments a join public.positions p on p.code = a.position_code
        left join public.members m on m.id = a.member_id left join public.guests g on g.id = a.guest_id
        where a.service_id = s.id), '[]'::json),
      'applied', coalesce((select json_agg(json_build_object('id', x.id, 'ord', x.ord, 'title', x.title, 'key', x.key, 'note', x.note, 'images', x.images) order by x.ord, x.id)
        from public.applied_songs x where x.service_id = s.id), '[]'::json),
      'proc', public.proc_list(s.service_date, public.has_communion(s.id)),
      'setlist', (select json_build_object('id', sl.id, 'status', sl.status, 'version', sl.version, 'published_at', sl.published_at,
          'updated_at', sl.updated_at, 'target_sec', sl.target_sec, 'deadline', sl.deadline, 'pages', sl.pages, 'changes', sl.changes,
          'sheet_changes', sl.sheet_changes,
          'leaders', sl.leaders, 'updated_by', (select name from public.members where id = sl.updated_by),
          'items', coalesce((select json_agg(json_build_object('ord', i.ord, 'song_id', i.song_id, 'title', so.title, 'main_key', so.main_key,
              'team_sec', so.team_sec, 'key', i.key, 'medley', i.medley, 'refs', i.refs, 'duration_sec', i.duration_sec, 'duration_src', i.duration_src,
              'memo', i.memo, 'sheet_id', i.sheet_id, 'sheet_name', sv.name, 'sheet_pages', sv.pages, 'sheet_path', sv.path, 'sheet_kind', sv.kind,
              'page_from', i.page_from, 'page_to', i.page_to) order by i.ord)
            from public.setlist_items i join public.songs so on so.id = i.song_id left join public.sheet_versions sv on sv.id = i.sheet_id
            where i.setlist_id = sl.id), '[]'::json))
        from public.setlists sl where sl.service_id = s.id and (sl.status = 'published' or public.can_edit_conti(s.id)))
    ) from public.services s left join public.ministries mi on mi.id = s.ministry_id
    where s.id = p_service and (s.status = 'published' or public.is_admin())
  ) end;
$$;
revoke all on function public.conti_one(uuid) from public, anon;
grant execute on function public.conti_one(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 5. 내 메모 (악보 위 필기) — 나만 보기
--   key  s:<저장된 악보 id> · p:<예배 진행곡 id> · b:<백업찬양 코드>
--   page 그 악보 안에서 몇째 쪽 (통합본이 바뀌어도 이름 붙인 악보 기준이라 그대로)
--   ver  백업찬양: 악보집 id(판이 바뀌면 '이전 판 메모')
--   strokes [{t:'p'|'h', c:'#rrggbb', w:굵기, p:[x,y,…]}] — 좌표는 쪽 너비 = 10000 기준 정수 (여백은 음수 · 10000 넘음)
-- ---------------------------------------------------------------------
create table if not exists public.sheet_notes (
  member_id   uuid not null default auth.uid() references public.members(id) on delete cascade,
  key         text not null check (key ~ '^(s:[0-9]{1,12}|p:[0-9]{1,12}|b:[a-z0-9]{1,8})$'),
  page        smallint not null check (page between 1 and 200),
  ver         text check (length(ver) <= 40),
  song_id     bigint references public.songs(id) on delete set null,
  strokes     jsonb not null default '[]'::jsonb check (jsonb_typeof(strokes) = 'array' and pg_column_size(strokes) < 400000),
  updated_at  timestamptz not null default now(),
  primary key (member_id, key, page)
);
create index if not exists sheet_notes_song_idx on public.sheet_notes (member_id, song_id) where song_id is not null;
alter table public.sheet_notes enable row level security;
drop policy if exists sheet_notes_own on public.sheet_notes;
create policy sheet_notes_own on public.sheet_notes for all
  using (member_id = auth.uid())
  with check (member_id = auth.uid() and public.is_member());
grant select, insert, update, delete on public.sheet_notes to authenticated;
