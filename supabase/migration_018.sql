-- =====================================================================
--  018 — 포지션 기본/최대 인원 · 리더십 승계 · 기도제목 숨김 (v19)
--  · positions.base_count : 기본 인원 (자동 추천이 채우는 자리). max_count 는 최대 인원
--      처음 한 번만: 인도 1/2 · 싱어 4/6 · 일렉 1/2 · 나머지 1/1 (이후엔 설정 › 포지션별 인원에서 바꿔요)
--  · members.title_until  : 직책 예상 종료 — 이 기까지 맡음 (비어 있으면 졸업까지). 리더십만
--  · forecast_heirs       : 직책별 승계 후보 (직책마다 2명까지). 리더십만
--  · prayers.hidden_at    : 리더십이 숨긴 기도제목 — 팀원에게 안 보이고, 나눔 관리에서 복원할 수 있어요
--  migration_017 다음에 SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 괜찮아요.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 포지션 기본 / 최대 인원
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'positions' and column_name = 'base_count') then
    alter table public.positions add column base_count int;
    update public.positions set base_count = max_count;
    -- v19 기본값 (처음 한 번만)
    update public.positions set base_count = 1, max_count = 2 where code = 'leader';
    update public.positions set base_count = 4, max_count = 6 where code = 'singer';
    update public.positions set base_count = 1, max_count = 2 where code = 'e_guitar';
    alter table public.positions alter column base_count set not null;
    alter table public.positions alter column base_count set default 1;
  end if;
end $$;

alter table public.positions drop constraint if exists positions_counts_check;
alter table public.positions add constraint positions_counts_check
  check (base_count between 1 and 8 and max_count between 1 and 8 and base_count <= max_count);


-- ---------------------------------------------------------------------
-- 2. 직책 예상 종료 (이 기까지 맡음)
-- ---------------------------------------------------------------------
alter table public.members
  add column if not exists title_until smallint check (title_until between 1 and 200);

-- 직책이 없어지거나 바뀌면 예상 종료도 비움
create or replace function public.members_title_until_reset()
returns trigger
language plpgsql
as $$
begin
  if new.role_title is distinct from old.role_title and new.title_until is not distinct from old.title_until then
    new.title_until := null;
  end if;
  if new.role_title is null then new.title_until := null; end if;
  return new;
end;
$$;
drop trigger if exists members_title_until_reset on public.members;
create trigger members_title_until_reset
  before update on public.members
  for each row execute function public.members_title_until_reset();

-- 멤버 수정 규칙 (017에 직책 예상 종료 추가)
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
         or new.role_title is distinct from old.role_title
         or new.title_until is distinct from old.title_until then
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
-- 3. 승계 후보 (직책마다 2명까지)
-- ---------------------------------------------------------------------
create table if not exists public.forecast_heirs (
  role_title  text not null check (role_title in ('team_lead', 'singer_lead', 'band_lead', 'treasurer')),
  member_id   uuid not null references public.members(id) on delete cascade,
  rank        smallint not null default 1 check (rank between 1 and 2),
  created_by  uuid references public.members(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  primary key (role_title, member_id)
);

create or replace function public.forecast_heirs_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.forecast_heirs where role_title = new.role_title and member_id <> new.member_id) >= 2 then
    raise exception '승계 후보는 직책마다 2명까지예요.';
  end if;
  return new;
end;
$$;
drop trigger if exists forecast_heirs_limit on public.forecast_heirs;
create trigger forecast_heirs_limit
  before insert on public.forecast_heirs
  for each row execute function public.forecast_heirs_limit();

alter table public.forecast_heirs enable row level security;
drop policy if exists forecast_heirs_admin on public.forecast_heirs;
create policy forecast_heirs_admin on public.forecast_heirs for all
  using (public.is_admin()) with check (public.is_admin());


-- ---------------------------------------------------------------------
-- 4. 기도제목 숨김 (나눔 관리)
-- ---------------------------------------------------------------------
alter table public.prayers
  add column if not exists hidden_at timestamptz,
  add column if not exists hidden_by uuid references public.members(id) on delete set null;
create index if not exists prayers_hidden_idx on public.prayers (hidden_at) where hidden_at is not null;

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

-- 숨긴 기도제목은 리더십만 봐요
drop policy if exists prayers_read on public.prayers;
create policy prayers_read on public.prayers for select
  using (public.is_member() and (hidden_at is null or public.is_admin()));


-- ---------------------------------------------------------------------
-- 5. 초기화(017)에 승계 후보 포함
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

-- 확인: select code, base_count, max_count from positions order by sort_order;
