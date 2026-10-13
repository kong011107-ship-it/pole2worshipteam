-- =====================================================================
--  005 — 섬김 응답·배치표 보완
--  1) 월 경계 버그: 11/1 주일의 토요 연습(10/31)은 '11월 응답'에 속함
--  2) 수습생은 섬김 응답·주일 배치 대상에서 제외 (정식 팀원만)
--  3) 리더에게 전할 말 (월별 한 칸)
--  migration_004 다음에 SQL Editor에서 한 번 실행하세요.
-- =====================================================================

-- 응답이 속하는 달: 토요 연습은 다음 날(주일) 기준
create or replace function public.availability_month(d date, k text)
returns date
language sql
immutable
as $$
  select date_trunc('month', case when k = 'sat_practice' then d + 1 else d end)::date;
$$;

create or replace function public.is_month_open_for(d date, k text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.availability_months
    where month = public.availability_month(d, k) and is_open
  );
$$;

-- 정식 팀원 (수습생 제외)
create or replace function public.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members
    where id = auth.uid() and is_active and status = 'active'
  );
$$;

-- 응답 권한 다시 정의
drop policy if exists availability_insert_own on public.availability;
drop policy if exists availability_update_own on public.availability;
drop policy if exists availability_delete_own on public.availability;

create policy availability_insert_own on public.availability for insert
  with check (member_id = auth.uid() and public.is_active_member() and public.is_month_open_for(date, kind));
create policy availability_update_own on public.availability for update
  using (member_id = auth.uid() and public.is_month_open_for(date, kind))
  with check (member_id = auth.uid() and public.is_active_member() and public.is_month_open_for(date, kind));
create policy availability_delete_own on public.availability for delete
  using (member_id = auth.uid() and public.is_month_open_for(date, kind));


-- ---------------------------------------------------------------------
-- 리더에게 전할 말 (월별)
-- ---------------------------------------------------------------------
create table public.availability_notes (
  member_id   uuid not null references public.members(id) on delete cascade,
  month       date not null check (extract(day from month) = 1),
  note        text not null check (length(note) <= 300),
  updated_at  timestamptz not null default now(),
  primary key (member_id, month)
);

create trigger availability_notes_touch
  before update on public.availability_notes
  for each row execute function public.touch_updated_at();

alter table public.availability_notes enable row level security;

create policy avail_notes_read on public.availability_notes for select
  using (member_id = auth.uid() or public.is_admin());
create policy avail_notes_insert on public.availability_notes for insert
  with check (member_id = auth.uid() and public.is_active_member() and public.is_month_open_for(month, 'sunday'));
create policy avail_notes_update on public.availability_notes for update
  using (member_id = auth.uid() and public.is_month_open_for(month, 'sunday'))
  with check (member_id = auth.uid() and public.is_month_open_for(month, 'sunday'));
create policy avail_notes_delete on public.availability_notes for delete
  using (member_id = auth.uid() and public.is_month_open_for(month, 'sunday'));


-- ---------------------------------------------------------------------
-- 배치 규칙: 활동 중인 정식 팀원만
-- ---------------------------------------------------------------------
create or replace function public.assignments_validate()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  p public.positions;
  m public.members;
begin
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
     and not exists (
       select 1 from public.member_extra_positions e
       where e.member_id = new.member_id and e.position_code = new.position_code
     ) then
    raise exception '해당 멤버는 % 포지션이 지정되어 있지 않습니다.', p.name;
  end if;

  return new;
end;
$$;
