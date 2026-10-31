-- =====================================================================
--  029 — v30: 곡마다 악보 파일 바로 더하기 · 확정 전 통합본 고치기 · 파트 악보(일렉 · 드럼 …)
--  · sheet_versions.added_for : 콘티 쓰기에서 곡 칸에 파일(PDF · 사진)로 바로 더한 예배
--      add_song_sheet(예배, 곡, 메들리, 이름, 키, 경로, 쪽 수, 크기, 썸네일) — 그 예배 콘티를 고칠 수 있는 사람
--      (올라온 콘티면 그 예배 밴드도). 더한 악보는 콘티에 저장하기 전에도 바로 '악보 고치기'로 필기할 수 있어요
--  · sheet_in_service : 콘티를 고칠 수 있는 사람(인도자 · 밴드 마스터 · 리더십)은 임시 저장 중인 콘티 ·
--      아직 저장 안 한 고른 악보에도 공유 필기를 쓸 수 있어요 (확정 전 통합본 고치기)
--  · part_sheets : 파트 악보 — 곡 × 파트(포지션) × 키. 같은 포지션(주 · 보조) 팀원끼리 보고, 그 포지션 팀원 · 리더십이 올리고 고쳐요
--      Storage parts/<곡 id>/<uuid>.pdf · 내 메모 sheet_notes key t:<id> · 공유 필기 ink_extra target t:<id>
--  · part_picks : 예배마다 내가 고른 파트 악보 (곡마다)
--  migration_028 다음에 SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 괜찮아요.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 곡 칸에서 파일로 바로 더한 악보
-- ---------------------------------------------------------------------
alter table public.sheet_versions
  add column if not exists added_for uuid references public.services(id) on delete set null;
comment on column public.sheet_versions.added_for is '콘티 쓰기 곡 칸에서 파일로 바로 더한 예배 (그 예배에선 콘티에 저장하기 전에도 공유 필기 가능)';

create or replace function public.add_song_sheet(p_service uuid, p_song bigint, p_medley bigint, p_name text, p_key text,
                                                 p_path text, p_pages int, p_size int, p_thumb text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v public.sheet_versions; sl public.setlists; who text;
begin
  select * into sl from public.setlists where service_id = p_service;
  if not coalesce(public.can_edit_conti(p_service) or (public.can_edit_sheets(p_service) and sl.status = 'published'), false) then
    raise exception '이 예배에 악보를 더할 수 있는 사람이 아니에요. (인도자 · 밴드 마스터 · 리더십 · 올라온 콘티면 그 예배 밴드)';
  end if;
  if not exists (select 1 from public.songs where id = p_song) then raise exception '곡을 찾을 수 없어요.'; end if;
  if coalesce(p_path, '') !~ ('^sheets/' || p_song || '/[0-9a-f-]{36}\.pdf$') then raise exception '악보 파일 경로가 올바르지 않아요.'; end if;
  if p_pages is null or p_pages < 1 or p_pages > 40 then raise exception '악보는 40쪽까지예요.'; end if;
  if p_medley is not null and not exists (select 1 from public.medleys where id = p_medley) then raise exception '메들리를 찾을 수 없어요.'; end if;
  insert into public.sheet_versions (song_id, medley_id, kind, name, key, pages, path, size_bytes, thumb, created_by, setlist_id, added_for)
  values (p_song, p_medley, 'sheet', left(coalesce(nullif(trim(p_name), ''), '악보'), 60), nullif(left(trim(coalesce(p_key, '')), 12), ''),
          p_pages, p_path, nullif(p_size, 0), case when length(p_thumb) <= 60000 then p_thumb end, auth.uid(), sl.id, p_service)
  returning * into v;
  who := (select name from public.members where id = auth.uid());
  return json_build_object('id', v.id, 'song_id', v.song_id, 'medley_id', v.medley_id, 'kind', v.kind, 'name', v.name, 'key', v.key,
    'pages', v.pages, 'path', v.path, 'size_bytes', v.size_bytes, 'thumb', v.thumb, 'created_at', v.created_at, 'base_id', null,
    'by', who, 'from_date', (select service_date from public.services where id = p_service), 'from_leaders', sl.leaders,
    'ink', 0, 'used', 0, 'added', true);
end;
$$;
revoke all on function public.add_song_sheet(uuid, bigint, bigint, text, text, text, int, int, text) from public, anon;
grant execute on function public.add_song_sheet(uuid, bigint, bigint, text, text, text, int, int, text) to authenticated;

-- 그 예배 콘티에 쓰인 악보인지 (024) + 확정 전 고치기 · 파일로 바로 더한 악보
create or replace function public.sheet_in_service(p_service uuid, p_sheet bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.setlists sl join public.setlist_items i on i.setlist_id = sl.id
                  where sl.service_id = p_service and i.sheet_id = p_sheet and (sl.status = 'published' or public.can_edit_conti(p_service)))
      or exists (select 1 from public.sheet_versions v
                  where v.id = p_sheet and v.kind = 'sheet'
                    and (public.can_edit_conti(p_service)
                         or (v.added_for = p_service and public.can_edit_sheets(p_service)
                             and exists (select 1 from public.setlists sl2 where sl2.service_id = p_service and sl2.status = 'published'))));
$$;
revoke all on function public.sheet_in_service(uuid, bigint) from public, anon;
grant execute on function public.sheet_in_service(uuid, bigint) to authenticated;


-- ---------------------------------------------------------------------
-- 2. 파트 악보
-- ---------------------------------------------------------------------
-- 내 파트 = 주 포지션 + 보조 포지션 (리더십은 모든 파트)
create or replace function public.my_parts()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not public.is_member() then '{}'::text[]
    when public.is_admin() then array(select code from public.positions order by sort_order)
    else array(select x from (select main_position as x from public.members where id = auth.uid()
                              union select position_code from public.member_extra_positions where member_id = auth.uid()) q
               where x is not null order by x) end;
$$;
revoke all on function public.my_parts() from public, anon;
grant execute on function public.my_parts() to authenticated;

create or replace function public.has_part(p_part text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select p_part = any (public.my_parts()); $$;
revoke all on function public.has_part(text) from public, anon;
grant execute on function public.has_part(text) to authenticated;

create table if not exists public.part_sheets (
  id          bigint generated always as identity primary key,
  song_id     bigint not null references public.songs(id) on delete cascade,
  part        text not null references public.positions(code),
  name        text not null check (length(trim(name)) between 1 and 60),
  key         text check (length(key) <= 12),
  pages       smallint not null check (pages between 1 and 40),
  path        text not null unique check (path ~ '^parts/[0-9]+/[0-9a-f-]{36}\.pdf$'),
  size_bytes  int check (size_bytes between 1 and 30000000),
  thumb       text check (length(thumb) <= 60000),
  created_by  uuid references public.members(id) on delete set null default auth.uid(),
  by_name     text check (length(by_name) <= 30),
  created_at  timestamptz not null default now(),
  check (path like 'parts/' || song_id::text || '/%')
);
create index if not exists part_sheets_song_idx on public.part_sheets (song_id, part, created_at desc);

create or replace function public.part_sheets_fill()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.name := trim(new.name);
  new.key := nullif(trim(coalesce(new.key, '')), '');
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.by_name := left((select name from public.members where id = auth.uid()), 30);
    new.created_at := now();
  else
    new.created_by := old.created_by; new.by_name := old.by_name; new.created_at := old.created_at;
    new.song_id := old.song_id; new.path := old.path; new.part := old.part;
  end if;
  return new;
end;
$$;
drop trigger if exists part_sheets_fill on public.part_sheets;
create trigger part_sheets_fill before insert or update on public.part_sheets
  for each row execute function public.part_sheets_fill();

alter table public.part_sheets enable row level security;
drop policy if exists part_sheets_read on public.part_sheets;
drop policy if exists part_sheets_insert on public.part_sheets;
drop policy if exists part_sheets_update on public.part_sheets;
drop policy if exists part_sheets_delete on public.part_sheets;
create policy part_sheets_read on public.part_sheets for select
  using (public.is_member() and public.has_part(part));
create policy part_sheets_insert on public.part_sheets for insert
  with check (public.is_member() and public.has_part(part));
create policy part_sheets_update on public.part_sheets for update
  using (public.has_part(part) and (created_by = auth.uid() or public.is_admin()))
  with check (public.has_part(part));
create policy part_sheets_delete on public.part_sheets for delete
  using (public.has_part(part) and (created_by = auth.uid() or public.is_admin()));
grant select, insert, update, delete on public.part_sheets to authenticated;

-- 예배마다 내가 고른 파트 악보 (곡마다)
create table if not exists public.part_picks (
  member_id      uuid not null default auth.uid() references public.members(id) on delete cascade,
  service_id     uuid not null references public.services(id) on delete cascade,
  song_id        bigint not null references public.songs(id) on delete cascade,
  part_sheet_id  bigint not null references public.part_sheets(id) on delete cascade,
  updated_at     timestamptz not null default now(),
  primary key (member_id, service_id, song_id)
);
alter table public.part_picks enable row level security;
drop policy if exists part_picks_own on public.part_picks;
create policy part_picks_own on public.part_picks for all
  using (member_id = auth.uid())
  with check (member_id = auth.uid() and public.is_member());
grant select, insert, update, delete on public.part_picks to authenticated;

-- 파트 악보를 지우면 그 악보 공유 필기도 지움
create or replace function public.part_sheets_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.ink_extra where target = 't:' || old.id;
  return null;
end;
$$;
drop trigger if exists part_sheets_cleanup on public.part_sheets;
create trigger part_sheets_cleanup after delete on public.part_sheets
  for each row execute function public.part_sheets_cleanup();

-- 내 메모 · 공유 필기 대상에 파트 악보(t:)
alter table public.sheet_notes drop constraint if exists sheet_notes_key_check;
alter table public.sheet_notes add constraint sheet_notes_key_check
  check (key ~ '^(s:[0-9]{1,12}|p:[0-9]{1,12}|a:[0-9]{1,12}|x:[0-9]{1,12}|t:[0-9]{1,12}|b:[a-z0-9+]{1,8})$');
alter table public.ink_extra drop constraint if exists ink_extra_target_check;
alter table public.ink_extra add constraint ink_extra_target_check
  check (target ~ '^(a:[0-9]{1,12}|p:[0-9]{1,12}|x:[0-9]{1,12}|t:[0-9]{1,12}|b:[a-z0-9+]{1,8})$');

-- Storage 올리기 권한 (028) + 파트 악보: parts/<곡 id>/ (팀원 누구나 올리고, 표에 넣을 때 파트를 확인)
create or replace function public.can_upload_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_name ~ '^(sheets|originals)/' then public.can_upload_sheet()
    when p_name ~ '^(book|proc)/' then public.is_admin()
    when p_name ~ '^backup/' then public.can_lead_backup()
    when p_name ~ '^applied/[0-9a-f-]{36}/' then public.is_admin() or public.can_edit_conti(substring(p_name from 9 for 36)::uuid)
    when p_name ~ '^extra/[0-9a-f-]{36}/' then public.can_edit_conti(substring(p_name from 7 for 36)::uuid)
    when p_name ~ '^parts/[0-9]+/[0-9a-f-]{36}\.pdf$' then public.is_member() and cardinality(public.my_parts()) > 0
    else false end;
$$;
revoke all on function public.can_upload_object(text) from public, anon;
grant execute on function public.can_upload_object(text) to authenticated;


-- ---------------------------------------------------------------------
-- 3. 공유 필기 (028 ink_put) + 파트 악보(t:) — 그 포지션 팀원 · 리더십이 고치고 지워요 (그 예배 날짜 기준)
-- ---------------------------------------------------------------------
create or replace function public.ink_put(p_service uuid, p_target text, p_ver text, p_ops jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.services; t text := split_part(p_target, ':', 1); v text := split_part(p_target, ':', 2);
  maxp int := 40; ver text := null; a jsonb; st jsonb; pts int; c text; r public.ink_extra; who text; allall boolean;
  n_add int := 0; n_del int := 0; n_skip int := 0; ap public.applied_songs; w public.worship_proc; bs public.backup_songs; xe public.service_extras;
  ps public.part_sheets;
begin
  if p_target !~ '^(a:[0-9]{1,12}|p:[0-9]{1,12}|x:[0-9]{1,12}|t:[0-9]{1,12}|b:[a-z0-9+]{1,8})$' then raise exception '고칠 악보를 찾을 수 없어요.'; end if;
  if t = 't' then
    select * into ps from public.part_sheets where id = v::bigint;
    if ps.id is null then raise exception '파트 악보를 찾을 수 없어요. 새로고침해 주세요.'; end if;
    if not (public.is_member() and public.has_part(ps.part)) then raise exception '이 파트 악보는 그 포지션 팀원과 리더십만 고칠 수 있어요.'; end if;
    maxp := ps.pages;
  elsif not public.can_edit_sheets(p_service) then
    raise exception '이 예배의 악보를 고칠 수 있는 사람이 아니에요. (인도자 · 밴드 마스터 · 리더십 · 그 예배 밴드)';
  end if;
  select * into s from public.services where id = p_service;
  if s.id is null then raise exception '예배를 찾을 수 없어요.'; end if;
  if t = 't' then
    null;
  elsif t = 'a' then
    select * into ap from public.applied_songs where id = v::bigint;
    if ap.id is null or ap.service_id <> p_service then raise exception '이 예배의 적용찬양이 아니에요. 새로고침해 주세요.'; end if;
  elsif t = 'x' then
    select * into xe from public.service_extras where id = v::bigint;
    if xe.id is null or xe.service_id <> p_service then raise exception '이 예배의 특별순서가 아니에요. 새로고침해 주세요.'; end if;
    maxp := coalesce(nullif(cardinality(xe.images), 0), xe.pages, 1);
  elsif t = 'p' then
    select * into w from public.worship_proc where id = v::bigint;
    if w.id is null or w.removed or w.id <> (select x.id from public.worship_proc x where x.kind = w.kind and x.start_date <= s.service_date order by x.start_date desc, x.id desc limit 1) then
      raise exception '이 예배에 쓰는 예배 진행곡이 아니에요. 새로고침해 주세요.';
    end if;
    maxp := coalesce(nullif(cardinality(w.images), 0), case when w.path ~ '\.pdf$' then w.pages else 1 end, 1);
  else
    if p_service is distinct from public.backup_ctx_service() then raise exception '이번 백업찬양 예배가 아니에요. 새로고침해 주세요.'; end if;
    ver := coalesce(p_ver, '');
    if ver ~ '^[0-9]+$' then
      select x.* into bs from public.backup_songs x join public.backup_books b on b.id = x.book_id and b.active where x.book_id = ver::bigint and x.code = v and not x.hidden;
      maxp := coalesce(bs.pages, 1);
    elsif ver ~ '^c[0-9]+$' then
      select * into bs from public.backup_songs where id = substring(ver from 2)::bigint and book_id is null and code = v;
      maxp := coalesce(cardinality(bs.images), 1);
    end if;
    if bs.id is null then raise exception '지금 악보집에 없는 곡이에요. 새로고침해 주세요.'; end if;
  end if;
  allall := case when t = 't' then true else public.can_edit_conti(p_service) end;
  who := (select name from public.members where id = auth.uid());

  for a in select * from jsonb_array_elements(coalesce(p_ops -> 'add', '[]'::jsonb)) loop
    st := a -> 'stroke';
    if jsonb_typeof(st) <> 'object' or coalesce(st ->> 't', '') not in ('p', 'h', 't')
       or coalesce(st ->> 'c', '') !~ '^#[0-9A-Fa-f]{6}$' or jsonb_typeof(st -> 'p') <> 'array' then
      raise exception '필기를 읽지 못했어요.';
    end if;
    pts := jsonb_array_length(st -> 'p');
    if pts < 2 or pts > 6000 or pts % 2 = 1 then raise exception '필기를 읽지 못했어요.'; end if;
    if coalesce((a ->> 'page')::int, 0) < 1 or (a ->> 'page')::int > maxp then raise exception '쪽이 올바르지 않아요.'; end if;
    insert into public.ink_extra (target, ver, service_id, page, cid, stroke, author, author_name, valid_from)
    values (p_target, ver, p_service, (a ->> 'page')::int, a ->> 'cid',
            jsonb_build_object('t', st ->> 't', 'c', st ->> 'c', 'w', greatest(1, least(2000, coalesce((st ->> 'w')::numeric, 30)::int)), 'p', st -> 'p'),
            auth.uid(), left(who, 30), s.service_date)
    on conflict (cid) do nothing;
    if found then n_add := n_add + 1; end if;
  end loop;

  foreach c in array array(select jsonb_array_elements_text(coalesce(p_ops -> 'del', '[]'::jsonb))) loop
    select * into r from public.ink_extra where cid = c and target = p_target;
    if r.id is null or r.valid_from > s.service_date or (r.deleted_from is not null and r.deleted_from <= s.service_date) then continue; end if;
    if r.author is distinct from auth.uid() and not allall then n_skip := n_skip + 1; continue; end if;
    update public.ink_extra set deleted_from = s.service_date, deleted_at = now(), deleted_by = auth.uid() where id = r.id;
    n_del := n_del + 1;
  end loop;

  foreach c in array array(select jsonb_array_elements_text(coalesce(p_ops -> 'undel', '[]'::jsonb))) loop
    select * into r from public.ink_extra where cid = c and target = p_target;
    if r.id is null or r.deleted_from is null then continue; end if;
    if r.deleted_by is distinct from auth.uid() and not allall then continue; end if;
    update public.ink_extra set deleted_from = null, deleted_at = null, deleted_by = null where id = r.id;
    n_del := n_del + 1;
  end loop;

  if n_add + n_del > 0 and t in ('a', 'p', 'x') then
    update public.setlists set sheet_changes = jsonb_build_object('at', now(), 'by', who)
     where service_id = p_service and status = 'published';
  end if;
  return json_build_object('added', n_add, 'deleted', n_del, 'skipped', n_skip);
end;
$$;
revoke all on function public.ink_put(uuid, text, text, jsonb) from public, anon;
grant execute on function public.ink_put(uuid, text, text, jsonb) to authenticated;

-- 확인: select count(*) from part_sheets;  select public.my_parts();
--       select column_name from information_schema.columns where table_name = 'sheet_versions' and column_name = 'added_for';
