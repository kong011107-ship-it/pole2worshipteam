-- =====================================================================
--  찬양팀 멤버 관리 플랫폼 — DB 스키마 + 권한(RLS)
--  Supabase SQL Editor에 이 파일 전체를 붙여넣고 한 번 실행하세요.
-- =====================================================================
--  역할
--    · 비로그인(anon)  : 가입 신청서 제출만 가능
--    · 멤버(member)    : 본인 정보·신청서·서약 열람, 월별 섬김 가능 여부 입력,
--                        확정 공개된 배치표 열람, 본인 출석 열람
--    · 관리자(admin)   : 전체 (= 리더)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 포지션 (고정 목록)
-- ---------------------------------------------------------------------
create table public.positions (
  code        text primary key,
  name        text not null,
  kind        text not null check (kind in ('leader', 'vocal', 'band')),
  max_count   int  not null check (max_count > 0),
  sort_order  int  not null
);

insert into public.positions (code, name, kind, max_count, sort_order) values
  ('leader',     '인도자',     'leader', 1, 1),
  ('singer',     '싱어',       'vocal',  4, 2),
  ('key_main',   '메인건반',   'band',   1, 3),
  ('key_second', '세컨건반',   'band',   1, 4),
  ('e_guitar',   '일렉기타',   'band',   1, 5),
  ('bass',       '베이스기타', 'band',   1, 6),
  ('drum',       '드럼',       'band',   1, 7);


-- ---------------------------------------------------------------------
-- 2. 서약서 문구 (버전 관리)
--    문구를 고칠 때는 UPDATE 하지 말고 새 버전을 INSERT 하세요.
--    신청 시점의 문구가 신청서에 그대로 복사되어 보관됩니다.
-- ---------------------------------------------------------------------
create table public.pledge_versions (
  id          bigint generated always as identity primary key,
  title       text not null,
  content     text not null,
  is_active   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- 활성 서약서는 항상 1개만
create unique index pledge_versions_one_active
  on public.pledge_versions (is_active) where is_active;

insert into public.pledge_versions (title, content, is_active) values
  ('찬양팀 서약서 (v1)',
   E'[여기에 실제 서약서 문구를 넣어주세요]\n\n1. 나는 예배자로서 ...\n2. 나는 팀 모임과 연습에 성실히 참여하겠습니다.\n3. ...',
   true);


-- ---------------------------------------------------------------------
-- 3. 가입 신청서
-- ---------------------------------------------------------------------
create table public.applications (
  id                 uuid primary key default gen_random_uuid(),

  -- 신청서 항목 (기본값 — 이후 수정 예정)
  name               text not null check (length(trim(name)) between 1 and 30),
  phone              text not null check (phone ~ '^[0-9\-]{9,13}$'),
  email              text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  applied_position   text not null references public.positions(code),
  experience         text check (length(experience) <= 1000),  -- 섬김 경력
  motivation         text check (length(motivation) <= 1000),  -- 지원 동기

  -- 동의 / 서약 (서버에서 자동 기록, 클라이언트 값 무시)
  privacy_agreed     boolean not null check (privacy_agreed),
  pledge_version_id  bigint references public.pledge_versions(id),
  pledge_title       text,
  pledge_content     text,
  pledged_at         timestamptz,

  -- 처리 상태
  status             text not null default 'pending'
                       check (status in ('pending', 'approved', 'rejected')),
  admin_memo         text,
  reviewed_at        timestamptz,
  user_id            uuid references auth.users(id) on delete set null,

  created_at         timestamptz not null default now()
);

create index applications_status_idx on public.applications (status, created_at desc);
create index applications_user_idx   on public.applications (user_id);

-- 신청서 저장 시: 서약 문구 스냅샷 + 상태 강제
create or replace function public.applications_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.pledge_versions;
begin
  select * into v from public.pledge_versions where is_active limit 1;
  if v.id is null then
    raise exception '활성화된 서약서가 없습니다.';
  end if;

  new.pledge_version_id := v.id;
  new.pledge_title      := v.title;
  new.pledge_content    := v.content;
  new.pledged_at        := now();
  new.created_at        := now();
  new.status            := 'pending';
  new.admin_memo        := null;
  new.reviewed_at       := null;
  new.user_id           := null;
  return new;
end;
$$;

create trigger applications_before_insert
  before insert on public.applications
  for each row execute function public.applications_before_insert();

-- 서약 내용은 이후 누구도 바꿀 수 없음
create or replace function public.applications_lock_pledge()
returns trigger
language plpgsql
as $$
begin
  if new.pledge_version_id is distinct from old.pledge_version_id
     or new.pledge_title   is distinct from old.pledge_title
     or new.pledge_content is distinct from old.pledge_content
     or new.pledged_at     is distinct from old.pledged_at then
    raise exception '서약 기록은 수정할 수 없습니다.';
  end if;
  return new;
end;
$$;

create trigger applications_lock_pledge
  before update on public.applications
  for each row execute function public.applications_lock_pledge();


-- ---------------------------------------------------------------------
-- 4. 멤버 (승인된 사람 = 로그인 계정 1개)
-- ---------------------------------------------------------------------
create table public.members (
  id              uuid primary key references auth.users(id) on delete cascade,
  application_id  uuid unique references public.applications(id),
  name            text not null,
  phone           text,
  email           text,
  role            text not null default 'member' check (role in ('admin', 'member')),
  main_position   text references public.positions(code),
  is_active       boolean not null default true,   -- 휴식/탈퇴 시 false
  joined_at       date not null default current_date,
  created_at      timestamptz not null default now()
);

-- 멀티 포지션 (관리자가 지정하는 추가 포지션)
create table public.member_extra_positions (
  member_id      uuid not null references public.members(id) on delete cascade,
  position_code  text not null references public.positions(code),
  primary key (member_id, position_code)
);


-- ---------------------------------------------------------------------
-- 5. 권한 판별 함수
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members
    where id = auth.uid() and role = 'admin' and is_active
  );
$$;

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members
    where id = auth.uid() and is_active
  );
$$;

-- 멤버가 자기 role을 admin으로 바꾸는 등 권한 상승 방지
create or replace function public.members_guard_update()
returns trigger
language plpgsql
as $$
begin
  if not public.is_admin() and auth.role() <> 'service_role' then
    if new.role is distinct from old.role
       or new.main_position is distinct from old.main_position
       or new.is_active is distinct from old.is_active
       or new.application_id is distinct from old.application_id
       or new.name is distinct from old.name then
      raise exception '이 항목은 관리자만 수정할 수 있습니다.';
    end if;
  end if;
  return new;
end;
$$;

create trigger members_guard_update
  before update on public.members
  for each row execute function public.members_guard_update();


-- ---------------------------------------------------------------------
-- 6. 월별 섬김 가능 여부
-- ---------------------------------------------------------------------
-- 관리자가 "다음 달 응답 받기"를 열고 닫는 단위
create table public.availability_months (
  month       date primary key check (extract(day from month) = 1),  -- 매월 1일로 저장
  deadline    date,
  is_open     boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.availability (
  member_id   uuid not null references public.members(id) on delete cascade,
  date        date not null,
  kind        text not null check (kind in ('sat_practice', 'sunday')),
  available   boolean not null,
  note        text check (length(note) <= 200),
  updated_at  timestamptz not null default now(),
  primary key (member_id, date, kind),
  -- 토요 연습은 토요일, 주일은 일요일만
  check ( (kind = 'sat_practice' and extract(isodow from date) = 6)
       or (kind = 'sunday'       and extract(isodow from date) = 7) )
);

create index availability_date_idx on public.availability (date, kind);

create or replace function public.is_month_open(d date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.availability_months
    where month = date_trunc('month', d)::date and is_open
  );
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

create trigger availability_touch
  before update on public.availability
  for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------
-- 7. 주일 배치표
-- ---------------------------------------------------------------------
create table public.services (
  id            uuid primary key default gen_random_uuid(),
  service_date  date not null unique check (extract(isodow from service_date) = 7),
  status        text not null default 'draft' check (status in ('draft', 'published')),
  note          text,
  published_at  timestamptz,
  updated_at    timestamptz not null default now()
);

create trigger services_touch
  before update on public.services
  for each row execute function public.touch_updated_at();

create table public.assignments (
  id                 uuid primary key default gen_random_uuid(),
  service_id         uuid not null references public.services(id) on delete cascade,
  position_code      text not null references public.positions(code),
  slot               int  not null default 1 check (slot >= 1),
  member_id          uuid not null references public.members(id),
  is_singer_leader   boolean not null default false,
  is_band_master     boolean not null default false,
  unique (service_id, position_code, slot)
);

-- 주마다 싱어 리더 1명, 밴드 마스터 1명
create unique index assignments_one_singer_leader
  on public.assignments (service_id) where is_singer_leader;
create unique index assignments_one_band_master
  on public.assignments (service_id) where is_band_master;

-- 배치 규칙 검사
create or replace function public.assignments_validate()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  p public.positions;
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

  -- 주 포지션 또는 추가 포지션에 해당해야 배치 가능
  if not exists (
       select 1 from public.members m
       where m.id = new.member_id and m.main_position = new.position_code
     )
     and not exists (
       select 1 from public.member_extra_positions e
       where e.member_id = new.member_id and e.position_code = new.position_code
     ) then
    raise exception '해당 멤버는 % 포지션이 지정되어 있지 않습니다.', p.name;
  end if;

  return new;
end;
$$;

create trigger assignments_validate
  before insert or update on public.assignments
  for each row execute function public.assignments_validate();

-- 공개된 배치표에서 멤버가 볼 수 있는 이름만 노출하는 뷰
-- (연락처·이메일 등은 다른 멤버에게 보이지 않음)
create or replace view public.published_lineups
with (security_invoker = false) as
select
  s.service_date,
  s.note,
  p.sort_order,
  p.code      as position_code,
  p.name      as position_name,
  a.slot,
  m.id        as member_id,
  m.name      as member_name,
  a.is_singer_leader,
  a.is_band_master
from public.services s
join public.assignments a on a.service_id = s.id
join public.positions  p on p.code = a.position_code
join public.members    m on m.id = a.member_id
where s.status = 'published'
  and public.is_member();

revoke all on public.published_lineups from anon;
grant select on public.published_lineups to authenticated;


-- ---------------------------------------------------------------------
-- 8. 팀모임 & 출석
-- ---------------------------------------------------------------------
create table public.team_meetings (
  id            uuid primary key default gen_random_uuid(),
  meeting_date  date not null,
  title         text not null default '팀모임',
  note          text,
  created_at    timestamptz not null default now()
);

create table public.attendance (
  meeting_id  uuid not null references public.team_meetings(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  status      text not null check (status in ('present', 'late', 'absent', 'excused')),
  memo        text,
  primary key (meeting_id, member_id)
);


-- ---------------------------------------------------------------------
-- 9. 승인 처리 (서버 API에서 service_role 키로만 호출)
--    /api/approve 가 ① 초대 메일로 계정 생성 → ② 이 함수 호출
-- ---------------------------------------------------------------------
create or replace function public.approve_application(
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
  if a.id is null then
    raise exception '신청서를 찾을 수 없습니다.';
  end if;
  if a.status <> 'pending' then
    raise exception '이미 처리된 신청서입니다.';
  end if;

  insert into public.members (id, application_id, name, phone, email, main_position)
  values (p_user_id, a.id, a.name, a.phone, a.email,
          coalesce(p_main_position, a.applied_position));

  update public.applications
     set status = 'approved', reviewed_at = now(), user_id = p_user_id
   where id = a.id;
end;
$$;

revoke all on function public.approve_application(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.approve_application(uuid, uuid, text) to service_role;


-- =====================================================================
-- 10. RLS 정책
-- =====================================================================
alter table public.positions              enable row level security;
alter table public.pledge_versions        enable row level security;
alter table public.applications           enable row level security;
alter table public.members                enable row level security;
alter table public.member_extra_positions enable row level security;
alter table public.availability_months    enable row level security;
alter table public.availability           enable row level security;
alter table public.services               enable row level security;
alter table public.assignments            enable row level security;
alter table public.team_meetings          enable row level security;
alter table public.attendance             enable row level security;

-- 포지션: 누구나 조회(신청서 드롭다운용), 관리자만 수정
create policy positions_read  on public.positions for select using (true);
create policy positions_admin on public.positions for all
  using (public.is_admin()) with check (public.is_admin());

-- 서약서: 활성 버전은 누구나 조회, 관리자는 전체
create policy pledge_read_active on public.pledge_versions for select
  using (is_active or public.is_admin());
create policy pledge_admin on public.pledge_versions for all
  using (public.is_admin()) with check (public.is_admin());

-- 신청서: 누구나 제출만 / 본인(승인 후) 열람 / 관리자 전체
create policy applications_insert on public.applications for insert
  to anon, authenticated with check (true);
create policy applications_read_own on public.applications for select
  using (user_id = auth.uid() or public.is_admin());
create policy applications_admin_update on public.applications for update
  using (public.is_admin()) with check (public.is_admin());
create policy applications_admin_delete on public.applications for delete
  using (public.is_admin());

-- 멤버: 본인 열람·연락처 수정 / 관리자 전체
create policy members_read on public.members for select
  using (id = auth.uid() or public.is_admin());
create policy members_update_self on public.members for update
  using (id = auth.uid()) with check (id = auth.uid());
create policy members_admin on public.members for all
  using (public.is_admin()) with check (public.is_admin());

create policy extra_pos_read on public.member_extra_positions for select
  using (member_id = auth.uid() or public.is_admin());
create policy extra_pos_admin on public.member_extra_positions for all
  using (public.is_admin()) with check (public.is_admin());

-- 응답 기간: 멤버 조회 / 관리자 관리
create policy avail_months_read on public.availability_months for select
  using (public.is_member());
create policy avail_months_admin on public.availability_months for all
  using (public.is_admin()) with check (public.is_admin());

-- 섬김 가능 여부: 본인 것만, 응답 기간이 열려 있을 때만 입력·수정
create policy availability_read on public.availability for select
  using (member_id = auth.uid() or public.is_admin());
create policy availability_insert_own on public.availability for insert
  with check (member_id = auth.uid() and public.is_member() and public.is_month_open(date));
create policy availability_update_own on public.availability for update
  using (member_id = auth.uid() and public.is_month_open(date))
  with check (member_id = auth.uid() and public.is_month_open(date));
create policy availability_delete_own on public.availability for delete
  using (member_id = auth.uid() and public.is_month_open(date));
create policy availability_admin on public.availability for all
  using (public.is_admin()) with check (public.is_admin());

-- 배치표: 관리자 전체 / 멤버는 공개된 것만 (이름은 published_lineups 뷰로)
create policy services_read on public.services for select
  using ((status = 'published' and public.is_member()) or public.is_admin());
create policy services_admin on public.services for all
  using (public.is_admin()) with check (public.is_admin());

create policy assignments_admin on public.assignments for all
  using (public.is_admin()) with check (public.is_admin());

-- 팀모임·출석: 관리자 전체 / 멤버는 모임 목록과 본인 출석만
create policy meetings_read on public.team_meetings for select
  using (public.is_member());
create policy meetings_admin on public.team_meetings for all
  using (public.is_admin()) with check (public.is_admin());

create policy attendance_read_own on public.attendance for select
  using (member_id = auth.uid() or public.is_admin());
create policy attendance_admin on public.attendance for all
  using (public.is_admin()) with check (public.is_admin());


-- ---------------------------------------------------------------------
-- 11. 대시보드용 집계 뷰 (관리자 전용 — 내부에서 is_admin 확인)
-- ---------------------------------------------------------------------
-- 날짜별 응답 현황: 포지션별 가능 인원
create or replace view public.availability_summary
with (security_invoker = true) as
select
  av.date,
  av.kind,
  m.main_position,
  count(*) filter (where av.available)     as available_count,
  count(*) filter (where not av.available) as unavailable_count
from public.availability av
join public.members m on m.id = av.member_id
group by av.date, av.kind, m.main_position;

-- 멤버별 출석률
create or replace view public.attendance_rates
with (security_invoker = true) as
select
  m.id   as member_id,
  m.name,
  m.main_position,
  count(at.*)                                                   as recorded,
  count(at.*) filter (where at.status in ('present', 'late'))  as attended,
  round(100.0 * count(at.*) filter (where at.status in ('present', 'late'))
        / nullif(count(at.*), 0), 0)                            as rate
from public.members m
left join public.attendance at on at.member_id = m.id
where m.is_active
group by m.id, m.name, m.main_position;
