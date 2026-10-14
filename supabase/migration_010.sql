-- =====================================================================
--  010 — 섬김 일정 확장 · 객원 · 배치 자동 추천
--  · 시간: 토요 연습·주일 섬김 기본 시간(설정) + 날짜별로 바꾼 시간
--  · 사역: 원스텝·수련회 등 리더십이 추가하는 섬김 (예배 여러 개 가능)
--          응답(월말 응답에 포함 / 따로 받기), 응답 대상, 필수 포지션
--          연습 일정(이미 정해짐 → 가능 여부 / 가능 시간 취합 → 30분 칸 칠하기)
--          사역 연습 출석(출석·지각·결석)
--  · 객원: 계정 없이 이름·포지션만 저장, 배치표에 '(객원)'으로 표시
--  · 숙련도(포지션별 상·중·하, 리더십만) · 배치 추천 기준 순서
--  migration_009 다음에 SQL Editor에서 한 번 실행하세요.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 팀 설정 (한 줄): 기본 시간 · 배치 추천 기준
-- ---------------------------------------------------------------------
create table if not exists public.team_settings (
  id                  int primary key default 1 check (id = 1),
  sat_practice_start  time not null default '11:00',
  sat_practice_end    time not null default '13:30',
  sunday_start        time not null default '09:00',
  sunday_end          time not null default '12:30',
  rec_order           text[] not null default '{skill,balance,consecutive}',
  rec_basis           text not null default 'month' check (rec_basis in ('month', 'quarter')),
  updated_at          timestamptz not null default now(),
  check (sat_practice_end > sat_practice_start and sunday_end > sunday_start),
  check (rec_order <@ array['skill', 'balance', 'consecutive'] and cardinality(rec_order) = 3)
);
insert into public.team_settings (id) values (1) on conflict do nothing;

drop trigger if exists team_settings_touch on public.team_settings;
create trigger team_settings_touch
  before update on public.team_settings
  for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------
-- 2. 날짜별 시간 (비워 두면 기본 시간)
-- ---------------------------------------------------------------------
alter table public.team_meetings
  add column if not exists practice_start time,
  add column if not exists practice_end   time;


-- ---------------------------------------------------------------------
-- 3. 사역
-- ---------------------------------------------------------------------
create table if not exists public.ministries (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (length(trim(name)) between 1 and 40),
  required_positions  text[] not null default '{}',
  -- 섬김 가능 여부 응답: 월말 응답에 포함 / 따로 받기
  response_mode       text not null default 'monthly' check (response_mode in ('monthly', 'separate')),
  response_open       boolean not null default true,
  response_deadline   date,
  target_mode         text not null default 'all' check (target_mode in ('all', 'custom')),
  -- 연습 일정: 이미 정해짐(fixed) / 가능 시간 취합(poll)
  practice_mode       text not null default 'poll' check (practice_mode in ('fixed', 'poll')),
  poll_from           date,
  poll_to             date,
  poll_day_start      time not null default '10:00',
  poll_day_end        time not null default '23:00',
  practice_minutes    int  not null default 120 check (practice_minutes between 30 and 480),
  poll_deadline       date,
  poll_open           boolean not null default false,
  note                text check (length(note) <= 300),
  created_by          uuid references public.members(id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (poll_day_end > poll_day_start),
  check (poll_from is null or poll_to is null or (poll_to >= poll_from and poll_to - poll_from <= 30))
);

drop trigger if exists ministries_touch on public.ministries;
create trigger ministries_touch
  before update on public.ministries
  for each row execute function public.touch_updated_at();

-- 응답 대상을 직접 고를 때
create table if not exists public.ministry_targets (
  ministry_id  uuid not null references public.ministries(id) on delete cascade,
  member_id    uuid not null references public.members(id) on delete cascade,
  primary key (ministry_id, member_id)
);

-- 주일 배치(services)에 사역 예배도 함께 담음: ministry_id가 있으면 사역 예배
alter table public.services
  add column if not exists ministry_id uuid references public.ministries(id) on delete cascade,
  add column if not exists label       text check (length(label) <= 30),
  add column if not exists start_time  time,
  add column if not exists end_time    time,
  add column if not exists sort_order  int not null default 0;

alter table public.services drop constraint if exists services_service_date_key;
alter table public.services drop constraint if exists services_service_date_check;
create unique index if not exists services_sunday_uniq on public.services (service_date) where ministry_id is null;
alter table public.services drop constraint if exists services_sunday_or_ministry;
alter table public.services add constraint services_sunday_or_ministry
  check (ministry_id is not null or extract(isodow from service_date) = 7);
alter table public.services drop constraint if exists services_time_order;
alter table public.services add constraint services_time_order
  check (start_time is null or end_time is null or end_time > start_time);
create index if not exists services_ministry_idx on public.services (ministry_id, service_date);

-- 사역 예배별 섬김 가능 여부
create table if not exists public.ministry_availability (
  service_id  uuid not null references public.services(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  available   boolean not null,
  updated_at  timestamptz not null default now(),
  primary key (service_id, member_id)
);

drop trigger if exists ministry_availability_touch on public.ministry_availability;
create trigger ministry_availability_touch
  before update on public.ministry_availability
  for each row execute function public.touch_updated_at();

-- 사역 연습 가능 시간 (30분 칸 시작 시각 목록: 'YYYY-MM-DD HH:MM')
create table if not exists public.ministry_poll (
  ministry_id  uuid not null references public.ministries(id) on delete cascade,
  member_id    uuid not null references public.members(id) on delete cascade,
  slots        text[] not null default '{}' check (cardinality(slots) <= 1500),
  updated_at   timestamptz not null default now(),
  primary key (ministry_id, member_id)
);

drop trigger if exists ministry_poll_touch on public.ministry_poll;
create trigger ministry_poll_touch
  before update on public.ministry_poll
  for each row execute function public.touch_updated_at();

-- 확정된 사역 연습 (이미 정해진 일정 또는 취합 후 확정)
create table if not exists public.ministry_practices (
  id            uuid primary key default gen_random_uuid(),
  ministry_id   uuid not null references public.ministries(id) on delete cascade,
  practice_date date not null,
  start_time    time not null,
  end_time      time not null,
  created_at    timestamptz not null default now(),
  check (end_time > start_time)
);
create index if not exists ministry_practices_idx on public.ministry_practices (ministry_id, practice_date);

-- 이미 정해진 연습에 대한 가능 여부
create table if not exists public.practice_answers (
  practice_id  uuid not null references public.ministry_practices(id) on delete cascade,
  member_id    uuid not null references public.members(id) on delete cascade,
  available    boolean not null,
  updated_at   timestamptz not null default now(),
  primary key (practice_id, member_id)
);

-- 사역 연습 출석 (토요 연습과 같은 규칙: 결석은 사유 필수)
create table if not exists public.practice_attendance (
  practice_id  uuid not null references public.ministry_practices(id) on delete cascade,
  member_id    uuid not null references public.members(id) on delete cascade,
  status       text not null check (status in ('present', 'late', 'absent')),
  reason_tag   text check (reason_tag in ('직장', '학업·시험', '가족 일정', '건강', '여행·지방', '교회 다른 섬김')),
  reason       text check (length(reason) <= 200),
  updated_by   uuid references public.members(id) on delete set null,
  updated_at   timestamptz not null default now(),
  primary key (practice_id, member_id)
);

create or replace function public.practice_attendance_validate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.reason := nullif(trim(new.reason), '');
  if new.status = 'absent' then
    if new.reason_tag is null and new.reason is null then
      raise exception '결석 사유를 적어 주세요.';
    end if;
  else
    new.reason_tag := null;
    new.reason := null;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

drop trigger if exists practice_attendance_validate on public.practice_attendance;
create trigger practice_attendance_validate
  before insert or update on public.practice_attendance
  for each row execute function public.practice_attendance_validate();


-- ---------------------------------------------------------------------
-- 4. 객원
-- ---------------------------------------------------------------------
create table if not exists public.guests (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 30),
  positions   text[] not null default '{}',
  phone       text check (phone is null or phone ~ '^[0-9\-]{9,13}$'),
  note        text check (length(note) <= 200),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create or replace function public.guests_validate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if cardinality(new.positions) = 0 then
    raise exception '객원 포지션을 하나 이상 골라 주세요.';
  end if;
  if exists (select 1 from unnest(new.positions) c where c not in (select code from public.positions)) then
    raise exception '알 수 없는 포지션이 있어요.';
  end if;
  return new;
end;
$$;

drop trigger if exists guests_validate on public.guests;
create trigger guests_validate
  before insert or update on public.guests
  for each row execute function public.guests_validate();

alter table public.assignments
  add column if not exists guest_id    uuid references public.guests(id) on delete set null,
  add column if not exists is_guest    boolean not null default false,
  add column if not exists recommended boolean not null default false;

-- 배치 규칙: 정식 팀원 또는 객원
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

  -- 객원
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

  -- 탈퇴(멤버 삭제)·객원 삭제로 비는 경우는 검사 건너뜀
  if new.member_id is null then
    if tg_op = 'INSERT' then raise exception '배치할 멤버가 없습니다.'; end if;
    return new;
  end if;

  select * into m from public.members where id = new.member_id;
  if m.id is null or not m.is_active or m.status <> 'active' then
    raise exception '활동 중인 정식 팀원만 배치할 수 있습니다.';
  end if;
  if m.main_position <> new.position_code
     and not exists (select 1 from public.member_extra_positions e
                     where e.member_id = new.member_id and e.position_code = new.position_code) then
    raise exception '해당 멤버는 % 포지션이 지정되어 있지 않습니다.', p.name;
  end if;
  new.is_guest := false;
  return new;
end;
$$;

-- 멤버에게 보이는 배치표: 객원 '(객원)', 탈퇴 '(탈퇴)'. 사역 예배·시간 포함
create or replace view public.published_lineups
with (security_invoker = false) as
select
  s.service_date,
  s.note,
  p.sort_order,
  p.code      as position_code,
  p.name      as position_name,
  a.slot,
  a.member_id,
  coalesce(m.name, g.name || ' (객원)',
           case when a.is_guest then a.former_name || ' (객원)' else a.former_name || ' (탈퇴)' end,
           '탈퇴한 멤버') as member_name,
  a.is_singer_leader,
  a.is_band_master,
  s.id        as service_id,
  s.ministry_id,
  mi.name     as ministry_name,
  s.label,
  s.start_time,
  s.end_time,
  a.is_guest
from public.services s
join public.assignments a on a.service_id = s.id
join public.positions  p on p.code = a.position_code
left join public.members m on m.id = a.member_id
left join public.guests  g on g.id = a.guest_id
left join public.ministries mi on mi.id = s.ministry_id
where s.status = 'published'
  and public.is_member();

revoke all on public.published_lineups from anon;
grant select on public.published_lineups to authenticated;


-- ---------------------------------------------------------------------
-- 5. 숙련도 (포지션별 상 3 · 중 2 · 하 1) — 리더십만
-- ---------------------------------------------------------------------
create table if not exists public.member_skills (
  member_id      uuid not null references public.members(id) on delete cascade,
  position_code  text not null references public.positions(code),
  level          smallint not null check (level between 1 and 3),
  updated_at     timestamptz not null default now(),
  primary key (member_id, position_code)
);


-- ---------------------------------------------------------------------
-- 6. 권한 판별 (팀원 응답용)
-- ---------------------------------------------------------------------
-- 내가 이 사역의 응답 대상인지
create or replace function public.ministry_targeted(p_ministry uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_member() and exists (
    select 1 from public.ministries mi
     where mi.id = p_ministry
       and (mi.target_mode = 'all'
            or exists (select 1 from public.ministry_targets t where t.ministry_id = mi.id and t.member_id = auth.uid()))
  );
$$;

-- 이 사역 예배의 섬김 응답을 지금 받는지 (월말 응답이 열렸거나, 따로 받기가 열렸거나)
create or replace function public.ministry_service_open(p_service uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.services s join public.ministries mi on mi.id = s.ministry_id
     where s.id = p_service
       and public.ministry_targeted(mi.id)
       and ((mi.response_mode = 'monthly' and public.is_month_open_for(s.service_date, 'sunday'))
         or (mi.response_mode = 'separate' and mi.response_open))
  );
$$;

-- 연습 가능 시간 칠하기: 취합 중이고, 본 섬김에 '가능'으로 답한 대상자
create or replace function public.ministry_poll_open_for_me(p_ministry uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ministries mi
     where mi.id = p_ministry and mi.poll_open
       and public.ministry_targeted(mi.id)
       and exists (select 1 from public.ministry_availability a join public.services s on s.id = a.service_id
                    where s.ministry_id = mi.id and a.member_id = auth.uid() and a.available)
  );
$$;

-- 이미 정해진 연습의 가능 여부: 그 사역 응답이 열려 있을 때
create or replace function public.practice_answer_open(p_practice uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ministry_practices pr
     where pr.id = p_practice
       and exists (select 1 from public.services s where s.ministry_id = pr.ministry_id and public.ministry_service_open(s.id))
  );
$$;

revoke all on function public.ministry_targeted(uuid) from anon;
revoke all on function public.ministry_service_open(uuid) from anon;
revoke all on function public.ministry_poll_open_for_me(uuid) from anon;
revoke all on function public.practice_answer_open(uuid) from anon;


-- ---------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------
alter table public.team_settings         enable row level security;
alter table public.ministries            enable row level security;
alter table public.ministry_targets      enable row level security;
alter table public.ministry_availability enable row level security;
alter table public.ministry_poll         enable row level security;
alter table public.ministry_practices    enable row level security;
alter table public.practice_answers      enable row level security;
alter table public.practice_attendance   enable row level security;
alter table public.guests                enable row level security;
alter table public.member_skills         enable row level security;

drop policy if exists settings_read on public.team_settings;
drop policy if exists settings_admin on public.team_settings;
create policy settings_read on public.team_settings for select using (public.is_member());
create policy settings_admin on public.team_settings for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists ministries_read on public.ministries;
drop policy if exists ministries_admin on public.ministries;
create policy ministries_read on public.ministries for select using (public.is_member());
create policy ministries_admin on public.ministries for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists ministry_targets_read on public.ministry_targets;
drop policy if exists ministry_targets_admin on public.ministry_targets;
create policy ministry_targets_read on public.ministry_targets for select
  using (member_id = auth.uid() or public.is_admin());
create policy ministry_targets_admin on public.ministry_targets for all
  using (public.is_admin()) with check (public.is_admin());

-- 사역 예배 날짜·시간은 팀원도 봄 (응답해야 하니까). 주일 배치는 여전히 공개된 것만
drop policy if exists services_read_ministry on public.services;
create policy services_read_ministry on public.services for select
  using (ministry_id is not null and public.is_member());

drop policy if exists m_avail_read on public.ministry_availability;
drop policy if exists m_avail_insert on public.ministry_availability;
drop policy if exists m_avail_update on public.ministry_availability;
drop policy if exists m_avail_delete on public.ministry_availability;
drop policy if exists m_avail_admin on public.ministry_availability;
create policy m_avail_read on public.ministry_availability for select
  using (member_id = auth.uid() or public.is_admin());
create policy m_avail_insert on public.ministry_availability for insert
  with check (member_id = auth.uid() and public.ministry_service_open(service_id));
create policy m_avail_update on public.ministry_availability for update
  using (member_id = auth.uid() and public.ministry_service_open(service_id))
  with check (member_id = auth.uid() and public.ministry_service_open(service_id));
create policy m_avail_delete on public.ministry_availability for delete
  using (member_id = auth.uid() and public.ministry_service_open(service_id));
create policy m_avail_admin on public.ministry_availability for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists m_poll_read on public.ministry_poll;
drop policy if exists m_poll_insert on public.ministry_poll;
drop policy if exists m_poll_update on public.ministry_poll;
drop policy if exists m_poll_delete on public.ministry_poll;
drop policy if exists m_poll_admin on public.ministry_poll;
create policy m_poll_read on public.ministry_poll for select
  using (member_id = auth.uid() or public.is_admin());
create policy m_poll_insert on public.ministry_poll for insert
  with check (member_id = auth.uid() and public.ministry_poll_open_for_me(ministry_id));
create policy m_poll_update on public.ministry_poll for update
  using (member_id = auth.uid() and public.ministry_poll_open_for_me(ministry_id))
  with check (member_id = auth.uid() and public.ministry_poll_open_for_me(ministry_id));
create policy m_poll_delete on public.ministry_poll for delete
  using (member_id = auth.uid() and public.ministry_poll_open_for_me(ministry_id));
create policy m_poll_admin on public.ministry_poll for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists m_practice_read on public.ministry_practices;
drop policy if exists m_practice_admin on public.ministry_practices;
create policy m_practice_read on public.ministry_practices for select using (public.is_member());
create policy m_practice_admin on public.ministry_practices for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists p_answer_read on public.practice_answers;
drop policy if exists p_answer_insert on public.practice_answers;
drop policy if exists p_answer_update on public.practice_answers;
drop policy if exists p_answer_delete on public.practice_answers;
drop policy if exists p_answer_admin on public.practice_answers;
create policy p_answer_read on public.practice_answers for select
  using (member_id = auth.uid() or public.is_admin());
create policy p_answer_insert on public.practice_answers for insert
  with check (member_id = auth.uid() and public.practice_answer_open(practice_id));
create policy p_answer_update on public.practice_answers for update
  using (member_id = auth.uid() and public.practice_answer_open(practice_id))
  with check (member_id = auth.uid() and public.practice_answer_open(practice_id));
create policy p_answer_delete on public.practice_answers for delete
  using (member_id = auth.uid() and public.practice_answer_open(practice_id));
create policy p_answer_admin on public.practice_answers for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists p_att_read on public.practice_attendance;
drop policy if exists p_att_admin on public.practice_attendance;
create policy p_att_read on public.practice_attendance for select
  using (member_id = auth.uid() or public.is_admin());
create policy p_att_admin on public.practice_attendance for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists guests_admin on public.guests;
create policy guests_admin on public.guests for all
  using (public.is_admin()) with check (public.is_admin());

-- 숙련도: 리더십만 (본인에게도 안 보임)
drop policy if exists skills_admin on public.member_skills;
create policy skills_admin on public.member_skills for all
  using (public.is_admin()) with check (public.is_admin());
