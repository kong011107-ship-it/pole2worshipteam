-- =====================================================================
--  014 — 최상위 리더십 · 기도제목 나눔 (v15)
--  · members.is_owner : 최상위 리더십 (한 명). 리더십 지정·해제는 이 사람만
--      다른 리더는 최상위 리더십 계정을 휴면·탈퇴·비밀번호 초기화·이메일 변경·삭제할 수 없어요
--      넘기기는 관리자 화면 › 설정 › 최상위 리더십 (비밀번호 다시 입력)
--  · prayers      : 기도제목 카드 (한 사람당 한 장, 다른 사람이 대신 올릴 수 있음)
--  · prayer_taps  : '기도했습니다' 누른 기록 — 아무도 직접 못 보고, 합계만 함수로 봐요
--  · 기도 알림 3종 : 이번 주 기도제목 올라옴 · 주중 함께 기도 · 급한 기도
--  migration_013 다음에 SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 괜찮아요.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 최상위 리더십
-- ---------------------------------------------------------------------
alter table public.members
  add column if not exists is_owner boolean not null default false;
create unique index if not exists members_one_owner on public.members (is_owner) where is_owner;

-- 처음 한 번: 리더십 '공준혁' 계정을 최상위 리더십으로 (이미 정해져 있으면 건너뜀)
update public.members set is_owner = true
 where id = (select id from public.members where name = '공준혁' and role = 'admin' and is_active order by created_at limit 1)
   and not exists (select 1 from public.members where is_owner);

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members
    where id = auth.uid() and is_owner and role = 'admin' and is_active
  );
$$;
revoke all on function public.is_owner() from anon;

-- 멤버 수정 규칙 (009 · 011에 최상위 리더십 규칙 추가)
--   · SQL Editor(로그인 없음)와 서버(service_role)는 그대로 통과
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
         or new.is_owner is distinct from old.is_owner then
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
-- 2. 기도제목
-- ---------------------------------------------------------------------
-- 기도 주간: 그 주 토요일(팀모임) 기준. 토요일에 올린 건 그날 주간, 주중에 올린 건 지난 토요일 주간
create or replace function public.prayer_week(ts timestamptz default now())
returns date
language sql
stable
as $$
  select (ts at time zone 'Asia/Seoul')::date
       - ((extract(isodow from (ts at time zone 'Asia/Seoul')::date)::int + 1) % 7);
$$;

create table if not exists public.prayers (
  id          bigint generated always as identity primary key,
  member_id   uuid not null references public.members(id) on delete cascade,   -- 기도제목의 주인
  author_id   uuid references public.members(id) on delete set null default auth.uid(),
  body        text not null check (length(trim(body)) between 1 and 500),
  urgent      boolean not null default false,
  week_of     date not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists prayers_week_idx on public.prayers (week_of, created_at);
create index if not exists prayers_member_idx on public.prayers (member_id);

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
    if auth.uid() is not null then new.author_id := auth.uid(); end if;
  else
    if new.member_id is distinct from old.member_id or new.author_id is distinct from old.author_id
       or new.week_of is distinct from old.week_of or new.created_at is distinct from old.created_at then
      raise exception '기도제목의 사람·주간은 바꿀 수 없어요. 지우고 다시 올려 주세요.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists prayers_before_write on public.prayers;
create trigger prayers_before_write
  before insert or update on public.prayers
  for each row execute function public.prayers_before_write();

-- '기도했습니다' — 누른 기록 (같은 사람은 1시간에 한 번만 셈)
create table if not exists public.prayer_taps (
  id         bigint generated always as identity primary key,
  week_of    date not null,
  member_id  uuid not null references public.members(id) on delete cascade,
  tapped_at  timestamptz not null default now()
);
create index if not exists prayer_taps_week_idx on public.prayer_taps (week_of, member_id, tapped_at desc);

-- 누르기: { ok, total, next_at }
create or replace function public.pray()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  w date := public.prayer_week(now());
  last timestamptz;
  ok boolean := false;
begin
  if not public.is_member() then raise exception '로그인한 팀원만 누를 수 있어요.'; end if;
  select max(tapped_at) into last from public.prayer_taps where week_of = w and member_id = auth.uid();
  if last is null or last <= now() - interval '1 hour' then
    insert into public.prayer_taps (week_of, member_id) values (w, auth.uid());
    last := now(); ok := true;
  end if;
  return json_build_object('ok', ok, 'week_of', w,
    'total', (select count(*) from public.prayer_taps where week_of = w),
    'next_at', last + interval '1 hour');
end;
$$;

-- 주간별 합계 + 이번 주 내가 다시 누를 수 있는 때 (누가 눌렀는지는 안 보여 줌)
create or replace function public.prayer_status(p_from date default null)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.is_member() then null else json_build_object(
    'week_of', public.prayer_week(now()),
    'weeks', coalesce((select json_agg(json_build_object('week_of', week_of, 'total', n) order by week_of desc)
                         from (select week_of, count(*) n from public.prayer_taps
                                where week_of >= coalesce(p_from, public.prayer_week(now()) - 56) group by week_of) t), '[]'::json),
    'next_at', (select max(tapped_at) + interval '1 hour' from public.prayer_taps
                 where week_of = public.prayer_week(now()) and member_id = auth.uid())
  ) end;
$$;

-- 팀원 이름 목록 (기도제목 카드 · 이름 고르기용). 연락처 등은 빼고 이름·포지션만
create or replace function public.team_roster()
returns table (id uuid, name text, main_position text, status text)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.name, m.main_position, m.status
    from public.members m
   where m.is_active and public.is_member()
   order by m.name;
$$;

revoke all on function public.pray() from public, anon;
revoke all on function public.prayer_status(date) from public, anon;
revoke all on function public.team_roster() from public, anon;
grant execute on function public.pray() to authenticated;
grant execute on function public.prayer_status(date) to authenticated;
grant execute on function public.team_roster() to authenticated;

alter table public.prayers     enable row level security;
alter table public.prayer_taps enable row level security;

drop policy if exists prayers_read on public.prayers;
drop policy if exists prayers_insert on public.prayers;
drop policy if exists prayers_update on public.prayers;
drop policy if exists prayers_delete on public.prayers;
create policy prayers_read on public.prayers for select using (public.is_member());
create policy prayers_insert on public.prayers for insert
  with check (public.is_member() and author_id = auth.uid());
create policy prayers_update on public.prayers for update
  using (public.is_member() and (author_id = auth.uid() or public.is_admin()))
  with check (public.is_member() and (author_id = auth.uid() or public.is_admin()));
create policy prayers_delete on public.prayers for delete
  using (public.is_member() and (author_id = auth.uid() or public.is_admin()));
-- prayer_taps: 정책 없음 = 화면에서 직접 읽기·쓰기 불가 (pray / prayer_status 함수로만)


-- ---------------------------------------------------------------------
-- 3. 기도 알림
-- ---------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('open', 'minopen', 'poll', 'remind', 'lineup', 'practice', 'apply', 'trainee', 'notice', 'message', 'prayer'));

alter table public.notify_settings drop constraint if exists notify_settings_kind_check;
alter table public.notify_settings add constraint notify_settings_kind_check
  check (kind in ('open', 'minopen', 'poll', 'remind', 'lineup', 'practice', 'apply', 'trainee', 'notice',
                  'prayer_new', 'prayer_remind', 'prayer_urgent'));

insert into public.notify_settings (kind, title, body, schedule) values
  ('prayer_new',    '이번 주 기도제목이 올라왔어요', '{인원}명의 기도제목을 함께 품어요', '{"dow":6,"hour":21}'),
  ('prayer_remind', '오늘 저녁, 함께 기도해요',      '이번 주 기도제목 {개수}개를 함께 기도해요', '{"days":[2,4],"hour":20}'),
  ('prayer_urgent', '급한 기도제목이 올라왔어요',    '{대상}님을 위해 함께 기도해 주세요', null)
on conflict (kind) do nothing;


-- ---------------------------------------------------------------------
-- 4. 초기화(013)에 기도제목 포함
-- ---------------------------------------------------------------------
create or replace function public.reset_team_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
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

-- 확인: select name, role, is_owner from public.members where role = 'admin';
-- 최상위 리더십이 비어 있으면: update public.members set is_owner = true where email = '본인이메일';
