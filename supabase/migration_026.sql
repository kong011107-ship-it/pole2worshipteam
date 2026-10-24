-- =====================================================================
--  026 — v27: 지난 라인업 ↔ 멤버 연결 · 기록에 플랫폼 배치표 이어 붙이기
--  · team_settings.lineup_cutover : 전환일 (기본 2026-10-25)
--      그 전 = 카톡 콘티방 라인업 기록(lineup_history), 그날부터 = 공개된 주일 배치표
--  · link_lineup_history() : 이름이 정확히 같고 그 이름의 멤버가 1명뿐이면 연결
--      객원 줄 · 이미 연결된 줄은 건드리지 않아요. 멤버를 새로 등록하거나 이름을 바꾸면 자동으로 다시 실행
--  · history_bundle() 라인업 = 전환일 전 기록 + 전환일부터 지난 공개 배치표
--  migration_025 다음에 SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 괜찮아요.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 전환일
-- ---------------------------------------------------------------------
alter table public.team_settings
  add column if not exists lineup_cutover date not null default date '2026-10-25';

create or replace function public.lineup_cutover()
returns date language sql stable security definer set search_path = public as $$
  select coalesce((select lineup_cutover from public.team_settings where id = 1), date '2026-10-25');
$$;
revoke all on function public.lineup_cutover() from public, anon;
grant execute on function public.lineup_cutover() to authenticated;


-- ---------------------------------------------------------------------
-- 2. 지난 라인업 ↔ 멤버 연결
-- ---------------------------------------------------------------------
create index if not exists lineup_history_member_idx on public.lineup_history (member_id, service_date) where member_id is not null;

create or replace function public.link_lineup_history()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  -- SQL Editor(로그인 없음) · 트리거 · 리더십만
  if auth.uid() is not null and not public.is_admin() then raise exception '리더십만 할 수 있어요.'; end if;
  update public.lineup_history h
     set member_id = m.id
    from public.members m
   where h.member_id is null
     and not h.is_guest
     and m.name = trim(h.person_name)
     and (select count(*) from public.members x where x.name = m.name) = 1;
  get diagnostics n = row_count;
  return json_build_object(
    'linked', n,
    'linked_people', (select count(distinct member_id) from public.lineup_history where member_id is not null),
    'unlinked', coalesce((select json_agg(json_build_object('name', u.person_name, 'rows', u.c, 'last', u.last) order by u.last desc)
                            from (select person_name, count(*) c, max(service_date) last from public.lineup_history
                                   where member_id is null and not is_guest group by person_name) u), '[]'::json));
end;
$$;
revoke all on function public.link_lineup_history() from public, anon;
grant execute on function public.link_lineup_history() to authenticated;

-- 멤버가 새로 들어오거나 이름이 바뀌면 다시 연결 (연결된 줄은 그대로)
create or replace function public.members_link_history()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.lineup_history h
     set member_id = m.id
    from public.members m
   where h.member_id is null and not h.is_guest and m.name = trim(h.person_name)
     and (select count(*) from public.members x where x.name = m.name) = 1;
  return null;
end;
$$;
drop trigger if exists members_link_history on public.members;
create trigger members_link_history
  after insert or update of name on public.members
  for each statement execute function public.members_link_history();


-- ---------------------------------------------------------------------
-- 3. 기록 라인업 = 전환일 전 콘티방 기록 + 전환일부터 지난 공개 배치표 (주일만)
--    배치표는 팀원에게 이름이 안 보이는 표라서 이 부분만 security definer로 따로 읽어요
-- ---------------------------------------------------------------------
create or replace function public.lineup_rows()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.is_member() then null else coalesce((
    select json_agg(r.v order by r.d, r.p, r.s) from (
      select l.service_date d, l.position p, l.slot s, json_build_array(l.service_date, l.position, l.slot, l.person_name, l.is_guest) v
        from public.lineup_history l
       where l.service_date < public.lineup_cutover()
      union all
      select s.service_date, a.position_code, a.slot,
             json_build_array(s.service_date, a.position_code, a.slot, coalesce(m.name, g.name, a.former_name, ''), coalesce(a.is_guest, false))
        from public.services s
        join public.assignments a on a.service_id = s.id
        left join public.members m on m.id = a.member_id
        left join public.guests g on g.id = a.guest_id
       where s.ministry_id is null and s.status = 'published'
         and s.service_date >= public.lineup_cutover()
         and s.service_date <= (now() at time zone 'Asia/Seoul')::date
         and coalesce(m.name, g.name, a.former_name, '') <> ''
    ) r), '[]'::json) end;
$$;
revoke all on function public.lineup_rows() from public, anon;
grant execute on function public.lineup_rows() to authenticated;

-- 기록 (025) — 라인업만 lineup_rows()로 바꿈
create or replace function public.history_bundle()
returns json
language sql
stable
security invoker
set search_path = public
as $$
  select case when not public.is_member() then null else json_build_object(
    'songs', coalesce((select json_agg(json_build_object('id', s.id, 'title', s.title, 'main_key', s.main_key, 'memo', s.memo, 'bpm', s.team_bpm, 'meter', s.team_meter) order by s.id) from public.songs s), '[]'::json),
    'medleys', coalesce((select json_agg(json_build_object('id', m.id, 'title', m.title, 'songs', (select json_agg(x.song_id order by x.ord) from public.medley_songs x where x.medley_id = m.id)) order by m.id) from public.medleys m), '[]'::json),
    'setlists', coalesce((select json_agg(json_build_object(
        'd', sl.service_date, 'leaders', sl.leaders, 'note', coalesce(sl.note, ''), 'sid', sl.service_id,
        'e', case when sl.service_id is not null then public.can_edit_conti(sl.service_id) end,
        'es', case when sl.service_id is not null then public.can_edit_sheets(sl.service_id) end,
        'items', coalesce((select json_agg(json_build_array(i.ord, i.song_id, i.key, i.medley, i.refs, i.bpm, i.medley_id, i.join_prev) order by i.ord) from public.setlist_items i where i.setlist_id = sl.id), '[]'::json))
      order by sl.service_date)
      from public.setlists sl
     where sl.status = 'published'
       and sl.service_date <= (now() at time zone 'Asia/Seoul')::date
       and (sl.service_id is null or exists (select 1 from public.services s where s.id = sl.service_id and s.ministry_id is null))), '[]'::json),
    'lineup', public.lineup_rows(),
    'applied', coalesce((select json_agg(json_build_array(x.id, s.service_date, x.title, x.key, x.images, x.norm, s.id, mi.name) order by s.service_date, x.ord, x.id)
      from public.applied_songs x join public.services s on s.id = x.service_id left join public.ministries mi on mi.id = s.ministry_id
     where s.status = 'published' and s.service_date <= (now() at time zone 'Asia/Seoul')::date), '[]'::json)
  ) end;
$$;
revoke all on function public.history_bundle() from public, anon;
grant execute on function public.history_bundle() to authenticated;


-- ---------------------------------------------------------------------
-- 4. 지금 한 번 연결
-- ---------------------------------------------------------------------
select public.link_lineup_history();

-- 확인: 연결된 사람 수 · 남은 이름(지금 팀에 없는 사람 · 동명이인 · 호칭)
--   select count(distinct member_id) from lineup_history where member_id is not null;
--   select person_name, count(*) from lineup_history where member_id is null and not is_guest group by 1 order by 2 desc;
-- 동명이인 · 호칭을 직접 연결할 때 (예시):
--   update lineup_history set member_id = (select id from members where name = '김동우') where person_name = '김동우 전도사님';
