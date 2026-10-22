-- =====================================================================
--  021 — v22: 콘티 작성 · 악보 보기 · RT · 마감 알림 · 악보 저장
--  · setlists       : 플랫폼에서 쓰는 콘티는 예배(services)마다 한 줄 — 임시 저장(draft) / 올림(published)
--                     마감(deadline) · 목표 RT(target_sec)는 비우면 기본값 (주일: 수요일 22시 · 첫째 주 20분, 나머지 25분)
--                     다시 올릴 때마다 version +1, 바뀐 것(changes)을 남기고 이전 버전은 setlist_versions에 보관
--  · setlist_items  : 곡마다 악보(sheet_id) · 통합본에서 몇 쪽부터 몇 쪽(page_from · page_to) · 곡 시간 · 메모
--  · sheet_versions : 곡별 악보 — 콘티 통합본에서 잘라 이름을 붙여 저장한 것(sheet) · 필기 없는 원본(original)
--                     파일은 Storage 'sheets' 버킷 (sheets/곡/uuid.pdf · originals/곡/uuid.pdf)
--  · songs.team_sec : 팀 기준 곡 시간 (인도자가 콘티에서 직접 고친 값)
--  · yt_videos · song_refs : 레퍼런스 영상 길이 · 곡마다 쓸 구간
--  · 고칠 수 있는 사람: 그 예배 인도자 · 밴드 마스터 · 리더십 (can_edit_conti)
--  · 알림: 콘티 올라옴 · 수정됨(섬김자) · 콘티 안내(전주 · 인도자) · 콘티 독촉(마감 전날 · 당일)
--  migration_020 다음에 SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 괜찮아요.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 곡 시간 · 레퍼런스
-- ---------------------------------------------------------------------
alter table public.songs
  add column if not exists team_sec int check (team_sec between 10 and 1800);

create table if not exists public.yt_videos (
  id            text primary key check (id ~ '^[A-Za-z0-9_-]{11}$'),
  duration_sec  int check (duration_sec between 0 and 86400),
  title         text check (length(title) <= 200),
  fetched_at    timestamptz not null default now()
);

create table if not exists public.song_refs (
  song_id     bigint not null references public.songs(id) on delete cascade,
  youtube_id  text not null check (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  start_sec   int not null default 0 check (start_sec between 0 and 86400),
  end_sec     int check (end_sec between 1 and 86400),
  updated_at  timestamptz not null default now(),
  primary key (song_id, youtube_id),
  check (end_sec is null or end_sec > start_sec)
);


-- ---------------------------------------------------------------------
-- 2. 악보 (곡별)
-- ---------------------------------------------------------------------
create table if not exists public.sheet_versions (
  id          bigint generated always as identity primary key,
  song_id     bigint not null references public.songs(id) on delete cascade,
  kind        text not null default 'sheet' check (kind in ('sheet', 'original')),
  name        text not null check (length(trim(name)) between 1 and 60),
  key         text check (length(key) <= 12),
  pages       smallint not null check (pages between 1 and 40),
  path        text not null unique check (path ~ '^(sheets|originals)/[0-9]+/[0-9a-f-]{36}\.pdf$'),
  size_bytes  int check (size_bytes between 1 and 30000000),
  thumb       text check (length(thumb) <= 60000),
  setlist_id  bigint,
  created_by  uuid references public.members(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists sheet_versions_song_idx on public.sheet_versions (song_id, created_at desc);


-- ---------------------------------------------------------------------
-- 3. 콘티 (플랫폼)
-- ---------------------------------------------------------------------
alter table public.setlists drop constraint if exists setlists_service_date_key;

alter table public.setlists
  add column if not exists service_id       uuid unique references public.services(id) on delete cascade,
  add column if not exists status           text not null default 'published' check (status in ('draft', 'published')),
  add column if not exists version          int not null default 0,
  add column if not exists notified_version int not null default 0,
  add column if not exists published_at     timestamptz,
  add column if not exists updated_at       timestamptz,
  add column if not exists updated_by       uuid references public.members(id) on delete set null,
  add column if not exists target_sec       int check (target_sec between 60 and 7200),
  add column if not exists deadline         timestamptz,
  add column if not exists pages            smallint check (pages between 0 and 200),
  add column if not exists changes          jsonb;

create unique index if not exists setlists_import_date_uniq on public.setlists (service_date) where service_id is null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sheet_versions_setlist_fkey') then
    alter table public.sheet_versions add constraint sheet_versions_setlist_fkey
      foreign key (setlist_id) references public.setlists(id) on delete set null;
  end if;
end $$;

alter table public.setlist_items
  add column if not exists sheet_id      bigint references public.sheet_versions(id) on delete set null,
  add column if not exists page_from     smallint check (page_from between 1 and 200),
  add column if not exists page_to       smallint check (page_to between 1 and 200),
  add column if not exists duration_sec  int check (duration_sec between 0 and 3600),
  add column if not exists duration_src  text check (duration_src in ('manual', 'team', 'video')),
  add column if not exists memo          text check (length(memo) <= 200);

create table if not exists public.setlist_versions (
  setlist_id  bigint not null references public.setlists(id) on delete cascade,
  version     int not null,
  snapshot    jsonb not null,
  saved_at    timestamptz not null default now(),
  saved_by    uuid references public.members(id) on delete set null,
  primary key (setlist_id, version)
);

-- 콘티 설정 (비우면 기본값): {"deadline_dow":3,"deadline_hour":22,"rt_first":1200,"rt_other":1500,"min_days":3}
alter table public.team_settings
  add column if not exists conti jsonb;


-- ---------------------------------------------------------------------
-- 4. 권한 · 기본값
-- ---------------------------------------------------------------------
-- 그 예배 콘티를 고칠 수 있는 사람: 리더십 · 그 예배 인도자 · 밴드 마스터
create or replace function public.can_edit_conti(p_service uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1 from public.assignments a
     where a.service_id = p_service and a.member_id = auth.uid()
       and (a.position_code = 'leader' or a.is_band_master));
$$;

-- 악보를 올릴 수 있는 사람: 리더십 · 최근(2주 전부터) 예배의 인도자 · 밴드 마스터
create or replace function public.can_upload_sheet()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1 from public.assignments a join public.services s on s.id = a.service_id
     where a.member_id = auth.uid() and (a.position_code = 'leader' or a.is_band_master)
       and s.service_date >= current_date - 14);
$$;

-- 마감: 정해 둔 값 > 주일은 그 주 (설정 요일 · 시각, 기본 수 22시) > 사역은 (설정 일수, 기본 3일) 전 22시 — 한국 시간
create or replace function public.conti_deadline(p_service uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sl.deadline,
    case when s.ministry_id is null then
      ((s.service_date - ((7 - coalesce((ts.conti ->> 'deadline_dow')::int, 3)) % 7))
        + make_time(coalesce((ts.conti ->> 'deadline_hour')::int, 22), 0, 0)) at time zone 'Asia/Seoul'
    else ((s.service_date - coalesce((ts.conti ->> 'min_days')::int, 3)) + time '22:00') at time zone 'Asia/Seoul' end)
  from public.services s
  left join public.setlists sl on sl.service_id = s.id
  left join public.team_settings ts on ts.id = 1
  where s.id = p_service;
$$;

-- 목표 RT: 정해 둔 값 > 주일은 첫째 주(성찬식) 20분 · 나머지 25분 > 사역은 없음
create or replace function public.conti_target(p_service uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sl.target_sec,
    case when s.ministry_id is null then
      case when extract(day from s.service_date) <= 7 then coalesce((ts.conti ->> 'rt_first')::int, 1200)
           else coalesce((ts.conti ->> 'rt_other')::int, 1500) end end)
  from public.services s
  left join public.setlists sl on sl.service_id = s.id
  left join public.team_settings ts on ts.id = 1
  where s.id = p_service;
$$;

revoke all on function public.can_edit_conti(uuid) from public, anon;
revoke all on function public.can_upload_sheet() from public, anon;
revoke all on function public.conti_deadline(uuid) from public, anon;
revoke all on function public.conti_target(uuid) from public, anon;
grant execute on function public.can_edit_conti(uuid) to authenticated;
grant execute on function public.can_upload_sheet() to authenticated;
grant execute on function public.conti_deadline(uuid) to authenticated, service_role;
grant execute on function public.conti_target(uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 5. 읽기: 예배 한 개 · 기간 (팀원 찬양 탭 · 리더십 콘티 현황)
--    팀원: 공개된 예배와 올라온 콘티만. 고칠 수 있는 사람은 임시 저장한 콘티도
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
      'can_edit', public.can_edit_conti(s.id), 'deadline', public.conti_deadline(s.id), 'target_sec', public.conti_target(s.id),
      'lineup', coalesce((select json_agg(json_build_object('pos', a.position_code, 'slot', a.slot, 'member_id', a.member_id,
          'name', coalesce(m.name, g.name, a.former_name), 'guest', a.is_guest, 'sl', a.is_singer_leader, 'bm', a.is_band_master)
          order by p.sort_order, a.slot)
        from public.assignments a join public.positions p on p.code = a.position_code
        left join public.members m on m.id = a.member_id left join public.guests g on g.id = a.guest_id
        where a.service_id = s.id), '[]'::json),
      'setlist', (select json_build_object('id', sl.id, 'status', sl.status, 'version', sl.version, 'published_at', sl.published_at,
          'updated_at', sl.updated_at, 'target_sec', sl.target_sec, 'deadline', sl.deadline, 'pages', sl.pages, 'changes', sl.changes,
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

create or replace function public.conti_week(p_from date, p_to date)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.is_member() then null else coalesce((
    select json_agg(public.conti_one(s.id) order by s.service_date, s.start_time nulls first, s.sort_order)
      from public.services s
     where s.service_date between p_from and least(p_to, p_from + 120)
       and (s.status = 'published' or public.is_admin())), '[]'::json) end;
$$;

revoke all on function public.conti_one(uuid) from public, anon;
revoke all on function public.conti_week(date, date) from public, anon;
grant execute on function public.conti_one(uuid) to authenticated;
grant execute on function public.conti_week(date, date) to authenticated;

-- 곡들의 악보 목록 (쓴 횟수 · 누구 콘티 · 언제)
create or replace function public.song_sheets(p_songs bigint[])
returns json
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.is_member() then null else coalesce((
    select json_agg(json_build_object('id', v.id, 'song_id', v.song_id, 'kind', v.kind, 'name', v.name, 'key', v.key, 'pages', v.pages,
        'path', v.path, 'size_bytes', v.size_bytes, 'thumb', v.thumb, 'created_at', v.created_at,
        'by', (select name from public.members where id = v.created_by),
        'from_date', sl.service_date, 'from_leaders', sl.leaders,
        'used', (select count(*) from public.setlist_items i join public.setlists x on x.id = i.setlist_id where i.sheet_id = v.id and x.status = 'published'))
      order by v.kind desc, v.created_at desc)
      from public.sheet_versions v left join public.setlists sl on sl.id = v.setlist_id
     where v.song_id = any (p_songs)), '[]'::json) end;
$$;
revoke all on function public.song_sheets(bigint[]) from public, anon;
grant execute on function public.song_sheets(bigint[]) to authenticated;


-- ---------------------------------------------------------------------
-- 6. 쓰기
-- ---------------------------------------------------------------------
-- 새 곡 (콘티를 쓰는 사람도 곡 이름을 더할 수 있어요). 같은 곡(띄어쓰기 · 대소문자 무시)이 있으면 그 곡
create or replace function public.add_song(p_title text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare t text := trim(coalesce(p_title, '')); n text; sid bigint;
begin
  if not (public.is_admin() or public.can_upload_sheet()) then raise exception '곡은 리더십 · 인도자 · 밴드 마스터만 더할 수 있어요.'; end if;
  if length(t) < 1 or length(t) > 80 then raise exception '곡 이름을 1~80자로 적어 주세요.'; end if;
  n := lower(regexp_replace(t, '\s', '', 'g'));
  select id into sid from public.songs where norm = n;
  if sid is null then insert into public.songs (title) values (t) returning id into sid; end if;
  return sid;
end;
$$;

-- 원본 악보 올리기 (필기 없는 악보, 곡 상세)
create or replace function public.add_original_sheet(p_song bigint, p_key text, p_name text, p_path text, p_pages int, p_size int, p_thumb text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare sid bigint;
begin
  if not public.can_upload_sheet() then raise exception '악보는 리더십 · 인도자 · 밴드 마스터만 올릴 수 있어요.'; end if;
  if p_path !~ ('^originals/' || p_song || '/[0-9a-f-]{36}\.pdf$') then raise exception '악보 파일 경로가 올바르지 않아요.'; end if;
  insert into public.sheet_versions (song_id, kind, name, key, pages, path, size_bytes, thumb, created_by)
  values (p_song, 'original', left(coalesce(nullif(trim(p_name), ''), '원본 ' || coalesce(p_key, '')), 60), nullif(trim(p_key), ''), p_pages, p_path, p_size, p_thumb, auth.uid())
  returning id into sid;
  return sid;
end;
$$;

-- 악보 이름 바꾸기 · 지우기 (리더십 또는 올린 사람. 콘티에 쓰인 악보는 지우지 못해요)
create or replace function public.edit_sheet(p_id bigint, p_name text, p_delete boolean default false)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v public.sheet_versions;
begin
  select * into v from public.sheet_versions where id = p_id for update;
  if v.id is null then raise exception '악보를 찾을 수 없어요.'; end if;
  if not (public.is_admin() or v.created_by = auth.uid()) then raise exception '리더십이나 올린 사람만 고칠 수 있어요.'; end if;
  if p_delete then
    if exists (select 1 from public.setlist_items where sheet_id = v.id) then raise exception '콘티에 쓰인 악보는 지울 수 없어요.'; end if;
    delete from public.sheet_versions where id = v.id;
    return json_build_object('deleted', true, 'path', v.path);
  end if;
  update public.sheet_versions set name = left(trim(p_name), 60) where id = v.id;
  return json_build_object('ok', true);
end;
$$;

-- 콘티 저장 · 올리기
--   p_data = { target_sec, pages, items: [{ song_id, key, medley, refs, duration_sec, duration_src, memo,
--              sheet_id | new_sheet: { name, path, pages, size, thumb }, page_from, page_to, ref_range: { yt, start, end } }] }
--   p_base: 화면을 열 때의 version (그 사이 다른 사람이 고쳤으면 409)
--   p_publish: 올리기 (처음 올리면 '올라옴', 이미 올린 콘티를 다시 올리면 '수정됨' + 바뀐 것)
create or replace function public.save_setlist(p_service uuid, p_data jsonb, p_publish boolean, p_base int default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.services; sl public.setlists;
  it jsonb; i int := 0; sid bigint; ns jsonb; rr jsonb;
  names text[]; was_pub boolean; old_items jsonb; new_items jsonb;
  ch text[] := '{}'; keys bigint[] := '{}'; o jsonb; nw jsonb; t text; old_common bigint[]; new_common bigint[];
  n_items int;
begin
  if not public.can_edit_conti(p_service) then raise exception '이 예배의 콘티를 고칠 수 있는 사람이 아니에요. (인도자 · 밴드 마스터 · 리더십)'; end if;
  select * into s from public.services where id = p_service;
  if s.id is null then raise exception '예배를 찾을 수 없어요.'; end if;
  n_items := jsonb_array_length(coalesce(p_data -> 'items', '[]'::jsonb));
  if n_items > 30 then raise exception '곡은 30곡까지 넣을 수 있어요.'; end if;
  if p_publish and n_items = 0 then raise exception '곡을 하나 이상 넣어 주세요.'; end if;

  select * into sl from public.setlists where service_id = p_service for update;
  if sl.id is not null and p_base is not null and sl.version <> p_base then
    raise exception using errcode = 'PT409', message = '다른 사람이 먼저 이 콘티를 고쳤어요. 새로 불러온 뒤 다시 고쳐 주세요.',
      detail = json_build_object('version', sl.version, 'by', (select name from public.members where id = sl.updated_by))::text;
  end if;
  names := array(select coalesce(m.name, g.name, a.former_name) from public.assignments a
                   left join public.members m on m.id = a.member_id left join public.guests g on g.id = a.guest_id
                  where a.service_id = p_service and a.position_code = 'leader' order by a.slot);
  if sl.id is null then
    insert into public.setlists (service_date, service_id, leaders, source, status, version)
    values (s.service_date, s.id, names, 'platform', 'draft', 0) returning * into sl;
  end if;
  was_pub := sl.status = 'published';
  select coalesce(jsonb_agg(jsonb_build_object('song_id', i.song_id, 'title', so.title, 'key', i.key, 'sheet_id', i.sheet_id, 'page_from', i.page_from,
           'page_to', i.page_to, 'medley', i.medley, 'refs', i.refs, 'duration_sec', i.duration_sec, 'duration_src', i.duration_src, 'memo', i.memo) order by i.ord), '[]'::jsonb)
    into old_items from public.setlist_items i join public.songs so on so.id = i.song_id where i.setlist_id = sl.id;
  if was_pub and p_publish then
    insert into public.setlist_versions (setlist_id, version, snapshot, saved_by)
    values (sl.id, sl.version, jsonb_build_object('items', old_items, 'pages', sl.pages, 'target_sec', sl.target_sec, 'published_at', sl.published_at, 'updated_at', sl.updated_at), auth.uid())
    on conflict do nothing;
  end if;

  delete from public.setlist_items where setlist_id = sl.id;
  for it in select * from jsonb_array_elements(coalesce(p_data -> 'items', '[]'::jsonb)) loop
    i := i + 1;
    if not exists (select 1 from public.songs where id = (it ->> 'song_id')::bigint) then raise exception '곡을 찾을 수 없어요 (%번째).', i; end if;
    sid := nullif(it ->> 'sheet_id', '')::bigint;
    ns := it -> 'new_sheet';
    if ns is not null and jsonb_typeof(ns) = 'object' then
      if coalesce(ns ->> 'path', '') !~ ('^sheets/' || (it ->> 'song_id') || '/[0-9a-f-]{36}\.pdf$') then raise exception '악보 파일 경로가 올바르지 않아요.'; end if;
      insert into public.sheet_versions (song_id, kind, name, key, pages, path, size_bytes, thumb, created_by, setlist_id)
      values ((it ->> 'song_id')::bigint, 'sheet', left(coalesce(nullif(trim(ns ->> 'name'), ''), '악보'), 60), nullif(trim(it ->> 'key'), ''),
              (ns ->> 'pages')::int, ns ->> 'path', nullif(ns ->> 'size', '')::int, ns ->> 'thumb', auth.uid(), sl.id)
      on conflict (path) do update set name = excluded.name
      returning id into sid;
    end if;
    insert into public.setlist_items (setlist_id, ord, song_id, key, medley, refs, duration_sec, duration_src, memo, sheet_id, page_from, page_to)
    values (sl.id, i, (it ->> 'song_id')::bigint, nullif(trim(it ->> 'key'), ''), coalesce((it ->> 'medley')::boolean, false),
            case when jsonb_typeof(it -> 'refs') = 'array' then it -> 'refs' else '[]'::jsonb end,
            nullif(it ->> 'duration_sec', '')::int, nullif(it ->> 'duration_src', ''), nullif(trim(it ->> 'memo'), ''),
            sid, nullif(it ->> 'page_from', '')::int, nullif(it ->> 'page_to', '')::int);
    -- 직접 고친 곡 시간 = 다음부터 팀 기준
    if it ->> 'duration_src' = 'manual' and nullif(it ->> 'duration_sec', '') is not null then
      update public.songs set team_sec = (it ->> 'duration_sec')::int where id = (it ->> 'song_id')::bigint and team_sec is distinct from (it ->> 'duration_sec')::int;
    end if;
    -- 레퍼런스 구간 (다음부터 자동 적용)
    rr := it -> 'ref_range';
    if rr is not null and jsonb_typeof(rr) = 'object' and coalesce(rr ->> 'yt', '') ~ '^[A-Za-z0-9_-]{11}$' then
      insert into public.song_refs (song_id, youtube_id, start_sec, end_sec)
      values ((it ->> 'song_id')::bigint, rr ->> 'yt', coalesce(nullif(rr ->> 'start', '')::int, 0), nullif(rr ->> 'end', '')::int)
      on conflict (song_id, youtube_id) do update set start_sec = excluded.start_sec, end_sec = excluded.end_sec, updated_at = now();
    end if;
  end loop;

  -- 다시 올리면 바뀐 것 정리
  if was_pub and p_publish then
    select coalesce(jsonb_agg(jsonb_build_object('song_id', i.song_id, 'title', so.title, 'key', i.key, 'sheet_id', i.sheet_id, 'page_from', i.page_from, 'page_to', i.page_to, 'memo', i.memo) order by i.ord), '[]'::jsonb)
      into new_items from public.setlist_items i join public.songs so on so.id = i.song_id where i.setlist_id = sl.id;
    for nw in select * from jsonb_array_elements(new_items) loop
      select x into o from jsonb_array_elements(old_items) x where x ->> 'song_id' = nw ->> 'song_id' limit 1;
      if o is null then ch := ch || ('곡 추가: ' || (nw ->> 'title'));
      elsif coalesce(o ->> 'key', '') <> coalesce(nw ->> 'key', '') then
        ch := ch || format('%s 키 %s → %s', nw ->> 'title', coalesce(nullif(o ->> 'key', ''), '?'), coalesce(nullif(nw ->> 'key', ''), '?'));
        keys := keys || (nw ->> 'song_id')::bigint;
      end if;
    end loop;
    for o in select * from jsonb_array_elements(old_items) loop
      if not exists (select 1 from jsonb_array_elements(new_items) x where x ->> 'song_id' = o ->> 'song_id') then ch := ch || ('곡 빠짐: ' || (o ->> 'title')); end if;
    end loop;
    old_common := array(select (x ->> 'song_id')::bigint from jsonb_array_elements(old_items) with ordinality t(x, n)
                         where exists (select 1 from jsonb_array_elements(new_items) y where y ->> 'song_id' = x ->> 'song_id') order by n);
    new_common := array(select (x ->> 'song_id')::bigint from jsonb_array_elements(new_items) with ordinality t(x, n)
                         where exists (select 1 from jsonb_array_elements(old_items) y where y ->> 'song_id' = x ->> 'song_id') order by n);
    if old_common <> new_common then ch := ch || '순서 변경'::text; end if;
    if coalesce(sl.pages, 0) <> coalesce((p_data ->> 'pages')::int, 0)
       or exists (select 1 from jsonb_array_elements(new_items) x join jsonb_array_elements(old_items) y on y ->> 'song_id' = x ->> 'song_id'
                   where coalesce(x ->> 'sheet_id', '') <> coalesce(y ->> 'sheet_id', '')
                      or coalesce(x ->> 'page_from', '') <> coalesce(y ->> 'page_from', '')) then
      ch := ch || '악보 PDF 교체'::text;
    end if;
    if cardinality(ch) = 0 then
      if exists (select 1 from jsonb_array_elements(new_items) x join jsonb_array_elements(old_items) y on y ->> 'song_id' = x ->> 'song_id'
                  where coalesce(x ->> 'memo', '') <> coalesce(y ->> 'memo', '')) then ch := ch || '메모 수정'::text;
      else ch := ch || '내용 수정'::text; end if;
    end if;
  end if;

  update public.setlists set
    status = case when p_publish then 'published' else status end,
    version = version + 1,
    published_at = case when p_publish then coalesce(published_at, now()) else published_at end,
    updated_at = now(), updated_by = auth.uid(),
    target_sec = case when p_data ? 'target_sec' then nullif(p_data ->> 'target_sec', '')::int else target_sec end,
    pages = nullif(p_data ->> 'pages', '')::int,
    leaders = case when cardinality(names) > 0 then names else leaders end,
    changes = case when was_pub and p_publish then jsonb_build_object('text', to_jsonb(ch), 'key_songs', to_jsonb(keys), 'at', now()) else changes end
  where id = sl.id
  returning * into sl;
  return json_build_object('id', sl.id, 'version', sl.version, 'status', sl.status, 'changes', sl.changes, 'republished', was_pub and p_publish);
end;
$$;

-- 리더십: 마감 · 목표 RT 바꾸기 (비우면 기본값)
create or replace function public.set_conti_meta(p_service uuid, p_deadline timestamptz, p_target int)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare s public.services; sl public.setlists;
begin
  if not public.is_admin() then raise exception '마감은 리더십만 바꿀 수 있어요.'; end if;
  select * into s from public.services where id = p_service;
  if s.id is null then raise exception '예배를 찾을 수 없어요.'; end if;
  select * into sl from public.setlists where service_id = p_service for update;
  if sl.id is null then
    insert into public.setlists (service_date, service_id, source, status, version) values (s.service_date, s.id, 'platform', 'draft', 0) returning * into sl;
  end if;
  update public.setlists set deadline = p_deadline, target_sec = p_target where id = sl.id;
  return json_build_object('deadline', public.conti_deadline(p_service), 'target_sec', public.conti_target(p_service));
end;
$$;

revoke all on function public.add_song(text) from public, anon;
revoke all on function public.add_original_sheet(bigint, text, text, text, int, int, text) from public, anon;
revoke all on function public.edit_sheet(bigint, text, boolean) from public, anon;
revoke all on function public.save_setlist(uuid, jsonb, boolean, int) from public, anon;
revoke all on function public.set_conti_meta(uuid, timestamptz, int) from public, anon;
grant execute on function public.add_song(text) to authenticated;
grant execute on function public.add_original_sheet(bigint, text, text, text, int, int, text) to authenticated;
grant execute on function public.edit_sheet(bigint, text, boolean) to authenticated;
grant execute on function public.save_setlist(uuid, jsonb, boolean, int) to authenticated;
grant execute on function public.set_conti_meta(uuid, timestamptz, int) to authenticated;


-- ---------------------------------------------------------------------
-- 7. RLS — 임시 저장한 콘티는 고칠 수 있는 사람만 봐요
-- ---------------------------------------------------------------------
alter table public.yt_videos        enable row level security;
alter table public.song_refs        enable row level security;
alter table public.sheet_versions   enable row level security;
alter table public.setlist_versions enable row level security;

drop policy if exists setlists_read on public.setlists;
create policy setlists_read on public.setlists for select
  using (public.is_member() and (status = 'published' or (service_id is not null and public.can_edit_conti(service_id))));
drop policy if exists setlist_items_read on public.setlist_items;
create policy setlist_items_read on public.setlist_items for select
  using (public.is_member() and exists (select 1 from public.setlists sl where sl.id = setlist_id
           and (sl.status = 'published' or (sl.service_id is not null and public.can_edit_conti(sl.service_id)))));

do $$
declare t text;
begin
  foreach t in array array['yt_videos', 'song_refs', 'sheet_versions', 'setlist_versions'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for select using (public.is_member())', t || '_read', t);
    execute format('create policy %I on public.%I for all using (public.is_admin()) with check (public.is_admin())', t || '_admin', t);
  end loop;
end $$;

-- 기록(021)은 올라온 주일 콘티만, 예배 날이 된 것부터 (사역 콘티 · 임시 저장 · 아직 안 한 예배는 빼요)
create or replace function public.history_bundle()
returns json
language sql
stable
security invoker
set search_path = public
as $$
  select case when not public.is_member() then null else json_build_object(
    'songs', coalesce((select json_agg(json_build_object('id', s.id, 'title', s.title, 'main_key', s.main_key, 'memo', s.memo) order by s.id) from public.songs s), '[]'::json),
    'setlists', coalesce((select json_agg(json_build_object(
        'd', sl.service_date, 'leaders', sl.leaders, 'note', coalesce(sl.note, ''),
        'items', coalesce((select json_agg(json_build_array(i.ord, i.song_id, i.key, i.medley, i.refs) order by i.ord) from public.setlist_items i where i.setlist_id = sl.id), '[]'::json))
      order by sl.service_date)
      from public.setlists sl
     where sl.status = 'published'
       and sl.service_date <= (now() at time zone 'Asia/Seoul')::date
       and (sl.service_id is null or exists (select 1 from public.services s where s.id = sl.service_id and s.ministry_id is null))), '[]'::json),
    'lineup', coalesce((select json_agg(json_build_array(l.service_date, l.position, l.slot, l.person_name, l.is_guest) order by l.service_date, l.position, l.slot) from public.lineup_history l), '[]'::json)
  ) end;
$$;
revoke all on function public.history_bundle() from public, anon;
grant execute on function public.history_bundle() to authenticated;


-- ---------------------------------------------------------------------
-- 8. Storage: 'sheets' 버킷 (비공개 · PDF · 30MB)
--    읽기 = 팀원 · 올리기 = 리더십 · 인도자 · 밴드 마스터 · 지우기 = 리더십
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') and exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('sheets', 'sheets', false, 31457280, array['application/pdf'])
    on conflict (id) do update set public = false, file_size_limit = 31457280, allowed_mime_types = array['application/pdf'];
    execute 'drop policy if exists sheets_read on storage.objects';
    execute 'drop policy if exists sheets_insert on storage.objects';
    execute 'drop policy if exists sheets_delete on storage.objects';
    execute $p$create policy sheets_read on storage.objects for select to authenticated using (bucket_id = 'sheets' and public.is_member())$p$;
    execute $p$create policy sheets_insert on storage.objects for insert to authenticated with check (bucket_id = 'sheets' and public.can_upload_sheet())$p$;
    execute $p$create policy sheets_delete on storage.objects for delete to authenticated using (bucket_id = 'sheets' and public.is_admin())$p$;
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 9. 알림
-- ---------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('open', 'minopen', 'poll', 'remind', 'lineup', 'practice', 'apply', 'trainee', 'notice', 'message', 'prayer', 'birthday', 'conti'));

alter table public.notify_settings drop constraint if exists notify_settings_kind_check;
alter table public.notify_settings add constraint notify_settings_kind_check
  check (kind in ('open', 'minopen', 'poll', 'remind', 'lineup', 'practice', 'apply', 'trainee', 'notice',
                  'prayer_new', 'prayer_remind', 'prayer_urgent', 'birthday_soon', 'birthday_today',
                  'conti_up', 'conti_edit', 'conti_open', 'conti_remind'));

insert into public.notify_settings (kind, title, body, schedule) values
  ('conti_up',     '{예배} 콘티가 올라왔어요',     '{곡}', null),
  ('conti_edit',   '{예배} 콘티가 수정됐어요',     '{바뀐 것}', null),
  ('conti_open',   '{예배} 콘티를 준비해 주세요',  '{마감}까지 올려 주세요 · 섬김자 {인원}명', '{"days":7,"hour":18}'),
  ('conti_remind', '[{마감일} 마감] {예배} 콘티',  '아직 콘티가 올라오지 않았어요. {마감}까지 올려 주세요', '[{"days":1,"hour":18},{"days":0,"hour":18}]')
on conflict (kind) do nothing;


-- ---------------------------------------------------------------------
-- 10. 초기화(019)에 플랫폼 콘티 · 악보 포함 (지난 기록 import는 그대로)
-- ---------------------------------------------------------------------
create or replace function public.reset_team_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.forecast_heirs where true;
  delete from public.forecast_exits where true;

  delete from public.poll_votes where true;
  delete from public.poll_options where true;
  delete from public.polls where true;

  delete from public.notification_inbox where true;
  delete from public.notifications where true;
  delete from public.notify_sent where true;

  delete from public.prayer_taps where true;
  delete from public.prayers where true;

  delete from public.setlists where source = 'platform';
  delete from public.sheet_versions where true;

  delete from public.practice_attendance where true;
  delete from public.practice_answers where true;
  delete from public.ministry_poll where true;
  delete from public.ministry_availability where true;
  delete from public.ministry_practices where true;
  delete from public.ministry_targets where true;
  delete from public.assignments where true;
  delete from public.services where true;
  delete from public.ministries where true;
  delete from public.guests where true;

  delete from public.availability where true;
  delete from public.availability_notes where true;
  delete from public.availability_months where true;
  delete from public.attendance where true;
  delete from public.team_meetings where true;

  delete from public.applications a
   where a.user_id is null
      or not exists (select 1 from public.members m where m.id = a.user_id);
  delete from public.alumni where true;

  delete from public.audit_log where true;
  insert into public.audit_log (tbl, op, label) values ('reset', 'DELETE', '초기화');
end;
$$;

revoke all on function public.reset_team_data() from public, anon, authenticated;
grant execute on function public.reset_team_data() to service_role;

-- 확인: select kind from notify_settings where kind like 'conti%';
--       select id, public from storage.buckets where id = 'sheets';
