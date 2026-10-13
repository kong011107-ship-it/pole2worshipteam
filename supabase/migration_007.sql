-- =====================================================================
--  007 — 탈퇴 · 개인정보 파기
--  · 탈퇴(계정 삭제): 계정·연락처·지원서·서약·평가·수습 기록 삭제
--      남기는 것: 탈퇴 기록(이름·포지션·활동 기간·사유) — 재가입 확인용
--      지난 배치표: 이름만 남기고 '탈퇴' 표시
--  · 종료된 지원서: 종료 후 3개월이 지나면 일괄 삭제
--  · 재가입: 면담 후 수습 없이 바로 정식 (규정 제3조 바항)
--  migration_006 다음에 SQL Editor에서 한 번 실행하세요.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 탈퇴 기록
-- ---------------------------------------------------------------------
create table public.alumni (
  id             bigint generated always as identity primary key,
  name           text not null,
  main_position  text references public.positions(code),
  joined_at      date,
  left_at        date not null default current_date,
  reason         text check (length(reason) <= 200),
  created_by     uuid references public.members(id) on delete set null,
  created_at     timestamptz not null default now()
);

alter table public.alumni enable row level security;
create policy alumni_admin on public.alumni for all
  using (public.is_admin()) with check (public.is_admin());


-- ---------------------------------------------------------------------
-- 2. 지난 배치표 보존: 멤버가 지워져도 배치 칸은 이름과 함께 남음
-- ---------------------------------------------------------------------
alter table public.assignments add column if not exists former_name text;
alter table public.assignments alter column member_id drop not null;
alter table public.assignments drop constraint if exists assignments_member_id_fkey;
alter table public.assignments add constraint assignments_member_id_fkey
  foreign key (member_id) references public.members(id) on delete set null;

-- 탈퇴로 member_id가 비는 경우는 검사 건너뜀
create or replace function public.assignments_validate()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  p public.positions;
  m public.members;
begin
  if new.member_id is null then
    if tg_op = 'INSERT' then raise exception '배치할 멤버가 없습니다.'; end if;
    return new;
  end if;

  select * into p from public.positions where code = new.position_code;
  select * into m from public.members where id = new.member_id;

  if m.id is null or not m.is_active or m.status <> 'active' then
    raise exception '활동 중인 정식 팀원만 배치할 수 있습니다.';
  end if;
  if new.slot > p.max_count then
    raise exception '% 자리는 최대 %명입니다.', p.name, p.max_count;
  end if;
  if new.is_singer_leader and p.kind <> 'vocal' then
    raise exception '싱어 리더는 싱어 중에서만 지정할 수 있습니다.';
  end if;
  if new.is_band_master and p.kind <> 'band' then
    raise exception '밴드 마스터는 세션 중에서만 지정할 수 있습니다.';
  end if;
  if m.main_position <> new.position_code
     and not exists (select 1 from public.member_extra_positions e
                     where e.member_id = new.member_id and e.position_code = new.position_code) then
    raise exception '해당 멤버는 % 포지션이 지정되어 있지 않습니다.', p.name;
  end if;
  return new;
end;
$$;

-- 멤버에게 보이는 배치표: 탈퇴한 멤버도 이름으로 표시
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
  coalesce(m.name, a.former_name || ' (탈퇴)', '탈퇴한 멤버') as member_name,
  a.is_singer_leader,
  a.is_band_master
from public.services s
join public.assignments a on a.service_id = s.id
join public.positions  p on p.code = a.position_code
left join public.members m on m.id = a.member_id
where s.status = 'published'
  and public.is_member();

revoke all on public.published_lineups from anon;
grant select on public.published_lineups to authenticated;

-- 멤버 행이 지워져도 지원서 연결 때문에 막히지 않도록
alter table public.members drop constraint if exists members_application_id_fkey;
alter table public.members add constraint members_application_id_fkey
  foreign key (application_id) references public.applications(id) on delete set null;


-- ---------------------------------------------------------------------
-- 3. 종료된 지원서 일괄 삭제 (종료 후 3개월)
--    미선발 · 보류 · 추후 재지원 권유. 중도 하차(계정 있음)는 탈퇴 처리로.
-- ---------------------------------------------------------------------
create or replace function public.purgeable_applications()
returns table (id uuid, name text, closed_reason text, closed_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.name, a.closed_reason, a.stage_changed_at
    from public.applications a
   where public.is_admin()
     and a.stage = 'closed'
     and a.closed_reason in ('not_selected', 'hold', 'reapply')
     and a.user_id is null
     and a.stage_changed_at < now() - interval '3 months'
   order by a.stage_changed_at;
$$;

create or replace function public.purge_closed_applications()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if not public.is_admin() then raise exception '관리자만 할 수 있습니다.'; end if;
  delete from public.applications a
   where a.stage = 'closed'
     and a.closed_reason in ('not_selected', 'hold', 'reapply')
     and a.user_id is null
     and a.stage_changed_at < now() - interval '3 months';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.purgeable_applications() from public, anon;
revoke all on function public.purge_closed_applications() from public, anon;
grant execute on function public.purgeable_applications() to authenticated;
grant execute on function public.purge_closed_applications() to authenticated;


-- ---------------------------------------------------------------------
-- 4. 재가입: 면접(면담) → 바로 정식 (수습 생략)
--    서버 API(/api/start-trainee, rejoin=true)가 계정을 만든 뒤 호출
-- ---------------------------------------------------------------------
create or replace function public.start_rejoin(
  p_application_id uuid,
  p_user_id        uuid,
  p_main_position  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.applications;
begin
  select * into a from public.applications where id = p_application_id for update;
  if a.id is null then raise exception '지원서를 찾을 수 없습니다.'; end if;
  if a.stage <> 'interview' then raise exception '면접(면담) 단계에서만 재가입 처리할 수 있습니다.'; end if;

  insert into public.members (id, application_id, name, phone, email, main_position, status, must_change_password)
  values (p_user_id, a.id, a.name, a.phone, a.email,
          coalesce(p_main_position, a.applied_position), 'active', true);

  perform set_config('app.stage_change', 'on', true);
  update public.applications
     set stage = 'member', user_id = p_user_id, interview_result = 'pass',
         converted_at = now(), reviewed_at = now(),
         admin_memo = trim(coalesce(admin_memo, '') || ' [재가입 · 수습 생략]')
   where id = a.id;
  perform set_config('app.stage_change', '', true);
end;
$$;

revoke all on function public.start_rejoin(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.start_rejoin(uuid, uuid, text) to service_role;


-- ---------------------------------------------------------------------
-- 5. 계정이 지워질 때 지원서의 계정 연결(user_id)이 비는 것은 허용
--    (Supabase 대시보드에서 사용자를 지워도 막히지 않도록)
-- ---------------------------------------------------------------------
create or replace function public.applications_guard_stage()
returns trigger
language plpgsql
as $$
begin
  if (new.stage is distinct from old.stage
      or new.closed_reason is distinct from old.closed_reason
      or (new.user_id is distinct from old.user_id and new.user_id is not null)
      or new.converted_at is distinct from old.converted_at)
     and coalesce(current_setting('app.stage_change', true), '') <> 'on' then
    raise exception '지원 단계는 단계 이동 기능으로만 바꿀 수 있습니다.';
  end if;
  if new.stage is distinct from old.stage then
    new.stage_changed_at := now();
  end if;
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 6. 리더십 테스트용 더미 데이터 도우미 (서버 API 전용)
--    지원자를 원하는 단계·날짜로 옮길 때만 사용. 일반 사용자·관리자는 호출 불가.
-- ---------------------------------------------------------------------
create or replace function public.demo_set_stage(
  p_id           uuid,
  p_stage        text,
  p_reason       text default null,
  p_interview_at timestamptz default null,
  p_place        text default null,
  p_changed_at   timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.stage_change', 'on', true);
  update public.applications
     set stage = p_stage,
         closed_reason = case when p_stage = 'closed' then p_reason end,
         closed_from = case when p_stage = 'closed' then 'interview' end,
         interview_at = coalesce(p_interview_at, interview_at),
         interview_place = coalesce(p_place, interview_place)
   where id = p_id;
  perform set_config('app.stage_change', '', true);
  if p_changed_at is not null then
    update public.applications set stage_changed_at = p_changed_at where id = p_id;
  end if;
end;
$$;

revoke all on function public.demo_set_stage(uuid, text, text, timestamptz, text, timestamptz) from public, anon, authenticated;
grant execute on function public.demo_set_stage(uuid, text, text, timestamptz, text, timestamptz) to service_role;
