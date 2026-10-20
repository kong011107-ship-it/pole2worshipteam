-- =====================================================================
--  017 — 인원 전망 (v18)
--  · members.role_title : 리더십 직책 (팀장 · 싱어팀장 · 밴드팀장 · 총무) — 직책마다 한 명
--  · forecast_exits     : 이탈 가정 (낙관 / 비관 추가) — 누가 몇 기부터 빠지는지, 돌아오는 기
--      비관 = 낙관 + 비관에 추가한 사람. 한 사람은 한 곳에만 넣어요
--      리더십만 보고 고쳐요 (본인에게도 안 보여요)
--  · team_settings.forecast : 기준 설정 (지금 기 · 졸업 기수 · 포지션별 최소/여유 인원 · 직책 후보 조건 · 충원자 기수 · 전망 기간)
--      비어 있으면 화면의 기본값을 써요
--  migration_016 다음에 SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 괜찮아요.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 리더십 직책
-- ---------------------------------------------------------------------
alter table public.members
  add column if not exists role_title text check (role_title in ('team_lead', 'singer_lead', 'band_lead', 'treasurer'));
create unique index if not exists members_one_role_title on public.members (role_title) where role_title is not null;


-- ---------------------------------------------------------------------
-- 2. 멤버 수정 규칙 (016에 직책 추가)
-- ---------------------------------------------------------------------
create or replace function public.members_guard_update()
returns trigger
language plpgsql
as $$
declare
  priv boolean := auth.uid() is null or coalesce(auth.role(), '') = 'service_role';
begin
  if not priv then
    if not public.is_admin() then
      if new.role is distinct from old.role
         or new.status is distinct from old.status
         or new.main_position is distinct from old.main_position
         or new.is_active is distinct from old.is_active
         or new.application_id is distinct from old.application_id
         or new.name is distinct from old.name
         or new.email is distinct from old.email
         or new.small_group is distinct from old.small_group
         or new.served_since is distinct from old.served_since
         or new.gender is distinct from old.gender
         or new.is_owner is distinct from old.is_owner
         or new.cohort is distinct from old.cohort
         or new.birth_date is distinct from old.birth_date
         or new.gift_join is distinct from old.gift_join
         or new.role_title is distinct from old.role_title then
        raise exception '이 항목은 관리자만 수정할 수 있습니다.';
      end if;
    end if;
    if new.is_owner is distinct from old.is_owner then
      raise exception '최상위 리더십은 설정 › 최상위 리더십 넘기기로만 바꿀 수 있어요.';
    end if;
    if new.role is distinct from old.role and not public.is_owner() then
      raise exception '리더십 지정·해제는 최상위 리더십만 할 수 있어요.';
    end if;
    if old.is_owner and auth.uid() <> old.id
       and (new.is_active is distinct from old.is_active
         or new.role is distinct from old.role
         or new.email is distinct from old.email
         or new.must_change_password is distinct from old.must_change_password) then
      raise exception '최상위 리더십 계정은 본인만 바꿀 수 있어요.';
    end if;
  end if;
  if new.is_owner and (new.role <> 'admin' or not new.is_active) then
    raise exception '최상위 리더십은 활동 중인 리더십이어야 해요. 먼저 다른 사람에게 넘겨 주세요.';
  end if;
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 3. 이탈 가정
--    out_term : 이 기부터 없음 (예: 21 = 21기부터 빠짐)
--    back_term: 이 기부터 다시 함께함 (군입대 등, 비어 있으면 안 돌아옴)
-- ---------------------------------------------------------------------
create table if not exists public.forecast_exits (
  id          bigint generated always as identity primary key,
  member_id   uuid not null unique references public.members(id) on delete cascade,
  scenario    text not null check (scenario in ('opt', 'pess')),
  reason      text not null check (reason in ('military', 'abroad', 'move', 'etc')),
  out_term    smallint not null check (out_term between 1 and 200),
  back_term   smallint check (back_term between 1 and 200),
  note        text check (length(note) <= 100),
  created_by  uuid references public.members(id) on delete set null default auth.uid(),
  updated_at  timestamptz not null default now(),
  check (back_term is null or back_term > out_term)
);

drop trigger if exists forecast_exits_touch on public.forecast_exits;
create trigger forecast_exits_touch
  before update on public.forecast_exits
  for each row execute function public.touch_updated_at();

alter table public.forecast_exits enable row level security;
drop policy if exists forecast_exits_admin on public.forecast_exits;
create policy forecast_exits_admin on public.forecast_exits for all
  using (public.is_admin()) with check (public.is_admin());


-- ---------------------------------------------------------------------
-- 4. 기준 설정
-- ---------------------------------------------------------------------
alter table public.team_settings
  add column if not exists forecast jsonb;


-- ---------------------------------------------------------------------
-- 5. 초기화(015)에 이탈 가정 포함
-- ---------------------------------------------------------------------
create or replace function public.reset_team_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.forecast_exits where true;

  delete from public.poll_votes where true;
  delete from public.poll_options where true;
  delete from public.polls where true;

  delete from public.notification_inbox where true;
  delete from public.notifications where true;
  delete from public.notify_sent where true;

  delete from public.prayer_taps where true;
  delete from public.prayers where true;

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
end;
$$;

revoke all on function public.reset_team_data() from public, anon, authenticated;
grant execute on function public.reset_team_data() to service_role;

-- 확인: select name, role_title from members where role_title is not null;  /  select count(*) from forecast_exits;
