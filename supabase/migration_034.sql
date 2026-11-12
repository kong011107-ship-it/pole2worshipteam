-- =====================================================================
-- migration_034 (v35) — 기록 라인업에 member_id 붙이기
--   콘티 쓰기 '이 라인업 · 멤버별' 추천이 사람을 이름이 아닌 멤버로 맞추려고요.
--   lineup_rows()의 한 줄 = [날짜, 포지션, 칸, 이름, 객원, member_id] (6번째만 새로)
--   예전 기록(lineup_history)은 v21.5에 연결해 둔 member_id, 플랫폼 배치는 assignments.member_id.
--   + edit_sheet(지우기)가 필기본이 같이 쓰는 PDF 경로를 돌려주던 것 고침(맨 아래).
--   다른 테이블 · 권한은 그대로예요. 다시 돌려도 돼요.
-- =====================================================================
create or replace function public.lineup_rows()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.is_member() then null else coalesce((
    select json_agg(r.v order by r.d, r.p, r.s) from (
      select l.service_date d, l.position p, l.slot s, json_build_array(l.service_date, l.position, l.slot, l.person_name, l.is_guest, l.member_id) v
        from public.lineup_history l
       where l.service_date < public.lineup_cutover()
      union all
      select s.service_date, a.position_code, a.slot,
             json_build_array(s.service_date, a.position_code, a.slot, coalesce(m.name, g.name, a.former_name, ''), coalesce(a.is_guest, false), a.member_id)
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

-- ---------------------------------------------------------------------
-- 고침: edit_sheet(p_delete) — 같은 PDF를 쓰는 필기본('파일#꼬리')이 남아 있으면 파일 경로를 돌려주지 않아요
--   (delete_sheet와 같은 기준 · 지금 화면은 delete_sheet를 쓰지만 예전 경로도 안전하게)
-- ---------------------------------------------------------------------
create or replace function public.edit_sheet(p_id bigint, p_name text, p_delete boolean default false)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v public.sheet_versions;
begin
  select * into v from public.sheet_versions where id = p_id for update;
  if v.id is null then raise exception '악보를 찾을 수 없어요.'; end if;
  if not coalesce(public.is_admin() or v.created_by = auth.uid(), false) then raise exception '리더십이나 올린 사람만 고칠 수 있어요.'; end if;
  if p_delete then
    if exists (select 1 from public.setlist_items i join public.setlists sl on sl.id = i.setlist_id where i.sheet_id = v.id and sl.status = 'published') then
      raise exception '올라온 콘티에 쓰인 악보라 지울 수 없어요. (기록에 남아요)';
    end if;
    delete from public.sheet_versions where id = v.id;
    return json_build_object('deleted', true, 'path', case when exists (select 1 from public.sheet_versions where split_part(path, '#', 1) = split_part(v.path, '#', 1)) then null else split_part(v.path, '#', 1) end);
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception '이름을 적어 주세요.'; end if;
  update public.sheet_versions set name = left(trim(p_name), 60) where id = v.id;
  return json_build_object('ok', true);
end;
$$;
revoke all on function public.edit_sheet(bigint, text, boolean) from public, anon;
grant execute on function public.edit_sheet(bigint, text, boolean) to authenticated;
