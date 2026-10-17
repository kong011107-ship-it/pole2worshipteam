-- =====================================================================
--  015 — 공지 투표 · 팀모임 불참 미리 알리기 (v16)
--  · polls / poll_options / poll_votes : 공지에 붙이는 투표
--      대상 = 그 공지를 받은 사람 (알림함에 들어간 사람)
--      마감 전까지 바꿀 수 있고, 결과는 마감 뒤에 공개 (리더십은 진행 중에도 봄)
--      익명 투표는 누가 무엇을 골랐는지 아무도 못 봐요 (리더십은 참여 여부만)
--      투표 기록은 화면에서 직접 못 읽고 함수(poll_view · vote)로만
--  · attendance.self_reported_at : 팀원이 미리 알린 팀모임 불참
--      팀모임이 '있음'인 토요일, 그날 낮 12시까지. 사유 필수
--      출석에는 '결석'으로 들어가고(연속 결석에도 똑같이 셈), 리더가 그날 바꿀 수 있어요
--  migration_014 다음에 SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 괜찮아요.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 투표
-- ---------------------------------------------------------------------
create table if not exists public.polls (
  id               bigint generated always as identity primary key,
  notification_id  bigint unique references public.notifications(id) on delete cascade,
  question         text not null check (length(trim(question)) between 1 and 80),
  multi            boolean not null default false,
  anonymous        boolean not null default false,
  deadline         timestamptz not null,
  closed_at        timestamptz,            -- 리더십이 일찍 마감한 때
  created_by       uuid references public.members(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists polls_created_idx on public.polls (created_at desc);

create table if not exists public.poll_options (
  id          bigint generated always as identity primary key,
  poll_id     bigint not null references public.polls(id) on delete cascade,
  label       text not null check (length(trim(label)) between 1 and 40),
  sort_order  int not null default 0
);
create index if not exists poll_options_poll_idx on public.poll_options (poll_id, sort_order);

create table if not exists public.poll_votes (
  poll_id    bigint not null references public.polls(id) on delete cascade,
  option_id  bigint not null references public.poll_options(id) on delete cascade,
  member_id  uuid not null references public.members(id) on delete cascade,
  voted_at   timestamptz not null default now(),
  primary key (poll_id, member_id, option_id)
);
create index if not exists poll_votes_option_idx on public.poll_votes (option_id);

-- 끝나는 때 = 마감 시각과 일찍 마감한 때 중 빠른 것
create or replace function public.poll_ends_at(p public.polls)
returns timestamptz
language sql
immutable
as $$ select least(p.deadline, coalesce(p.closed_at, p.deadline)); $$;

-- 내가 이 투표 대상인지 (그 공지를 받았는지)
create or replace function public.poll_targeted(p_notification bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_member() and exists (
    select 1 from public.notification_inbox i
     where i.notification_id = p_notification and i.member_id = auth.uid());
$$;

-- 투표 한 건 보기
--   팀원: 선택지 · 내 선택 · 참여 인원, 마감 뒤에는 선택지별 인원(익명이 아니면 이름도)
--   리더십: 진행 중에도 결과, 아직 안 한 사람(pending)
create or replace function public.poll_view(p_poll bigint)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.polls;
  adm boolean := public.is_admin();
  mine boolean;
  ended boolean;
  show boolean;
begin
  select * into p from public.polls where id = p_poll;
  if p.id is null or p.notification_id is null then return null; end if;
  mine := public.poll_targeted(p.notification_id);
  if not adm and not mine then return null; end if;
  ended := now() >= public.poll_ends_at(p);
  show := ended or adm;
  return json_build_object(
    'id', p.id, 'notification_id', p.notification_id, 'question', p.question,
    'multi', p.multi, 'anonymous', p.anonymous, 'deadline', p.deadline, 'closed_at', p.closed_at,
    'ends_at', public.poll_ends_at(p), 'ended', ended, 'show_results', show, 'eligible', mine,
    'created_at', p.created_at, 'created_by', p.created_by,
    'targets', (select count(*) from public.notification_inbox i where i.notification_id = p.notification_id),
    'voters', (select count(distinct v.member_id) from public.poll_votes v where v.poll_id = p.id),
    'my', coalesce((select json_agg(v.option_id order by v.option_id) from public.poll_votes v where v.poll_id = p.id and v.member_id = auth.uid()), '[]'::json),
    'options', coalesce((select json_agg(json_build_object(
        'id', o.id, 'label', o.label,
        'count', case when show then (select count(*) from public.poll_votes v where v.option_id = o.id) end,
        'names', case when show and not p.anonymous then
                   (select coalesce(json_agg(m.name order by m.name), '[]'::json)
                      from public.poll_votes v join public.members m on m.id = v.member_id where v.option_id = o.id) end
      ) order by o.sort_order, o.id) from public.poll_options o where o.poll_id = p.id), '[]'::json),
    'pending', case when adm then coalesce((select json_agg(i.member_id) from public.notification_inbox i
        join public.members m on m.id = i.member_id and m.is_active
       where i.notification_id = p.notification_id
         and not exists (select 1 from public.poll_votes v where v.poll_id = p.id and v.member_id = i.member_id)), '[]'::json) end
  );
end;
$$;

-- 여러 건 한 번에 (알림함 · 리더십 투표 목록)
--   p_ids가 비어 있으면: 팀원은 내가 대상인 최근 60일, 리더십은 최근 60일 전체
create or replace function public.poll_views(p_ids bigint[] default null)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(v order by pid desc), '[]'::json)
    from (select p.id pid, public.poll_view(p.id) v
            from public.polls p
           where p.notification_id is not null
             and (case when p_ids is null then p.created_at > now() - interval '60 days' else p.id = any (p_ids) end)
           order by p.id desc limit 60) t
   where v is not null;
$$;

-- 투표하기 (고른 것 전체를 보냄 · 빈 목록이면 취소) → 바뀐 투표 보기
create or replace function public.vote(p_poll bigint, p_options bigint[])
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.polls;
  opts bigint[];
begin
  select * into p from public.polls where id = p_poll;
  if p.id is null or p.notification_id is null then raise exception '투표를 찾을 수 없어요.'; end if;
  if not public.poll_targeted(p.notification_id) then raise exception '이 투표의 대상이 아니에요.'; end if;
  if now() >= public.poll_ends_at(p) then raise exception '투표가 마감됐어요.'; end if;
  opts := array(select distinct x from unnest(coalesce(p_options, '{}'::bigint[])) x where x is not null);
  if not p.multi and cardinality(opts) > 1 then raise exception '하나만 고를 수 있어요.'; end if;
  if exists (select 1 from unnest(opts) x where not exists (select 1 from public.poll_options o where o.id = x and o.poll_id = p.id)) then
    raise exception '선택지를 찾을 수 없어요. 새로고침해 주세요.';
  end if;
  delete from public.poll_votes where poll_id = p.id and member_id = auth.uid();
  insert into public.poll_votes (poll_id, option_id, member_id)
  select p.id, x, auth.uid() from unnest(opts) x;
  return public.poll_view(p.id);
end;
$$;

-- 리더십: 지금 마감하기
create or replace function public.close_poll(p_poll bigint)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception '리더십만 마감할 수 있어요.'; end if;
  update public.polls set closed_at = now() where id = p_poll and closed_at is null and deadline > now();
  return public.poll_view(p_poll);
end;
$$;

revoke all on function public.poll_targeted(bigint) from public, anon;
revoke all on function public.poll_view(bigint) from public, anon;
revoke all on function public.poll_views(bigint[]) from public, anon;
revoke all on function public.vote(bigint, bigint[]) from public, anon;
revoke all on function public.close_poll(bigint) from public, anon;
grant execute on function public.poll_targeted(bigint) to authenticated;
grant execute on function public.poll_view(bigint) to authenticated;
grant execute on function public.poll_views(bigint[]) to authenticated;
grant execute on function public.vote(bigint, bigint[]) to authenticated;
grant execute on function public.close_poll(bigint) to authenticated;

alter table public.polls        enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes   enable row level security;

-- 투표 만들기는 서버(공지 보내기)만. 읽기는 대상·리더십
drop policy if exists polls_read on public.polls;
create policy polls_read on public.polls for select
  using (public.is_admin() or public.poll_targeted(notification_id));
drop policy if exists poll_options_read on public.poll_options;
create policy poll_options_read on public.poll_options for select
  using (exists (select 1 from public.polls p where p.id = poll_id and (public.is_admin() or public.poll_targeted(p.notification_id))));
-- poll_votes: 정책 없음 = 화면에서 직접 읽기·쓰기 불가 (vote / poll_view 함수로만)


-- ---------------------------------------------------------------------
-- 2. 팀모임 불참 미리 알리기
-- ---------------------------------------------------------------------
alter table public.attendance
  add column if not exists self_reported_at timestamptz;

-- 리더가 출석·지각으로 바꾸면 '미리 알림' 표시는 지움 (결석 그대로면 남김)
create or replace function public.attendance_self_report_clear()
returns trigger
language plpgsql
as $$
begin
  if new.status <> 'absent' then new.self_reported_at := null; end if;
  return new;
end;
$$;
drop trigger if exists attendance_self_report_clear on public.attendance;
create trigger attendance_self_report_clear
  before update on public.attendance
  for each row execute function public.attendance_self_report_clear();

-- 미리 알릴 수 있는 마지막 때: 팀모임 날 낮 12시 (한국 시간)
create or replace function public.meeting_report_until(p_date date)
returns timestamptz
language sql
immutable
as $$ select (p_date + time '12:00') at time zone 'Asia/Seoul'; $$;

create or replace function public.report_meeting_absence(p_date date, p_tag text, p_reason text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  tm public.team_meetings;
  cur public.attendance;
  txt text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.is_member() then raise exception '로그인한 팀원만 알릴 수 있어요.'; end if;
  select * into tm from public.team_meetings where meeting_date = p_date;
  if tm.id is null or tm.meeting_status <> 'yes' then raise exception '팀모임이 있는 날만 미리 알릴 수 있어요.'; end if;
  if now() >= public.meeting_report_until(p_date) then
    raise exception '미리 알리기는 팀모임 날 낮 12시까지예요. 리더에게 직접 알려 주세요.';
  end if;
  if p_tag is not null and p_tag not in ('직장', '학업·시험', '가족 일정', '건강', '여행·지방', '교회 다른 섬김') then
    raise exception '알 수 없는 사유예요.';
  end if;
  if p_tag is null and txt is null then raise exception '불참 사유를 골라 주거나 적어 주세요.'; end if;
  if length(txt) > 200 then raise exception '사유는 200자까지예요.'; end if;
  select * into cur from public.attendance where meeting_id = tm.id and member_id = auth.uid() and kind = 'meeting';
  if cur.meeting_id is not null and cur.self_reported_at is null then
    raise exception '리더가 이미 출석을 기록했어요. 리더에게 직접 알려 주세요.';
  end if;
  insert into public.attendance (meeting_id, member_id, kind, status, reason_tag, reason, self_reported_at)
  values (tm.id, auth.uid(), 'meeting', 'absent', p_tag, txt, now())
  on conflict (meeting_id, member_id, kind) do update
    set status = 'absent', reason_tag = excluded.reason_tag, reason = excluded.reason, self_reported_at = now();
  return json_build_object('ok', true, 'meeting_date', p_date, 'reason_tag', p_tag, 'reason', txt);
end;
$$;

-- 알린 것 취소 (참석으로 되돌리기) — 마감 전, 내가 알린 것만
create or replace function public.cancel_meeting_absence(p_date date)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare tm public.team_meetings;
begin
  if not public.is_member() then raise exception '로그인한 팀원만 할 수 있어요.'; end if;
  select * into tm from public.team_meetings where meeting_date = p_date;
  if tm.id is null then raise exception '팀모임을 찾을 수 없어요.'; end if;
  if now() >= public.meeting_report_until(p_date) then
    raise exception '취소는 팀모임 날 낮 12시까지예요. 리더에게 직접 알려 주세요.';
  end if;
  delete from public.attendance
   where meeting_id = tm.id and member_id = auth.uid() and kind = 'meeting' and self_reported_at is not null;
  return json_build_object('ok', true);
end;
$$;

revoke all on function public.report_meeting_absence(date, text, text) from public, anon;
revoke all on function public.cancel_meeting_absence(date) from public, anon;
grant execute on function public.report_meeting_absence(date, text, text) to authenticated;
grant execute on function public.cancel_meeting_absence(date) to authenticated;


-- ---------------------------------------------------------------------
-- 3. 초기화(014)에 투표 포함
-- ---------------------------------------------------------------------
create or replace function public.reset_team_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
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

-- 확인: select count(*) from polls;  /  select column_name from information_schema.columns where table_name = 'attendance' and column_name = 'self_reported_at';
