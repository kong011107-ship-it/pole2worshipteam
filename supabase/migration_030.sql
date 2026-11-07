-- =====================================================================
--  030 (v31) — 악보 없이 올린 콘티 → 처음 채워진 악보 알림
--  · setlists.sheet_told: 이미 알린 '악보 있는 곡'(song_id). 콘티를 올릴 때 그때 있던 곡으로 채우고,
--    나중에 악보 없던 곡이 처음 채워지면 그 곡만 라인업에 한 번 알려요 (api/conti.js)
--  · 지금 올라와 있는 콘티는 지금 악보 있는 곡으로 채워 둬요 → 예전 콘티에 갑자기 알림이 가지 않아요
--  migration_029 다음에 SQL Editor에서 한 번 실행하세요. (다시 실행해도 안전)
-- =====================================================================

alter table public.setlists add column if not exists sheet_told bigint[];

update public.setlists sl set sheet_told = coalesce((
    select array_agg(i.song_id order by i.ord) from public.setlist_items i
     where i.setlist_id = sl.id and not coalesce(i.join_prev, false) and (i.sheet_id is not null or i.page_from is not null)
  ), '{}')
 where sl.status = 'published' and sl.sheet_told is null;

-- 확인: select count(*) filter (where sheet_told is null) as 비어있음 from public.setlists where status = 'published';  → 0

-- ---------------------------------------------------------------------
-- 원본 악보 지우기 (곡 · 메들리 상세의 '지우기') — 리더십 또는 올린 사람
--   올라온(지난) 콘티에 쓰인 악보는 기록을 위해 남겨요. 임시 저장 콘티에서만 고른 것은 그 칸이 '악보 없이'가 돼요
--   필기본(base_id)이 이 악보에서 나왔으면 그 연결만 끊겨요 (필기본은 남음)
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
  if not (public.is_admin() or v.created_by = auth.uid()) then raise exception '리더십이나 올린 사람만 고칠 수 있어요.'; end if;
  if p_delete then
    if exists (select 1 from public.setlist_items i join public.setlists sl on sl.id = i.setlist_id where i.sheet_id = v.id and sl.status = 'published') then
      raise exception '올라온 콘티에 쓰인 악보라 지울 수 없어요. (기록에 남아요)';
    end if;
    delete from public.sheet_versions where id = v.id;
    -- 같은 PDF를 쓰는 다른 악보(필기본 등)가 있으면 파일은 남겨요 → path를 돌려주지 않음
    return json_build_object('deleted', true, 'path', case when exists (select 1 from public.sheet_versions where path = v.path) then null else v.path end);
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception '이름을 적어 주세요.'; end if;
  update public.sheet_versions set name = left(trim(p_name), 60) where id = v.id;
  return json_build_object('ok', true);
end;
$$;
revoke all on function public.edit_sheet(bigint, text, boolean) from public, anon;
grant execute on function public.edit_sheet(bigint, text, boolean) to authenticated;
