-- =====================================================================
--  009 — 멤버 정보 수정 · 리더십 메모 · 주일 리허설 · 결석 사유
--  · members: 순모임(small_group), 함께한 날(served_since) 추가
--  · member_notes: 리더십만 보는 메모 (본인에게도 안 보임)
--  · 출석: 주일 리허설(kind = rehearsal) 추가, '사유결석' 없앰
--          결석은 사유(칩 reason_tag 또는 직접 입력 reason)가 있어야 저장
--  migration_008 다음에 SQL Editor에서 한 번 실행하세요.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 멤버 정보
-- ---------------------------------------------------------------------
alter table public.members
  add column if not exists small_group  text check (length(small_group) <= 30),
  add column if not exists served_since date;

-- 지원서로 들어온 사람은 지원서의 순모임을 옮겨 옴
update public.members m
   set small_group = a.small_group
  from public.applications a
 where a.id = m.application_id and m.small_group is null and a.small_group is not null;

-- 리더십 메모 (관리자만 읽고 씀)
create table if not exists public.member_notes (
  member_id   uuid primary key references public.members(id) on delete cascade,
  note        text not null check (length(note) <= 1000),
  updated_by  uuid references public.members(id) on delete set null default auth.uid(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists member_notes_touch on public.member_notes;
create trigger member_notes_touch
  before update on public.member_notes
  for each row execute function public.touch_updated_at();

alter table public.member_notes enable row level security;
drop policy if exists member_notes_admin on public.member_notes;
create policy member_notes_admin on public.member_notes for all
  using (public.is_admin()) with check (public.is_admin());

-- 본인이 바꿀 수 없는 항목에 순모임·함께한 날 추가
create or replace function public.members_guard_update()
returns trigger
language plpgsql
as $$
begin
  if not public.is_admin() and auth.role() <> 'service_role' then
    if new.role is distinct from old.role
       or new.status is distinct from old.status
       or new.main_position is distinct from old.main_position
       or new.is_active is distinct from old.is_active
       or new.application_id is distinct from old.application_id
       or new.name is distinct from old.name
       or new.email is distinct from old.email
       or new.small_group is distinct from old.small_group
       or new.served_since is distinct from old.served_since then
      raise exception '이 항목은 관리자만 수정할 수 있습니다.';
    end if;
  end if;
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 2. 출석: 주일 리허설 · 결석 사유
-- ---------------------------------------------------------------------
alter table public.attendance
  add column if not exists reason_tag text,
  add column if not exists reason     text check (length(reason) <= 200);

-- 기존 '사유결석'은 결석으로 (사유 미기입)
update public.attendance set status = 'absent', reason = coalesce(reason, memo, '(사유 미기입)')
 where status = 'excused';

alter table public.attendance drop constraint if exists attendance_kind_check;
alter table public.attendance add constraint attendance_kind_check
  check (kind in ('practice', 'meeting', 'rehearsal'));

alter table public.attendance drop constraint if exists attendance_status_check;
alter table public.attendance add constraint attendance_status_check
  check (status in ('present', 'late', 'absent'));

alter table public.attendance drop constraint if exists attendance_reason_tag_check;
alter table public.attendance add constraint attendance_reason_tag_check
  check (reason_tag in ('직장', '학업·시험', '가족 일정', '건강', '여행·지방', '교회 다른 섬김'));

-- 결석은 사유가 있어야 함. 결석이 아니면 사유를 비움
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

-- 출석률 뷰: 결석 사유 반영 (팀모임 기준 + 연습·리허설 지각)
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
  count(at.*) filter (where at.kind = 'practice' and at.status = 'late')                  as practice_late,
  count(at.*) filter (where at.kind = 'rehearsal' and at.status = 'late')                 as rehearsal_late
from public.members m
left join public.attendance at on at.member_id = m.id
where m.is_active
group by m.id, m.name, m.main_position;
