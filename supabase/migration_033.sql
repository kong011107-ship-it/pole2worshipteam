-- =====================================================================
-- migration_033 (v34.1) — 콘티에 저장된 악보 지우기
--   인도자가 잘못 넣은 악보를 지울 수 있게 해요.
--   · 이 콘티에서 빼기: 화면(콘티 쓰기)에서 '악보 없이'로 바꾸는 것 — DB 변경 없음
--   · 아예 지우기: delete_sheet — 올라온 콘티에 쓰였어도 지워요. 쓰인 콘티에서는 그 곡 악보가 빠지고(빈 쪽),
--     '악보 바뀜'으로 표시돼요(알림 없음). 이 악보에 쓴 공유 필기 · 내 메모도 함께 지워져요.
--   누가: 리더십 · 올린 사람 · 그 악보를 쓴(또는 넣으려던) 예배의 인도자 · 밴드 마스터
--         (밴드는 악보를 고칠 수 있어도 지우기는 못 해요)
-- 두 번 실행해도 괜찮아요.
-- =====================================================================

create or replace function public.delete_sheet(p_id bigint, p_service uuid default null, p_dry boolean default false)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.sheet_versions;
  uses json;
  n_notes int;
  n_ink int;
  who text;
  sls bigint[];
  other_path boolean;
  vers json;
begin
  select * into v from public.sheet_versions where id = p_id for update;
  if v.id is null then raise exception '악보를 찾을 수 없어요. 이미 지워졌을 수 있어요.'; end if;

  -- coalesce: 올린 사람(created_by)이 비어 있으면 비교가 NULL이 되어 막히지 않는 것을 막아요
  if not coalesce(
    public.is_admin()
    or v.created_by = auth.uid()
    or (v.added_for is not null and public.can_edit_conti(v.added_for))
    or exists (select 1 from public.setlist_items i join public.setlists sl on sl.id = i.setlist_id
                where i.sheet_id = v.id and sl.service_id is not null and public.can_edit_conti(sl.service_id))
    or (p_service is not null and public.can_edit_conti(p_service) and exists (
          select 1 from public.setlist_items i join public.setlists sl on sl.id = i.setlist_id
           where sl.service_id = p_service and (i.song_id = v.song_id or (v.medley_id is not null and i.medley_id = v.medley_id))))
  , false) then
    raise exception '리더십 · 올린 사람 · 그 예배 인도자나 밴드 마스터만 지울 수 있어요.';
  end if;

  -- 쓰인 콘티 (날짜 · 올라옴 여부)
  select coalesce(json_agg(json_build_object('date', x.service_date, 'published', x.status = 'published') order by x.service_date desc), '[]'::json)
    into uses
    from (select distinct sl.id, sl.service_date, sl.status from public.setlist_items i join public.setlists sl on sl.id = i.setlist_id where i.sheet_id = v.id) x;
  select count(*) into n_notes from public.sheet_notes where key = 's:' || v.id;
  select count(*) into n_ink from public.sheet_ink where sheet_id = v.id;

  if p_dry then
    return json_build_object('id', v.id, 'name', v.name, 'kind', v.kind, 'uses', uses, 'notes', n_notes, 'ink', n_ink);
  end if;

  -- 쓰인 콘티에서 빼기 (그 곡은 악보 없이 · 쪽 범위도 비움)
  select coalesce(array_agg(distinct i.setlist_id), '{}') into sls from public.setlist_items i where i.sheet_id = v.id;
  update public.setlist_items set sheet_id = null, page_from = null, page_to = null where sheet_id = v.id;
  who := (select name from public.members where id = auth.uid());
  if array_length(sls, 1) > 0 then
    update public.setlists set
      version = version + case when status = 'published' then 1 else 0 end,
      notified_version = notified_version + case when status = 'published' then 1 else 0 end,   -- 악보만 바뀌면 알림 없음
      sheet_told = case when sheet_told is null then null else array(select unnest(sheet_told) except select song_id from public.setlist_items where setlist_id = setlists.id and sheet_id is null and page_from is null) end,
      sheet_changes = case when status = 'published' then jsonb_build_object('at', now(), 'by', who) else sheet_changes end,
      updated_at = now(), updated_by = auth.uid()
     where id = any (sls);
  end if;

  -- 콘티 쓰기 화면이 열려 있으면 이 버전으로 이어서 저장해요 (동시 수정 보호에 걸리지 않게)
  select coalesce(json_object_agg(sl.service_id, sl.version), '{}'::json) into vers
    from public.setlists sl where sl.id = any (sls) and sl.service_id is not null;

  delete from public.sheet_notes where key = 's:' || v.id;   -- 내 메모 (공유 필기 sheet_ink는 FK로 함께 지워져요)
  delete from public.sheet_versions where id = v.id;
  -- 필기본은 같은 파일을 'path#꼬리'로 같이 써요 → '#' 앞(파일)이 같으면 남겨요
  other_path := exists (select 1 from public.sheet_versions where split_part(path, '#', 1) = split_part(v.path, '#', 1));
  return json_build_object('deleted', true, 'uses', uses, 'notes', n_notes, 'ink', n_ink, 'versions', vers,
    'path', case when other_path then null else split_part(v.path, '#', 1) end);   -- 같은 PDF를 쓰는 악보(필기본 등)가 있으면 파일은 남겨요
end;
$$;
revoke all on function public.delete_sheet(bigint, uuid, boolean) from public, anon;
grant execute on function public.delete_sheet(bigint, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 고침: edit_sheet (030) 권한 확인 — 올린 사람(created_by)이 비어 있으면 비교가 NULL이 되어
--       리더십이 아니어도 이름 바꾸기 · 지우기가 통과하던 것. 나머지는 030 그대로예요.
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
    return json_build_object('deleted', true, 'path', case when exists (select 1 from public.sheet_versions where path = v.path) then null else v.path end);
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception '이름을 적어 주세요.'; end if;
  update public.sheet_versions set name = left(trim(p_name), 60) where id = v.id;
  return json_build_object('ok', true);
end;
$$;
revoke all on function public.edit_sheet(bigint, text, boolean) from public, anon;
grant execute on function public.edit_sheet(bigint, text, boolean) to authenticated;

-- 확인 (Supabase SQL 편집기에서)
--   select public.delete_sheet(<악보 id>, null, true);   → 쓰인 콘티 · 필기 수 (지우지 않음)
