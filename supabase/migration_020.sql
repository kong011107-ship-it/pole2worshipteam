-- =====================================================================
--  020 — v21: 예배MC · 교역자 · 어쿠스틱 · 찬양 기록(콘티 · 곡 · 라인업)
--  · members.status 에 'mc'(예배MC) · 'pastor'(교역자) 추가
--      리더십 권한(알림 · 정보 보기)을 갖지만 섬김 응답 · 출석 · 자동 추천 · 인원 전망에서는 빠져요
--      배치는 열어 둠: 주 포지션 · 추가 포지션 없이 어느 자리에든 직접 넣을 수 있어요
--      지정 · 해제는 최상위 리더십만 (리더십 권한이 함께 생기니까)
--  · positions: 어쿠스틱(acoustic) — 선택 포지션 (기본 0명 · 최대 1명). 자동 추천은 채우지 않아요
--  · 찬양 기록: songs(곡) · setlists(주일마다 한 줄: 인도자 · 특별예배 이름) · setlist_items(콘티 곡)
--               lineup_history(지난 라인업 · 이름 그대로) — 팀원 모두 보고, 리더십만 고쳐요
--      데이터는 migration_020_history.sql 로 한 번 넣어요 (카톡 콘티방 2022.3 ~ 2026.10 정리본)
--  migration_019 다음에 SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 괜찮아요.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 예배MC · 교역자
-- ---------------------------------------------------------------------
alter table public.members drop constraint if exists members_status_check;
alter table public.members add constraint members_status_check
  check (status in ('trainee', 'active', 'mc', 'pastor'));

-- 예배MC · 교역자 = 리더십 권한. 지정 · 해제는 최상위 리더십만
create or replace function public.members_observer_guard()
returns trigger
language plpgsql
as $$
declare
  priv boolean := auth.uid() is null or coalesce(auth.role(), '') = 'service_role';
  was boolean := tg_op = 'UPDATE' and old.status in ('mc', 'pastor');
  now_obs boolean := new.status in ('mc', 'pastor');
begin
  if tg_op = 'UPDATE' and (was or now_obs) and new.status is distinct from old.status and not priv and not public.is_owner() then
    raise exception '예배MC · 교역자 지정과 해제는 최상위 리더십만 할 수 있어요.';
  end if;
  if now_obs then
    new.role := 'admin';
    new.role_title := null;
    new.title_until := null;
  end if;
  return new;
end;
$$;
drop trigger if exists members_observer_guard on public.members;
create trigger members_observer_guard
  before insert or update on public.members
  for each row execute function public.members_observer_guard();

-- 배치 규칙 (010): 예배MC · 교역자는 포지션 지정 없이 어느 자리에든
create or replace function public.assignments_validate()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  p public.positions;
  m public.members;
  g public.guests;
begin
  select * into p from public.positions where code = new.position_code;

  if new.slot > p.max_count then
    raise exception '% 자리는 최대 %명입니다.', p.name, p.max_count;
  end if;
  if new.is_singer_leader and p.kind <> 'vocal' then
    raise exception '싱어 리더는 싱어 중에서만 지정할 수 있습니다.';
  end if;
  if new.is_band_master and p.kind <> 'band' then
    raise exception '밴드 마스터는 세션 중에서만 지정할 수 있습니다.';
  end if;

  if new.guest_id is not null then
    select * into g from public.guests where id = new.guest_id;
    if not (new.position_code = any (g.positions)) then
      raise exception '이 객원은 % 포지션이 지정되어 있지 않습니다.', p.name;
    end if;
    new.member_id := null;
    new.is_guest := true;
    new.former_name := g.name;
    return new;
  end if;

  if new.member_id is null then
    if tg_op = 'INSERT' then raise exception '배치할 멤버가 없습니다.'; end if;
    return new;
  end if;

  select * into m from public.members where id = new.member_id;
  if m.id is null or not m.is_active or m.status not in ('active', 'mc', 'pastor') then
    raise exception '활동 중인 정식 팀원만 배치할 수 있습니다.';
  end if;
  if m.status = 'active'
     and m.main_position is distinct from new.position_code
     and not exists (select 1 from public.member_extra_positions e
                     where e.member_id = new.member_id and e.position_code = new.position_code) then
    raise exception '해당 멤버는 % 포지션이 지정되어 있지 않습니다.', p.name;
  end if;
  new.is_guest := false;
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 2. 어쿠스틱 (선택 포지션: 기본 0명 · 최대 1명)
-- ---------------------------------------------------------------------
alter table public.positions drop constraint if exists positions_counts_check;
alter table public.positions add constraint positions_counts_check
  check (base_count between 0 and 8 and max_count between 1 and 8 and base_count <= max_count);

insert into public.positions (code, name, kind, max_count, base_count, sort_order, is_recruiting)
values ('acoustic', '어쿠스틱', 'band', 1, 0, 8, false)
on conflict (code) do nothing;


-- ---------------------------------------------------------------------
-- 3. 찬양 기록
-- ---------------------------------------------------------------------
create table if not exists public.songs (
  id          bigint generated always as identity primary key,
  title       text not null check (length(trim(title)) between 1 and 80),
  norm        text not null unique check (length(norm) between 1 and 80),   -- 띄어쓰기 없앤 소문자 (같은 곡 찾기)
  main_key    text check (length(main_key) <= 12),
  memo        text check (length(memo) <= 300),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create or replace function public.songs_norm()
returns trigger
language plpgsql
as $$
begin
  new.title := trim(new.title);
  new.norm := lower(regexp_replace(new.title, '\s', '', 'g'));
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists songs_norm on public.songs;
create trigger songs_norm
  before insert or update of title on public.songs
  for each row execute function public.songs_norm();

-- 주일(또는 예배)마다 한 줄 — 인도자 이름 · 특별예배 이름. 콘티 곡이 없으면 '콘티 기록 없음'
create table if not exists public.setlists (
  id            bigint generated always as identity primary key,
  service_date  date not null unique,
  leaders       text[] not null default '{}',
  note          text check (length(note) <= 60),
  source        text not null default 'import' check (source in ('import', 'platform')),
  created_at    timestamptz not null default now()
);

create table if not exists public.setlist_items (
  id          bigint generated always as identity primary key,
  setlist_id  bigint not null references public.setlists(id) on delete cascade,
  ord         smallint not null check (ord between 1 and 30),
  song_id     bigint not null references public.songs(id),
  key         text check (length(key) <= 12),
  medley      boolean not null default false,
  refs        jsonb not null default '[]'::jsonb check (jsonb_typeof(refs) = 'array'),   -- [[유튜브 id, 시작 초, 메모], ...]
  unique (setlist_id, ord)
);
create index if not exists setlist_items_song_idx on public.setlist_items (song_id);

-- 지난 라인업 (콘티방 기록). 이름 그대로 — 지금 멤버와의 연결(member_id)은 나중에 (v21.5)
create table if not exists public.lineup_history (
  id            bigint generated always as identity primary key,
  service_date  date not null,
  position      text not null references public.positions(code),
  slot          smallint not null default 1 check (slot between 1 and 8),
  person_name   text not null check (length(trim(person_name)) between 1 and 30),
  is_guest      boolean not null default false,
  member_id     uuid references public.members(id) on delete set null
);
create index if not exists lineup_history_date_idx on public.lineup_history (service_date);

alter table public.songs          enable row level security;
alter table public.setlists       enable row level security;
alter table public.setlist_items  enable row level security;
alter table public.lineup_history enable row level security;

do $$
declare t text;
begin
  foreach t in array array['songs', 'setlists', 'setlist_items', 'lineup_history'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for select using (public.is_member())', t || '_read', t);
    execute format('create policy %I on public.%I for all using (public.is_admin()) with check (public.is_admin())', t || '_admin', t);
  end loop;
end $$;

-- 기록 화면이 한 번에 읽는 묶음 (줄 수 제한 없이)
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
      order by sl.service_date) from public.setlists sl), '[]'::json),
    'lineup', coalesce((select json_agg(json_build_array(l.service_date, l.position, l.slot, l.person_name, l.is_guest) order by l.service_date, l.position, l.slot) from public.lineup_history l), '[]'::json)
  ) end;
$$;
revoke all on function public.history_bundle() from public, anon;
grant execute on function public.history_bundle() to authenticated;

-- 곡 고치기 기록 (변경 기록 019에 곡 추가)
drop trigger if exists audit_row on public.songs;
create trigger audit_row after insert or update or delete on public.songs
  for each row execute function public.audit_row('id', '', '', 'norm', '');

-- 확인: select status, count(*) from members group by status;
--       select code, base_count, max_count from positions order by sort_order;
--       select count(*) from songs;  select count(*) from setlists;  select count(*) from lineup_history;
