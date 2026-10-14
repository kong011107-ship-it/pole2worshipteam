-- =====================================================================
--  008 — 토요일 출석 (연습 · 팀모임) + 대시보드
--  · 토요일마다 한 줄(team_meetings): 팀모임 여부 있음 / 없음 / 미정
--  · 출석은 두 가지(kind): practice(토요 연습 · 그 주 섬김 인원)
--                          meeting (팀모임 · 활동 중인 전체 팀원)
--  · 상태: 출석 present / 지각 late / 결석 absent / 사유결석 excused
--  migration_007 다음에 SQL Editor에서 한 번 실행하세요.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 토요일 = 한 줄. 팀모임 여부
-- ---------------------------------------------------------------------
alter table public.team_meetings
  add column if not exists meeting_status text not null default 'tbd'
    check (meeting_status in ('yes', 'no', 'tbd')),
  add column if not exists updated_at timestamptz not null default now();

-- 같은 토요일은 한 줄만, 토요일만
create unique index if not exists team_meetings_date_uniq on public.team_meetings (meeting_date);
alter table public.team_meetings drop constraint if exists team_meetings_saturday;
alter table public.team_meetings add constraint team_meetings_saturday
  check (extract(isodow from meeting_date) = 6) not valid;

drop trigger if exists team_meetings_touch on public.team_meetings;
create trigger team_meetings_touch
  before update on public.team_meetings
  for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------
-- 2. 출석: 연습 / 팀모임 구분
-- ---------------------------------------------------------------------
alter table public.attendance
  add column if not exists kind text not null default 'meeting'
    check (kind in ('practice', 'meeting')),
  add column if not exists updated_by uuid references public.members(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.attendance drop constraint if exists attendance_pkey;
alter table public.attendance add primary key (meeting_id, member_id, kind);
create index if not exists attendance_member_idx on public.attendance (member_id, kind);

-- 팀모임이 '없음'인 날에는 팀모임 출석을 적을 수 없음.
-- '미정'인 날에 팀모임 출석을 적으면 '있음'으로 바뀜.
create or replace function public.attendance_validate()
returns trigger
language plpgsql
set search_path = public
as $$
declare st text;
begin
  if new.kind = 'meeting' then
    select meeting_status into st from public.team_meetings where id = new.meeting_id;
    if st = 'no' then
      raise exception '팀모임이 없는 날이에요. 팀모임 여부를 먼저 바꿔 주세요.';
    end if;
    if st = 'tbd' then
      update public.team_meetings set meeting_status = 'yes' where id = new.meeting_id;
    end if;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

drop trigger if exists attendance_validate on public.attendance;
create trigger attendance_validate
  before insert or update on public.attendance
  for each row execute function public.attendance_validate();

-- 팀모임을 '없음'으로 바꾸면 그날 팀모임 출석 기록은 지움 (연습 기록은 그대로)
create or replace function public.team_meetings_clear_on_no()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.meeting_status = 'no' and old.meeting_status is distinct from 'no' then
    delete from public.attendance where meeting_id = new.id and kind = 'meeting';
  end if;
  return new;
end;
$$;

drop trigger if exists team_meetings_clear_on_no on public.team_meetings;
create trigger team_meetings_clear_on_no
  after update on public.team_meetings
  for each row execute function public.team_meetings_clear_on_no();


-- ---------------------------------------------------------------------
-- 3. 출석률 뷰: 팀모임 기준으로 다시 정의 (연습 지각은 따로)
-- ---------------------------------------------------------------------
create or replace view public.attendance_rates
with (security_invoker = true) as
select
  m.id   as member_id,
  m.name,
  m.main_position,
  count(at.*) filter (where at.kind = 'meeting')                                          as recorded,
  count(at.*) filter (where at.kind = 'meeting' and at.status in ('present', 'late'))     as attended,
  round(100.0 * count(at.*) filter (where at.kind = 'meeting' and at.status in ('present', 'late'))
        / nullif(count(at.*) filter (where at.kind = 'meeting'), 0), 0)                   as rate,
  count(at.*) filter (where at.kind = 'practice' and at.status = 'late')                  as practice_late
from public.members m
left join public.attendance at on at.member_id = m.id
where m.is_active
group by m.id, m.name, m.main_position;
