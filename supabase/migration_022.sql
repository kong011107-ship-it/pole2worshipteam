-- =====================================================================
--  022 — v23: 백업찬양 · 적용찬양 · 예배 진행곡 · 밴드 악보 권한 · 토요 연습 시간 변경 투표 · 연습 취소
--  · team_meetings.practice_cancelled : 그 주 토요 연습 없음 → 당일(주일) 리허설만
--      취소한 주는 토요 연습 출석을 적지 않고(있던 기록은 지움) 통계 · 지각에서 빠져요. 리허설 출석은 그대로
--  · practice_votes  : 토요 연습 시간을 바꾸고 대상자에게 '가능 / 불가'를 물은 기록 (토요일마다 한 줄)
--      결과는 리더십만 봐요(polls.results_hidden). 리더십이 '바꾼 시간 확정 / 원래 시간으로 / 연습 취소' 중 고름
--  · 밴드 악보 권한 : 그 예배 라인업 밴드(건반 · 일렉 · 베이스 · 드럼 · 어쿠스틱)도 올라온 콘티의 악보를 고쳐요
--      곡 · 키 · 순서 · 메모는 그대로 인도자 · 밴드 마스터 · 리더십만. 악보만 바뀌면 알림 없이 '악보 바뀜' 표시
--  · applied_songs   : 적용찬양 (예배마다 · 이미지) — 리더십 · 그 예배 콘티를 고칠 수 있는 사람이 올림
--  · worship_proc    : 예배 진행곡 (축복송 · 봉헌송 · 축도송 · 등단송) — 종류마다 1곡, 적용 시작일 · 이전 곡은 기록으로
--  · backup_books · backup_songs · backup_live : 백업찬양 악보집 · 곡 목록(코드) · 지금 진행 상태(한 줄)
--      이미지로 곡을 직접 더할 수도 있어요 (악보집에 없는 곡)
--  · Storage 'sheets' 버킷: 이미지(JPEG · PNG · WebP)도 받음, 경로마다 올릴 수 있는 사람이 달라요
--  migration_021 다음에 SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 괜찮아요.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 토요 연습 취소 · 시간 변경 투표
-- ---------------------------------------------------------------------
alter table public.team_meetings
  add column if not exists practice_cancelled boolean not null default false;

alter table public.polls
  add column if not exists results_hidden boolean not null default false;

create table if not exists public.practice_votes (
  meeting_date  date primary key check (extract(isodow from meeting_date) = 6),
  poll_id       bigint references public.polls(id) on delete set null,
  prev_start    time,          -- 바꾸기 전 시간 (비어 있으면 기본 시간)
  prev_end      time,
  new_start     time,
  new_end       time,
  state         text not null default 'voting' check (state in ('voting', 'confirmed', 'reverted', 'cancelled')),
  decided_at    timestamptz,
  decided_by    uuid references public.members(id) on delete set null,
  created_by    uuid references public.members(id) on delete set null,
  created_at    timestamptz not null default now()
);
alter table public.practice_votes enable row level security;
drop policy if exists practice_votes_read on public.practice_votes;
create policy practice_votes_read on public.practice_votes for select using (public.is_admin());
-- 쓰기는 함수 · 서버로만

-- 취소한 주에는 토요 연습 출석을 적지 않아요
create or replace function public.attendance_practice_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.kind = 'practice' and exists (select 1 from public.team_meetings where id = new.meeting_id and practice_cancelled) then
    raise exception '이 주는 토요 연습이 취소됐어요. 리허설 출석만 적어 주세요.';
  end if;
  return new;
end;
$$;
drop trigger if exists attendance_practice_guard on public.attendance;
create trigger attendance_practice_guard
  before insert or update on public.attendance
  for each row execute function public.attendance_practice_guard();

-- 투표 한 건 보기: 결과를 숨긴 투표(results_hidden)는 리더십만 결과 · 참여 인원을 봐요
create or replace function public.poll_view(p_poll bigint)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.polls;
  adm boolean := public.is_admin();
  mine boolean;
  ended boolean;
  show boolean;
begin
  select * into p from public.polls where id = p_poll;
  if p.id is null or p.notification_id is null then return null; end if;
  mine := public.poll_targeted(p.notification_id);
  if not adm and not mine then return null; end if;
  ended := now() >= public.poll_ends_at(p);
  show := adm or (ended and not p.results_hidden);
  return json_build_object(
    'id', p.id, 'notification_id', p.notification_id, 'question', p.question,
    'multi', p.multi, 'anonymous', p.anonymous, 'deadline', p.deadline, 'closed_at', p.closed_at,
    'ends_at', public.poll_ends_at(p), 'ended', ended, 'show_results', show, 'eligible', mine,
    'hidden', p.results_hidden,
    'created_at', p.created_at, 'created_by', p.created_by,
    'targets', (select count(*) from public.notification_inbox i where i.notification_id = p.notification_id),
    'voters', case when adm or not p.results_hidden then (select count(distinct v.member_id) from public.poll_votes v where v.poll_id = p.id) end,
    'my', coalesce((select json_agg(v.option_id order by v.option_id) from public.poll_votes v where v.poll_id = p.id and v.member_id = auth.uid()), '[]'::json),
    'options', coalesce((select json_agg(json_build_object(
        'id', o.id, 'label', o.label,
        'count', case when show then (select count(*) from public.poll_votes v where v.option_id = o.id) end,
        'names', case when show and not p.anonymous then
                   (select coalesce(json_agg(m.name order by m.name), '[]'::json)
                      from public.poll_votes v join public.members m on m.id = v.member_id where v.option_id = o.id) end
      ) order by o.sort_order, o.id) from public.poll_options o where o.poll_id = p.id), '[]'::json),
    'pending', case when adm then coalesce((select json_agg(i.member_id) from public.notification_inbox i
        join public.members m on m.id = i.member_id and m.is_active
       where i.notification_id = p.notification_id
         and not exists (select 1 from public.poll_votes v where v.poll_id = p.id and v.member_id = i.member_id)), '[]'::json) end
  );
end;
$$;

-- 리더십: 토요일들의 시간 변경 투표 현황 (섬김 일정 · 배치표 경고)
--   yes / no / pending = 멤버 id 목록 (선택지 0번 = 가능, 1번 = 불가)
create or replace function public.practice_vote_board(p_dates date[])
returns json
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.is_admin() then null else coalesce((
    select json_agg(json_build_object(
      'date', v.meeting_date, 'state', v.state, 'poll_id', v.poll_id,
      'prev_start', v.prev_start, 'prev_end', v.prev_end, 'new_start', v.new_start, 'new_end', v.new_end,
      'decided_at', v.decided_at, 'created_at', v.created_at,
      'deadline', p.deadline, 'ended', p.id is not null and now() >= public.poll_ends_at(p),
      'yes', coalesce((select json_agg(pv.member_id) from public.poll_votes pv join public.poll_options o on o.id = pv.option_id
                        where pv.poll_id = p.id and o.sort_order = 0), '[]'::json),
      'no', coalesce((select json_agg(pv.member_id) from public.poll_votes pv join public.poll_options o on o.id = pv.option_id
                        where pv.poll_id = p.id and o.sort_order = 1), '[]'::json),
      'targets', coalesce((select json_agg(i.member_id) from public.notification_inbox i where i.notification_id = p.notification_id), '[]'::json),
      'pending', coalesce((select json_agg(i.member_id) from public.notification_inbox i
                        where i.notification_id = p.notification_id
                          and not exists (select 1 from public.poll_votes pv where pv.poll_id = p.id and pv.member_id = i.member_id)), '[]'::json)
    ) order by v.meeting_date)
    from public.practice_votes v left join public.polls p on p.id = v.poll_id
    where v.meeting_date = any (p_dates)), '[]'::json) end;
$$;

-- 리더십: 결정 (바꾼 시간 확정 · 원래 시간으로 · 연습 취소 · 취소 되돌리기)
--   p_decision: 'confirm' | 'revert' | 'cancel' | 'restore'
--   연습 취소: 그 주 토요 연습 출석 기록을 지우고, 원하면 주일(리허설) 시간을 함께 바꿈
create or replace function public.decide_practice(p_date date, p_decision text, p_sun_start time default null, p_sun_end time default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v public.practice_votes; tm public.team_meetings; s public.services; removed int := 0;
begin
  if not public.is_admin() then raise exception '리더십만 정할 수 있어요.'; end if;
  if extract(isodow from p_date) <> 6 then raise exception '토요일을 골라 주세요.'; end if;
  if p_decision not in ('confirm', 'revert', 'cancel', 'restore') then raise exception '알 수 없는 결정이에요.'; end if;
  insert into public.team_meetings (meeting_date) values (p_date) on conflict (meeting_date) do nothing;
  select * into tm from public.team_meetings where meeting_date = p_date for update;
  select * into v from public.practice_votes where meeting_date = p_date for update;

  if p_decision in ('confirm', 'revert') and v.meeting_date is null then raise exception '이 토요일엔 시간 변경 투표가 없어요.'; end if;

  if p_decision = 'confirm' then
    update public.practice_votes set state = 'confirmed', decided_at = now(), decided_by = auth.uid() where meeting_date = p_date;
    update public.team_meetings set practice_cancelled = false where id = tm.id;
  elsif p_decision = 'revert' then
    update public.team_meetings set practice_start = v.prev_start, practice_end = v.prev_end, practice_cancelled = false where id = tm.id;
    update public.practice_votes set state = 'reverted', decided_at = now(), decided_by = auth.uid() where meeting_date = p_date;
  elsif p_decision = 'cancel' then
    if p_sun_start is not null and (p_sun_end is null or p_sun_end <= p_sun_start) then raise exception '주일 끝나는 시간이 시작보다 늦어야 해요.'; end if;
    delete from public.attendance where meeting_id = tm.id and kind = 'practice';
    get diagnostics removed = row_count;
    update public.team_meetings set practice_cancelled = true where id = tm.id;
    if v.meeting_date is null then
      insert into public.practice_votes (meeting_date, prev_start, prev_end, new_start, new_end, state, decided_at, decided_by, created_by)
      values (p_date, tm.practice_start, tm.practice_end, tm.practice_start, tm.practice_end, 'cancelled', now(), auth.uid(), auth.uid());
    else
      update public.practice_votes set state = 'cancelled', decided_at = now(), decided_by = auth.uid() where meeting_date = p_date;
    end if;
    if p_sun_start is not null then
      select * into s from public.services where service_date = p_date + 1 and ministry_id is null limit 1;
      if s.id is null then
        insert into public.services (service_date, start_time, end_time) values (p_date + 1, p_sun_start, p_sun_end);
      else
        update public.services set start_time = p_sun_start, end_time = p_sun_end where id = s.id;
      end if;
    end if;
  else -- restore
    update public.team_meetings set practice_cancelled = false where id = tm.id;
    if v.meeting_date is not null and v.state = 'cancelled' then
      update public.practice_votes set state = case when v.poll_id is null then 'reverted' else 'confirmed' end, decided_at = now(), decided_by = auth.uid() where meeting_date = p_date;
    end if;
  end if;
  -- 결정하면 투표는 마감
  if v.poll_id is not null and p_decision <> 'restore' then
    update public.polls set closed_at = now() where id = v.poll_id and closed_at is null and deadline > now();
  end if;
  return json_build_object('date', p_date, 'decision', p_decision, 'removed', removed);
end;
$$;

revoke all on function public.practice_vote_board(date[]) from public, anon;
revoke all on function public.decide_practice(date, text, time, time) from public, anon;
grant execute on function public.practice_vote_board(date[]) to authenticated;
grant execute on function public.decide_practice(date, text, time, time) to authenticated;


-- ---------------------------------------------------------------------
-- 2. 밴드 악보 권한
-- ---------------------------------------------------------------------
-- 그 예배 라인업 밴드 (밴드 마스터 포함)
create or replace function public.is_band_of(p_service uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.assignments a join public.positions p on p.code = a.position_code
     where a.service_id = p_service and a.member_id = auth.uid() and p.kind = 'band');
$$;

-- 악보를 고칠 수 있는 사람: 콘티를 고칠 수 있는 사람 + 그 예배 밴드
create or replace function public.can_edit_sheets(p_service uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.can_edit_conti(p_service) or public.is_band_of(p_service); $$;

-- 악보 파일을 올릴 수 있는 사람: 리더십 · 최근(2주 전부터) 예배의 인도자 · 밴드
create or replace function public.can_upload_sheet()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1 from public.assignments a join public.services s on s.id = a.service_id join public.positions p on p.code = a.position_code
     where a.member_id = auth.uid() and (a.position_code = 'leader' or a.is_band_master or p.kind = 'band')
       and s.service_date >= current_date - 14);
$$;

-- 새 곡 더하기는 그대로 리더십 · 인도자 · 밴드 마스터만 (밴드로 넓히지 않음)
create or replace function public.add_song(p_title text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare t text := trim(coalesce(p_title, '')); n text; sid bigint;
begin
  if not (public.is_admin() or exists (
      select 1 from public.assignments a join public.services s on s.id = a.service_id
       where a.member_id = auth.uid() and (a.position_code = 'leader' or a.is_band_master) and s.service_date >= current_date - 14)) then
    raise exception '곡은 리더십 · 인도자 · 밴드 마스터만 더할 수 있어요.';
  end if;
  if length(t) < 1 or length(t) > 80 then raise exception '곡 이름을 1~80자로 적어 주세요.'; end if;
  n := lower(regexp_replace(t, '\s', '', 'g'));
  select id into sid from public.songs where norm = n;
  if sid is null then insert into public.songs (title) values (t) returning id into sid; end if;
  return sid;
end;
$$;

alter table public.setlists
  add column if not exists sheet_changes jsonb;   -- 악보만 바뀐 때 {at, by} — 알림 없이 '악보 바뀜'

-- 악보만 고치기 (밴드 · 인도자 · 밴드 마스터 · 리더십). 올라온 콘티만, 곡 · 순서는 그대로
--   p_data = { pages, items: [{ song_id, sheet_id | new_sheet: {name, path, pages, size, thumb}, page_from, page_to }] } (콘티 곡 순서대로)
create or replace function public.save_setlist_sheets(p_service uuid, p_data jsonb, p_base int)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  sl public.setlists; it jsonb; i int := 0; sid bigint; ns jsonb; cur bigint[]; got bigint[]; who text;
begin
  if not public.can_edit_sheets(p_service) then raise exception '이 예배의 악보를 고칠 수 있는 사람이 아니에요. (그 예배 밴드 · 인도자 · 리더십)'; end if;
  select * into sl from public.setlists where service_id = p_service for update;
  if sl.id is null or sl.status <> 'published' then raise exception '올라온 콘티가 있어야 악보를 고칠 수 있어요.'; end if;
  if p_base is not null and sl.version <> p_base then
    raise exception using errcode = 'PT409', message = '다른 사람이 먼저 이 콘티를 고쳤어요. 새로 불러온 뒤 다시 고쳐 주세요.',
      detail = json_build_object('version', sl.version, 'by', (select name from public.members where id = sl.updated_by))::text;
  end if;
  cur := array(select song_id from public.setlist_items where setlist_id = sl.id order by ord);
  got := array(select (x ->> 'song_id')::bigint from jsonb_array_elements(coalesce(p_data -> 'items', '[]'::jsonb)) x);
  if cur <> got then raise exception '콘티 곡이 바뀌었어요. 새로 불러온 뒤 다시 고쳐 주세요.'; end if;

  for it in select * from jsonb_array_elements(p_data -> 'items') loop
    i := i + 1;
    sid := nullif(it ->> 'sheet_id', '')::bigint;
    ns := it -> 'new_sheet';
    if ns is not null and jsonb_typeof(ns) = 'object' then
      if coalesce(ns ->> 'path', '') !~ ('^sheets/' || (it ->> 'song_id') || '/[0-9a-f-]{36}\.pdf$') then raise exception '악보 파일 경로가 올바르지 않아요.'; end if;
      insert into public.sheet_versions (song_id, kind, name, key, pages, path, size_bytes, thumb, created_by, setlist_id)
      values ((it ->> 'song_id')::bigint, 'sheet', left(coalesce(nullif(trim(ns ->> 'name'), ''), '악보'), 60),
              (select key from public.setlist_items where setlist_id = sl.id and ord = i),
              (ns ->> 'pages')::int, ns ->> 'path', nullif(ns ->> 'size', '')::int, ns ->> 'thumb', auth.uid(), sl.id)
      on conflict (path) do update set name = excluded.name
      returning id into sid;
    elsif sid is not null and not exists (select 1 from public.sheet_versions where id = sid and song_id = (it ->> 'song_id')::bigint) then
      raise exception '악보를 찾을 수 없어요 (%번째).', i;
    end if;
    update public.setlist_items set sheet_id = sid, page_from = nullif(it ->> 'page_from', '')::int, page_to = nullif(it ->> 'page_to', '')::int
     where setlist_id = sl.id and ord = i;
  end loop;

  who := (select name from public.members where id = auth.uid());
  update public.setlists set
    version = version + 1,
    notified_version = version + 1,          -- 악보만 바뀌면 알림 없음
    pages = case when p_data ? 'pages' then nullif(p_data ->> 'pages', '')::int else pages end,
    updated_at = now(), updated_by = auth.uid(),
    sheet_changes = jsonb_build_object('at', now(), 'by', who)
  where id = sl.id
  returning * into sl;
  return json_build_object('id', sl.id, 'version', sl.version, 'sheet_changes', sl.sheet_changes);
end;
$$;
revoke all on function public.is_band_of(uuid) from public, anon;
revoke all on function public.can_edit_sheets(uuid) from public, anon;
revoke all on function public.save_setlist_sheets(uuid, jsonb, int) from public, anon;
grant execute on function public.is_band_of(uuid) to authenticated;
grant execute on function public.can_edit_sheets(uuid) to authenticated;
grant execute on function public.save_setlist_sheets(uuid, jsonb, int) to authenticated;


-- ---------------------------------------------------------------------
-- 3. 적용찬양 · 예배 진행곡
-- ---------------------------------------------------------------------
-- 이미지 경로 확인 (applied/예배/uuid.jpg · proc/uuid.pdf|jpg · backup/uuid.jpg)
create or replace function public.paths_ok(p_paths text[], p_prefix text)
returns boolean
language sql
immutable
as $$
  select coalesce(cardinality(p_paths), 0) between 1 and 12
     and not exists (select 1 from unnest(p_paths) x where x !~ ('^' || p_prefix || '[0-9a-f-]{36}\.(jpg|png|webp|pdf)$'));
$$;

create table if not exists public.applied_songs (
  id          bigint generated always as identity primary key,
  service_id  uuid not null references public.services(id) on delete cascade,
  ord         smallint not null default 1 check (ord between 1 and 20),
  title       text not null check (length(trim(title)) between 1 and 80),
  key         text check (length(key) <= 12),
  note        text check (length(note) <= 200),
  images      text[] not null,
  created_by  uuid references public.members(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (public.paths_ok(images, 'applied/' || service_id::text || '/'))
);
create index if not exists applied_songs_svc_idx on public.applied_songs (service_id, ord);
alter table public.applied_songs enable row level security;
drop policy if exists applied_songs_read on public.applied_songs;
drop policy if exists applied_songs_write on public.applied_songs;
create policy applied_songs_read on public.applied_songs for select
  using (public.is_member() and exists (select 1 from public.services s where s.id = service_id and (s.status = 'published' or public.is_admin())));
create policy applied_songs_write on public.applied_songs for all
  using (public.is_admin() or public.can_edit_conti(service_id))
  with check (public.is_admin() or public.can_edit_conti(service_id));

create table if not exists public.worship_proc (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('blessing', 'offering', 'benediction', 'entrance')),
  title       text not null check (length(trim(title)) between 1 and 80),
  key         text check (length(key) <= 12),
  path        text check (path ~ '^proc/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$'),
  pages       smallint check (pages between 1 and 40),
  images      text[],
  start_date  date not null default current_date,
  created_by  uuid references public.members(id) on delete set null,
  created_at  timestamptz not null default now(),
  check (images is null or public.paths_ok(images, 'proc/'))
);
create index if not exists worship_proc_kind_idx on public.worship_proc (kind, start_date desc, id desc);
alter table public.worship_proc enable row level security;
drop policy if exists worship_proc_read on public.worship_proc;
drop policy if exists worship_proc_admin on public.worship_proc;
create policy worship_proc_read on public.worship_proc for select using (public.is_member());
create policy worship_proc_admin on public.worship_proc for all using (public.is_admin()) with check (public.is_admin());

-- 그날 쓰는 예배 진행곡 (종류마다 적용 시작일이 그날 이전인 것 중 가장 최근)
create or replace function public.proc_on(p_date date)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.is_member() then null else coalesce((
    select json_agg(json_build_object('id', w.id, 'kind', w.kind, 'title', w.title, 'key', w.key, 'path', w.path, 'pages', w.pages,
                                      'images', w.images, 'start_date', w.start_date)
                    order by array_position(array['blessing', 'offering', 'benediction', 'entrance'], w.kind))
      from (select distinct on (kind) * from public.worship_proc where start_date <= coalesce(p_date, current_date)
             order by kind, start_date desc, id desc) w), '[]'::json) end;
$$;
revoke all on function public.proc_on(date) from public, anon;
grant execute on function public.proc_on(date) to authenticated;


-- ---------------------------------------------------------------------
-- 4. 콘티 읽기에 악보 권한 · 적용찬양 · 예배 진행곡 포함
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
      'proc', public.proc_on(s.service_date),
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


-- ---------------------------------------------------------------------
-- 5. 백업찬양
-- ---------------------------------------------------------------------
create table if not exists public.backup_books (
  id          bigint generated always as identity primary key,
  label       text not null check (length(trim(label)) between 1 and 40),     -- 예: Ver.2605
  path        text not null unique check (path ~ '^book/[0-9a-f-]{36}\.pdf$'),
  pages       smallint not null check (pages between 1 and 600),
  size_bytes  int check (size_bytes between 1 and 31457280),
  topics      jsonb not null default '{"1":"결단/선포","2":"믿음/신뢰","3":"위로/소망","4":"임재/경배","5":"간구/중보"}'::jsonb,
  active      boolean not null default false,
  created_by  uuid references public.members(id) on delete set null,
  created_at  timestamptz not null default now()
);
create unique index if not exists backup_books_active_uniq on public.backup_books (active) where active;

create table if not exists public.backup_songs (
  id          bigint generated always as identity primary key,
  book_id     bigint references public.backup_books(id) on delete cascade,   -- 비어 있으면 이미지로 직접 더한 곡
  code        text not null check (code ~ '^[a-z0-9+]{1,6}$'),               -- 악보집 코드: 키 · 주제 · 번호 (예: g40)
  title       text not null check (length(trim(title)) between 1 and 80),
  key         text check (key ~ '^[a-g]$'),
  topic       smallint check (topic between 0 and 9),
  page        smallint check (page between 1 and 600),
  pages       smallint not null default 1 check (pages between 1 and 12),
  images      text[],
  norm        text generated always as (lower(regexp_replace(title, '[\s\(\)\[\]·.,!?''"-]', '', 'g'))) stored,
  hidden      boolean not null default false,
  created_by  uuid references public.members(id) on delete set null,
  created_at  timestamptz not null default now(),
  check ((book_id is not null and page is not null) or (book_id is null and images is not null and public.paths_ok(images, 'backup/')))
);
create unique index if not exists backup_songs_book_code_uniq on public.backup_songs (book_id, code) where book_id is not null;
create unique index if not exists backup_songs_custom_code_uniq on public.backup_songs (code) where book_id is null and not hidden;
create index if not exists backup_songs_norm_idx on public.backup_songs (norm);

create table if not exists public.backup_live (
  id          int primary key default 1 check (id = 1),
  active      boolean not null default false,
  leader_id   uuid references public.members(id) on delete set null,
  candidates  bigint[] not null default '{}',
  now_ref     text check (now_ref ~ '^(b:[0-9]+|p:(blessing|offering|benediction|entrance))$'),
  next_ref    text check (next_ref ~ '^(b:[0-9]+|p:(blessing|offering|benediction|entrance))$'),
  seq         int not null default 0,
  started_at  timestamptz,
  updated_at  timestamptz not null default now()
);
insert into public.backup_live (id) values (1) on conflict do nothing;

alter table public.backup_books enable row level security;
alter table public.backup_songs enable row level security;
alter table public.backup_live  enable row level security;
drop policy if exists backup_books_read on public.backup_books;
drop policy if exists backup_books_admin on public.backup_books;
drop policy if exists backup_songs_read on public.backup_songs;
drop policy if exists backup_songs_admin on public.backup_songs;
drop policy if exists backup_live_read on public.backup_live;
create policy backup_books_read on public.backup_books for select using (public.is_member());
create policy backup_books_admin on public.backup_books for all using (public.is_admin()) with check (public.is_admin());
create policy backup_songs_read on public.backup_songs for select using (public.is_member());
create policy backup_songs_admin on public.backup_songs for all using (public.is_admin()) with check (public.is_admin());
create policy backup_live_read on public.backup_live for select using (public.is_member());
-- backup_live 쓰기는 함수로만

-- 백업찬양을 이끌 수 있는 사람: 리더십 · 어제부터 7일 안 예배의 인도자
create or replace function public.can_lead_backup()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1 from public.assignments a join public.services s on s.id = a.service_id
     where a.member_id = auth.uid() and a.position_code = 'leader'
       and s.service_date between current_date - 1 and current_date + 7);
$$;

-- 진행 상태 바꾸기 (보낸 칸만): { candidates: [id...], now: 'b:12' | 'p:benediction' | null, next: ..., active: true/false }
--   p_seq: 화면이 알고 있는 seq (다른 기기에서 먼저 바꿨으면 409 대신 그냥 덮어씀 — 인도자 한 명이 쓰는 화면)
create or replace function public.backup_update(p jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare L public.backup_live; c bigint[];
begin
  if not public.can_lead_backup() then raise exception '백업찬양은 이번 주 인도자 · 리더십만 진행할 수 있어요.'; end if;
  select * into L from public.backup_live where id = 1 for update;
  if L.id is null then insert into public.backup_live (id) values (1) returning * into L; end if;
  if p ? 'candidates' then
    c := array(select (x)::bigint from jsonb_array_elements_text(coalesce(p -> 'candidates', '[]'::jsonb)) x);
    if cardinality(c) > 16 then raise exception '후보는 16곡까지예요.'; end if;
    if exists (select 1 from unnest(c) x where not exists (select 1 from public.backup_songs s where s.id = x and not s.hidden)) then
      raise exception '곡을 찾을 수 없어요. 새로고침해 주세요.';
    end if;
    L.candidates := c;
  end if;
  if p ? 'now' then L.now_ref := nullif(p ->> 'now', ''); end if;
  if p ? 'next' then L.next_ref := nullif(p ->> 'next', ''); end if;
  if p ? 'active' then
    if (p ->> 'active')::boolean and not L.active then L.started_at := now(); end if;
    L.active := (p ->> 'active')::boolean;
    if not L.active then L.now_ref := null; L.next_ref := null; end if;
  end if;
  update public.backup_live set active = L.active, leader_id = auth.uid(), candidates = L.candidates, now_ref = L.now_ref, next_ref = L.next_ref,
         seq = seq + 1, started_at = L.started_at, updated_at = now()
   where id = 1 returning * into L;
  return public.backup_state_live();
end;
$$;

-- 지금 상태 (팀원 · 인도자 화면이 몇 초마다 확인)
create or replace function public.backup_state_live()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.is_member() then null else (
    select json_build_object('active', l.active, 'leader_id', l.leader_id, 'leader', m.name, 'candidates', l.candidates,
                             'now', l.now_ref, 'next', l.next_ref, 'seq', l.seq, 'started_at', l.started_at, 'updated_at', l.updated_at,
                             'can_lead', public.can_lead_backup())
      from public.backup_live l left join public.members m on m.id = l.leader_id where l.id = 1) end;
$$;

-- 이미지로 곡 더하기 (악보집에 없는 곡) — 코드를 비우면 x1, x2 … 로
create or replace function public.backup_add_custom(p_title text, p_key text, p_code text, p_images text[])
returns json
language plpgsql
security definer
set search_path = public
as $$
declare c text := lower(trim(coalesce(p_code, ''))); r public.backup_songs; n int;
begin
  if not public.can_lead_backup() then raise exception '이번 주 인도자 · 리더십만 곡을 더할 수 있어요.'; end if;
  if length(trim(coalesce(p_title, ''))) < 1 then raise exception '곡 이름을 적어 주세요.'; end if;
  if not public.paths_ok(p_images, 'backup/') then raise exception '악보 이미지를 1~12장 올려 주세요.'; end if;
  if c = '' then
    select coalesce(max(substring(code from 2)::int), 0) + 1 into n from public.backup_songs where book_id is null and code ~ '^x[0-9]{1,5}$';
    c := 'x' || n;
  end if;
  if c !~ '^[a-z0-9+]{1,6}$' then raise exception '코드는 영문 소문자 · 숫자 6자까지예요.'; end if;
  if exists (select 1 from public.backup_songs s left join public.backup_books b on b.id = s.book_id
              where s.code = c and not s.hidden and (s.book_id is null or b.active)) then raise exception '이미 있는 코드예요 (%).', c; end if;
  insert into public.backup_songs (book_id, code, title, key, topic, pages, images, created_by)
  values (null, c, trim(p_title), nullif(lower(trim(coalesce(p_key, ''))), ''), null, cardinality(p_images), p_images, auth.uid())
  returning * into r;
  return row_to_json(r);
end;
$$;

-- 리더십: 악보집 등록 (PDF 한 개 + 쪽마다 읽은 곡 목록) → 이걸 지금 악보집으로
--   p_songs = [{ code, title, key, topic, page }]
create or replace function public.backup_book_save(p_label text, p_path text, p_pages int, p_size int, p_topics jsonb, p_songs jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare bid bigint; s jsonb; n int := 0;
begin
  if not public.is_admin() then raise exception '악보집은 리더십만 올릴 수 있어요.'; end if;
  update public.backup_books set active = false where active;
  insert into public.backup_books (label, path, pages, size_bytes, topics, active, created_by)
  values (trim(p_label), p_path, p_pages, p_size, coalesce(p_topics, '{"1":"결단/선포","2":"믿음/신뢰","3":"위로/소망","4":"임재/경배","5":"간구/중보"}'::jsonb), true, auth.uid())
  returning id into bid;
  for s in select * from jsonb_array_elements(coalesce(p_songs, '[]'::jsonb)) loop
    insert into public.backup_songs (book_id, code, title, key, topic, page, pages, created_by)
    values (bid, lower(trim(s ->> 'code')), trim(s ->> 'title'), nullif(lower(trim(coalesce(s ->> 'key', ''))), ''), nullif(s ->> 'topic', '')::int,
            (s ->> 'page')::int, greatest(1, coalesce(nullif(s ->> 'pages', '')::int, 1)), auth.uid())
    on conflict (book_id, code) where book_id is not null do update set title = excluded.title, page = excluded.page;
    n := n + 1;
  end loop;
  -- 진행 후보 중 예전 악보집 곡은 같은 코드의 새 곡으로
  update public.backup_live l set candidates = array(
      select coalesce((select ns.id from public.backup_songs os join public.backup_songs ns on ns.code = os.code and ns.book_id = bid where os.id = x and os.book_id is not null), x)
        from unnest(l.candidates) x), seq = seq + 1 where id = 1;
  return json_build_object('id', bid, 'songs', n);
end;
$$;

revoke all on function public.can_lead_backup() from public, anon;
revoke all on function public.backup_update(jsonb) from public, anon;
revoke all on function public.backup_state_live() from public, anon;
revoke all on function public.backup_add_custom(text, text, text, text[]) from public, anon;
revoke all on function public.backup_book_save(text, text, int, int, jsonb, jsonb) from public, anon;
grant execute on function public.can_lead_backup() to authenticated;
grant execute on function public.backup_update(jsonb) to authenticated;
grant execute on function public.backup_state_live() to authenticated;
grant execute on function public.backup_add_custom(text, text, text, text[]) to authenticated;
grant execute on function public.backup_book_save(text, text, int, int, jsonb, jsonb) to authenticated;

-- 실시간 (Supabase Realtime): 진행 상태가 바뀌면 팀원 화면이 바로 따라가요. 없으면 몇 초마다 확인
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'backup_live') then
    execute 'alter publication supabase_realtime add table public.backup_live';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 6. Storage: 'sheets' 버킷 — PDF + 이미지, 경로마다 올릴 수 있는 사람
--    sheets/ · originals/ : 리더십 · 최근 예배 인도자 · 밴드 마스터 · 밴드
--    book/ · proc/        : 리더십
--    backup/              : 리더십 · 이번 주 인도자 (이미지로 곡 더하기)
--    applied/예배/        : 리더십 · 그 예배 콘티를 고칠 수 있는 사람
-- ---------------------------------------------------------------------
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
    else false end;
$$;
revoke all on function public.can_upload_object(text) from public, anon;
grant execute on function public.can_upload_object(text) to authenticated;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') and exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('sheets', 'sheets', false, 31457280, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = false, file_size_limit = 31457280, allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    execute 'drop policy if exists sheets_insert on storage.objects';
    execute $p$create policy sheets_insert on storage.objects for insert to authenticated with check (bucket_id = 'sheets' and public.can_upload_object(name))$p$;
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 7. 알림
-- ---------------------------------------------------------------------
alter table public.notify_settings drop constraint if exists notify_settings_kind_check;
alter table public.notify_settings add constraint notify_settings_kind_check
  check (kind in ('open', 'minopen', 'poll', 'remind', 'lineup', 'practice', 'apply', 'trainee', 'notice',
                  'prayer_new', 'prayer_remind', 'prayer_urgent', 'birthday_soon', 'birthday_today',
                  'conti_up', 'conti_edit', 'conti_open', 'conti_remind',
                  'sat_vote', 'sat_decide', 'proc'));

insert into public.notify_settings (kind, title, body, schedule) values
  ('sat_vote',   '[투표] {날짜} 토요 연습 시간이 바뀌었어요', '{시간}에 연습할 수 있는지 알려 주세요 · {마감} 마감', null),
  ('sat_decide', '{날짜} 토요 연습 {결정}',                   '{내용}', null),
  ('proc',       '예배 진행곡이 바뀌었어요',                  '{곡}', null)
on conflict (kind) do nothing;


-- ---------------------------------------------------------------------
-- 8. 초기화(019)에 새 표 포함 (악보집 · 예배 진행곡은 남겨요)
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

  delete from public.practice_votes where true;
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
  update public.backup_live set active = false, candidates = '{}', now_ref = null, next_ref = null, leader_id = null, seq = seq + 1 where id = 1;

  delete from public.practice_attendance where true;
  delete from public.practice_answers where true;
  delete from public.ministry_poll where true;
  delete from public.ministry_availability where true;
  delete from public.ministry_practices where true;
  delete from public.ministry_targets where true;
  delete from public.assignments where true;
  delete from public.services where true;          -- 적용찬양도 함께
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

-- 확인: select kind from notify_settings where kind in ('sat_vote','sat_decide','proc');   → 3줄
--       select allowed_mime_types from storage.buckets where id = 'sheets';                → PDF · JPEG · PNG · WebP
