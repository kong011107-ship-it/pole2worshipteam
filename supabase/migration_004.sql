-- =====================================================================
--  004 — 수습 주차 미루기
--  "n주차부터 k주 미루기": 지난 주차 날짜·기록은 그대로, n주차부터 뒤로 밀림
--  migration_003 다음에 SQL Editor에서 한 번 실행하세요.
-- =====================================================================

create table public.trainee_postpones (
  id              bigint generated always as identity primary key,
  application_id  uuid not null references public.applications(id) on delete cascade,
  from_week       int  not null check (from_week between 1 and 5),
  weeks           int  not null default 1 check (weeks between 1 and 4),
  reason          text check (length(reason) <= 200),
  created_by      uuid references public.members(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now()
);

create index trainee_postpones_app_idx on public.trainee_postpones (application_id, from_week);

-- 수습 중인 지원자만 미룰 수 있음
create or replace function public.trainee_postpones_validate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from public.applications where id = new.application_id and stage = 'trainee') then
    raise exception '수습 중인 지원자만 주차를 미룰 수 있습니다.';
  end if;
  new.created_at := now();
  return new;
end;
$$;

create trigger trainee_postpones_validate
  before insert on public.trainee_postpones
  for each row execute function public.trainee_postpones_validate();

alter table public.trainee_postpones enable row level security;

-- 사유까지 포함한 전체 기록은 리더십만
create policy postpones_admin_read on public.trainee_postpones for select
  using (public.is_admin());
create policy postpones_admin_insert on public.trainee_postpones for insert
  with check (public.is_admin() and created_by = auth.uid());
create policy postpones_admin_delete on public.trainee_postpones for delete
  using (public.is_admin());

-- 수습생 본인은 일정 계산에 필요한 값(몇 주차부터 몇 주)만 — 사유는 제외
create or replace function public.my_trainee_postpones()
returns table (from_week int, weeks int)
language sql
stable
security definer
set search_path = public
as $$
  select p.from_week, p.weeks
    from public.trainee_postpones p
    join public.applications a on a.id = p.application_id
   where a.user_id = auth.uid()
   order by p.from_week, p.id;
$$;

revoke all on function public.my_trainee_postpones() from public, anon;
grant execute on function public.my_trainee_postpones() to authenticated;
