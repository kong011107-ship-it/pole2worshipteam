-- =====================================================================
--  016 — 기수 · 생년월일 · 생일선물 정산 · 생일 알림 (v17)
--  · applications / members : cohort(공동체 기수, 숫자) · birth_date(양력 생년월일)
--  · members.gift_join      : 생일선물 정산 참여 (true 참여 / false 미참여 / 비어 있음 = 미정)
--      셋 다 리더십만 바꿀 수 있어요. 본인은 '내 정보'에서 보기만 (팀원끼리는 안 보여요 — members는 원래 본인·리더십만 읽음)
--  · 지원서로 들어온 사람은 수습 시작·재가입 때 기수·생년월일을 멤버 정보로 옮겨 와요
--  · 알림 2종 : 생일 다가옴(기본 3일 전 오전 9시) · 생일 당일(오전 9시) — 리더십에게
--  migration_015 다음에 SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 괜찮아요.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 항목
-- ---------------------------------------------------------------------
alter table public.applications
  add column if not exists cohort     smallint check (cohort between 1 and 200),
  add column if not exists birth_date date check (birth_date between '1940-01-01' and '2020-12-31');
alter table public.members
  add column if not exists cohort     smallint check (cohort between 1 and 200),
  add column if not exists birth_date date check (birth_date between '1940-01-01' and '2020-12-31'),
  add column if not exists gift_join  boolean;

-- 지원서 → 멤버: 성별(011)에 기수 · 생년월일도 함께 옮김
create or replace function public.members_copy_gender()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare a public.applications;
begin
  if new.application_id is not null then
    select * into a from public.applications where id = new.application_id;
    new.gender     := coalesce(new.gender, a.gender);
    new.cohort     := coalesce(new.cohort, a.cohort);
    new.birth_date := coalesce(new.birth_date, a.birth_date);
  end if;
  return new;
end;
$$;

-- 이미 지원서로 들어온 멤버도 한 번 채움
update public.members m
   set cohort = coalesce(m.cohort, a.cohort), birth_date = coalesce(m.birth_date, a.birth_date)
  from public.applications a
 where a.id = m.application_id and (m.cohort is null or m.birth_date is null)
   and (a.cohort is not null or a.birth_date is not null);


-- ---------------------------------------------------------------------
-- 2. 멤버 수정 규칙 (014에 기수 · 생년월일 · 생일선물 정산 추가)
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
         or new.gift_join is distinct from old.gift_join then
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
-- 3. 생일 알림
-- ---------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('open', 'minopen', 'poll', 'remind', 'lineup', 'practice', 'apply', 'trainee', 'notice', 'message', 'prayer', 'birthday'));

alter table public.notify_settings drop constraint if exists notify_settings_kind_check;
alter table public.notify_settings add constraint notify_settings_kind_check
  check (kind in ('open', 'minopen', 'poll', 'remind', 'lineup', 'practice', 'apply', 'trainee', 'notice',
                  'prayer_new', 'prayer_remind', 'prayer_urgent', 'birthday_soon', 'birthday_today'));

insert into public.notify_settings (kind, title, body, schedule) values
  ('birthday_soon',  '{생일자}님 생일이 {며칠} 남았어요', '{날짜} · {정산}', '{"days":3,"hour":9}'),
  ('birthday_today', '오늘은 {생일자}님 생일이에요',      '{정산} · 축하 메시지를 보내 주세요', '{"hour":9}')
on conflict (kind) do nothing;

-- 확인: select name, cohort, birth_date, gift_join from members order by name;
