-- =====================================================================
--  011 — 배치 개편 (v12)
--  · 성별: 지원서·멤버 (배치 추천에서 싱어 성비에 사용)
--  · 배치 추천 기준에 '성비' 추가 (순서 4개)
--  · 사역 연습을 예배별로 확정 (ministry_practices.service_id)
--  · 연습 가능 시간 취합: 기간 대신 날짜를 골라서 받기 (ministries.poll_dates)
--  migration_010 다음에 SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 괜찮아요.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 성별 (m 남 / f 여, 비어 있으면 성비 계산에서 빠짐)
-- ---------------------------------------------------------------------
alter table public.applications
  add column if not exists gender text check (gender in ('m', 'f'));
alter table public.members
  add column if not exists gender text check (gender in ('m', 'f'));

-- 지원서로 들어온 사람: 지원서의 성별을 옮겨 옴 (이미 있는 멤버 + 앞으로 수습 시작·재가입)
update public.members m
   set gender = a.gender
  from public.applications a
 where a.id = m.application_id and m.gender is null and a.gender is not null;

create or replace function public.members_copy_gender()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.gender is null and new.application_id is not null then
    select gender into new.gender from public.applications where id = new.application_id;
  end if;
  return new;
end;
$$;

drop trigger if exists members_copy_gender on public.members;
create trigger members_copy_gender
  before insert on public.members
  for each row execute function public.members_copy_gender();

-- 성별은 리더십만 바꿀 수 있음 (본인 수정 불가 항목에 추가)
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
       or new.served_since is distinct from old.served_since
       or new.gender is distinct from old.gender then
      raise exception '이 항목은 관리자만 수정할 수 있습니다.';
    end if;
  end if;
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 2. 배치 추천 기준: 실력 균형 · 골고루 · 연속 감점 · 성비
-- ---------------------------------------------------------------------
alter table public.team_settings drop constraint if exists team_settings_rec_order_check;
do $$
declare c text;
begin
  -- 010에서 이름 없이 만든 rec_order 검사 조건 지우기
  for c in select conname from pg_constraint
            where conrelid = 'public.team_settings'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%rec_order%' loop
    execute format('alter table public.team_settings drop constraint %I', c);
  end loop;
end $$;

update public.team_settings
   set rec_order = rec_order || '{gender}'::text[]
 where not ('gender' = any (rec_order));

alter table public.team_settings alter column rec_order set default '{skill,balance,consecutive,gender}';
alter table public.team_settings add constraint team_settings_rec_order_check
  check (rec_order <@ array['skill', 'balance', 'consecutive', 'gender'] and cardinality(rec_order) = 4);


-- ---------------------------------------------------------------------
-- 3. 사역 연습: 예배별 (비어 있으면 사역 전체 = 010까지의 방식)
-- ---------------------------------------------------------------------
alter table public.ministry_practices
  add column if not exists service_id uuid references public.services(id) on delete cascade;
create index if not exists ministry_practices_service_idx on public.ministry_practices (service_id);


-- ---------------------------------------------------------------------
-- 4. 연습 가능 시간 취합: 날짜 골라서 받기 (비어 있으면 poll_from ~ poll_to 기간)
-- ---------------------------------------------------------------------
alter table public.ministries
  add column if not exists poll_dates date[];
alter table public.ministries drop constraint if exists ministries_poll_dates_check;
alter table public.ministries add constraint ministries_poll_dates_check
  check (poll_dates is null or cardinality(poll_dates) between 1 and 31);
