-- =====================================================================
--  024 — v25: 지난 예배 콘티 · 적용찬양 기록 · 악보 공유 필기 · BPM · 섬김이 팀 공유 링크 · 백업찬양 코드
--  · 지난 예배 콘티: 고쳐도 알림을 보내지 않아요 (setlists_quiet_past) · 이전 버전은 지금처럼 남아요
--  · applied_songs.norm : 같은 곡 묶기 (적용찬양 기록 · 통계) · 적용찬양 사진에도 내 메모 (key a:<id>)
--  · sheet_ink   : 악보 공유 필기 — 저장된 악보(sheet_versions) 위 필기 층, 획마다 한 줄 (쓴 사람 · 시각)
--                  valid_from = 고친 예배 날짜 → 그 날짜 이후 예배에 보이고, 지난 예배는 그때 모습 그대로
--                  지우기도 날짜로 (deleted_from) — 지운 예배 날짜 이후에만 안 보여요
--  · sheet_versions.base_id : 필기본(새 악보)이 어느 악보에서 나왔는지 — 내 메모는 원래 악보 기준으로 이어져요
--  · songs.team_bpm · team_meter / setlist_items.bpm · meter : BPM · 박자 (팀 기준 저장)
--  · share_links : 섬김이 팀 공유 링크 (팀별 고정 · 리더십이 만들고 끊음) — 읽기는 /api/conti 'share'로만
--  · backup_add_custom : 주제(p_topic)도 받음 (코드 자동 추천)
--  migration_023 다음에 SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 괜찮아요.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 지난 예배 콘티: 고쳐도 알림 없음
-- ---------------------------------------------------------------------
create or replace function public.setlists_quiet_past()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.service_id is not null and new.version is distinct from old.version
     and exists (select 1 from public.services s where s.id = new.service_id
                  and s.service_date < (now() at time zone 'Asia/Seoul')::date) then
    new.notified_version := new.version;
  end if;
  return new;
end;
$$;
drop trigger if exists setlists_quiet_past on public.setlists;
create trigger setlists_quiet_past
  before update on public.setlists
  for each row execute function public.setlists_quiet_past();


-- ---------------------------------------------------------------------
-- 2. BPM · 박자
-- ---------------------------------------------------------------------
alter table public.songs
  add column if not exists team_bpm   smallint check (team_bpm between 20 and 320),
  add column if not exists team_meter text check (team_meter in ('4/4', '3/4', '6/8'));
alter table public.setlist_items
  add column if not exists bpm   smallint check (bpm between 20 and 320),
  add column if not exists meter text check (meter in ('4/4', '3/4', '6/8'));

-- BPM만 바꾸기 (인도자 · 밴드 마스터 · 리더십 · 그 예배 밴드) — 알림 없음 · 팀 기준으로 저장
create or replace function public.set_bpm(p_service uuid, p_ord int, p_bpm int, p_meter text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare sl public.setlists; it public.setlist_items;
begin
  if not public.can_edit_sheets(p_service) then raise exception 'BPM은 인도자 · 밴드 마스터 · 리더십 · 그 예배 밴드만 고칠 수 있어요.'; end if;
  if p_bpm is not null and (p_bpm < 20 or p_bpm > 320) then raise exception 'BPM은 20~320 사이로 적어 주세요.'; end if;
  if p_meter is not null and p_meter not in ('4/4', '3/4', '6/8') then raise exception '박자는 4/4 · 3/4 · 6/8 중에서 골라 주세요.'; end if;
  select * into sl from public.setlists where service_id = p_service;
  if sl.id is null then raise exception '콘티가 아직 없어요.'; end if;
  update public.setlist_items set bpm = p_bpm, meter = coalesce(p_meter, meter, '4/4')
   where setlist_id = sl.id and ord = p_ord returning * into it;
  if it.id is null then raise exception '곡을 찾을 수 없어요. 새로고침해 주세요.'; end if;
  if p_bpm is not null then
    update public.songs set team_bpm = p_bpm, team_meter = coalesce(it.meter, '4/4')
     where id = it.song_id and (team_bpm is distinct from p_bpm or team_meter is distinct from coalesce(it.meter, '4/4'));
  end if;
  return json_build_object('ord', it.ord, 'song_id', it.song_id, 'bpm', it.bpm, 'meter', it.meter);
end;
$$;
revoke all on function public.set_bpm(uuid, int, int, text) from public, anon;
grant execute on function public.set_bpm(uuid, int, int, text) to authenticated;


-- ---------------------------------------------------------------------
-- 3. 콘티 저장 (021) + BPM · 박자 — 곡마다 bpm · meter, 적은 BPM은 팀 기준으로
--    BPM만 바뀌면 바뀐 것 = 'BPM 수정' (알림 없이)
-- ---------------------------------------------------------------------
create or replace function public.save_setlist(p_service uuid, p_data jsonb, p_publish boolean, p_base int default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.services; sl public.setlists;
  it jsonb; i int := 0; sid bigint; ns jsonb; rr jsonb;
  names text[]; was_pub boolean; old_items jsonb; new_items jsonb;
  ch text[] := '{}'; keys bigint[] := '{}'; o jsonb; nw jsonb; t text; old_common bigint[]; new_common bigint[];
  n_items int; bp int; mt text;
begin
  if not public.can_edit_conti(p_service) then raise exception '이 예배의 콘티를 고칠 수 있는 사람이 아니에요. (인도자 · 밴드 마스터 · 리더십)'; end if;
  select * into s from public.services where id = p_service;
  if s.id is null then raise exception '예배를 찾을 수 없어요.'; end if;
  n_items := jsonb_array_length(coalesce(p_data -> 'items', '[]'::jsonb));
  if n_items > 30 then raise exception '곡은 30곡까지 넣을 수 있어요.'; end if;
  if p_publish and n_items = 0 then raise exception '곡을 하나 이상 넣어 주세요.'; end if;

  select * into sl from public.setlists where service_id = p_service for update;
  if sl.id is not null and p_base is not null and sl.version <> p_base then
    raise exception using errcode = 'PT409', message = '다른 사람이 먼저 이 콘티를 고쳤어요. 새로 불러온 뒤 다시 고쳐 주세요.',
      detail = json_build_object('version', sl.version, 'by', (select name from public.members where id = sl.updated_by))::text;
  end if;
  names := array(select coalesce(m.name, g.name, a.former_name) from public.assignments a
                   left join public.members m on m.id = a.member_id left join public.guests g on g.id = a.guest_id
                  where a.service_id = p_service and a.position_code = 'leader' order by a.slot);
  if sl.id is null then
    insert into public.setlists (service_date, service_id, leaders, source, status, version)
    values (s.service_date, s.id, names, 'platform', 'draft', 0) returning * into sl;
  end if;
  was_pub := sl.status = 'published';
  select coalesce(jsonb_agg(jsonb_build_object('song_id', i.song_id, 'title', so.title, 'key', i.key, 'sheet_id', i.sheet_id, 'page_from', i.page_from,
           'page_to', i.page_to, 'medley', i.medley, 'refs', i.refs, 'duration_sec', i.duration_sec, 'duration_src', i.duration_src, 'memo', i.memo,
           'bpm', i.bpm, 'meter', i.meter) order by i.ord), '[]'::jsonb)
    into old_items from public.setlist_items i join public.songs so on so.id = i.song_id where i.setlist_id = sl.id;
  if was_pub and p_publish then
    insert into public.setlist_versions (setlist_id, version, snapshot, saved_by)
    values (sl.id, sl.version, jsonb_build_object('items', old_items, 'pages', sl.pages, 'target_sec', sl.target_sec, 'published_at', sl.published_at, 'updated_at', sl.updated_at), auth.uid())
    on conflict do nothing;
  end if;

  delete from public.setlist_items where setlist_id = sl.id;
  for it in select * from jsonb_array_elements(coalesce(p_data -> 'items', '[]'::jsonb)) loop
    i := i + 1;
    if not exists (select 1 from public.songs where id = (it ->> 'song_id')::bigint) then raise exception '곡을 찾을 수 없어요 (%번째).', i; end if;
    sid := nullif(it ->> 'sheet_id', '')::bigint;
    ns := it -> 'new_sheet';
    if ns is not null and jsonb_typeof(ns) = 'object' then
      if coalesce(ns ->> 'path', '') !~ ('^sheets/' || (it ->> 'song_id') || '/[0-9a-f-]{36}\.pdf$') then raise exception '악보 파일 경로가 올바르지 않아요.'; end if;
      insert into public.sheet_versions (song_id, kind, name, key, pages, path, size_bytes, thumb, created_by, setlist_id)
      values ((it ->> 'song_id')::bigint, 'sheet', left(coalesce(nullif(trim(ns ->> 'name'), ''), '악보'), 60), nullif(trim(it ->> 'key'), ''),
              (ns ->> 'pages')::int, ns ->> 'path', nullif(ns ->> 'size', '')::int, ns ->> 'thumb', auth.uid(), sl.id)
      on conflict (path) do update set name = excluded.name
      returning id into sid;
    end if;
    bp := nullif(it ->> 'bpm', '')::int;
    if bp is not null and (bp < 20 or bp > 320) then raise exception 'BPM은 20~320 사이로 적어 주세요 (%번째).', i; end if;
    mt := nullif(it ->> 'meter', '');
    if mt is not null and mt not in ('4/4', '3/4', '6/8') then mt := null; end if;
    insert into public.setlist_items (setlist_id, ord, song_id, key, medley, refs, duration_sec, duration_src, memo, sheet_id, page_from, page_to, bpm, meter)
    values (sl.id, i, (it ->> 'song_id')::bigint, nullif(trim(it ->> 'key'), ''), coalesce((it ->> 'medley')::boolean, false),
            case when jsonb_typeof(it -> 'refs') = 'array' then it -> 'refs' else '[]'::jsonb end,
            nullif(it ->> 'duration_sec', '')::int, nullif(it ->> 'duration_src', ''), nullif(trim(it ->> 'memo'), ''),
            sid, nullif(it ->> 'page_from', '')::int, nullif(it ->> 'page_to', '')::int, bp, case when bp is null and mt is null then null else coalesce(mt, '4/4') end);
    -- 직접 고친 곡 시간 = 다음부터 팀 기준
    if it ->> 'duration_src' = 'manual' and nullif(it ->> 'duration_sec', '') is not null then
      update public.songs set team_sec = (it ->> 'duration_sec')::int where id = (it ->> 'song_id')::bigint and team_sec is distinct from (it ->> 'duration_sec')::int;
    end if;
    -- 025: 적은 BPM · 박자 = 다음부터 팀 기준
    if bp is not null then
      update public.songs set team_bpm = bp, team_meter = coalesce(mt, '4/4')
       where id = (it ->> 'song_id')::bigint and (team_bpm is distinct from bp or team_meter is distinct from coalesce(mt, '4/4'));
    end if;
    -- 레퍼런스 구간 (다음부터 자동 적용)
    rr := it -> 'ref_range';
    if rr is not null and jsonb_typeof(rr) = 'object' and coalesce(rr ->> 'yt', '') ~ '^[A-Za-z0-9_-]{11}$' then
      insert into public.song_refs (song_id, youtube_id, start_sec, end_sec)
      values ((it ->> 'song_id')::bigint, rr ->> 'yt', coalesce(nullif(rr ->> 'start', '')::int, 0), nullif(rr ->> 'end', '')::int)
      on conflict (song_id, youtube_id) do update set start_sec = excluded.start_sec, end_sec = excluded.end_sec, updated_at = now();
    end if;
  end loop;

  -- 다시 올리면 바뀐 것 정리
  if was_pub and p_publish then
    select coalesce(jsonb_agg(jsonb_build_object('song_id', i.song_id, 'title', so.title, 'key', i.key, 'sheet_id', i.sheet_id, 'page_from', i.page_from, 'page_to', i.page_to, 'memo', i.memo,
             'bpm', i.bpm, 'meter', i.meter) order by i.ord), '[]'::jsonb)
      into new_items from public.setlist_items i join public.songs so on so.id = i.song_id where i.setlist_id = sl.id;
    for nw in select * from jsonb_array_elements(new_items) loop
      select x into o from jsonb_array_elements(old_items) x where x ->> 'song_id' = nw ->> 'song_id' limit 1;
      if o is null then ch := ch || ('곡 추가: ' || (nw ->> 'title'));
      elsif coalesce(o ->> 'key', '') <> coalesce(nw ->> 'key', '') then
        ch := ch || format('%s 키 %s → %s', nw ->> 'title', coalesce(nullif(o ->> 'key', ''), '?'), coalesce(nullif(nw ->> 'key', ''), '?'));
        keys := keys || (nw ->> 'song_id')::bigint;
      end if;
    end loop;
    for o in select * from jsonb_array_elements(old_items) loop
      if not exists (select 1 from jsonb_array_elements(new_items) x where x ->> 'song_id' = o ->> 'song_id') then ch := ch || ('곡 빠짐: ' || (o ->> 'title')); end if;
    end loop;
    old_common := array(select (x ->> 'song_id')::bigint from jsonb_array_elements(old_items) with ordinality t(x, n)
                         where exists (select 1 from jsonb_array_elements(new_items) y where y ->> 'song_id' = x ->> 'song_id') order by n);
    new_common := array(select (x ->> 'song_id')::bigint from jsonb_array_elements(new_items) with ordinality t(x, n)
                         where exists (select 1 from jsonb_array_elements(old_items) y where y ->> 'song_id' = x ->> 'song_id') order by n);
    if old_common <> new_common then ch := ch || '순서 변경'::text; end if;
    if coalesce(sl.pages, 0) <> coalesce((p_data ->> 'pages')::int, 0)
       or exists (select 1 from jsonb_array_elements(new_items) x join jsonb_array_elements(old_items) y on y ->> 'song_id' = x ->> 'song_id'
                   where coalesce(x ->> 'sheet_id', '') <> coalesce(y ->> 'sheet_id', '')
                      or coalesce(x ->> 'page_from', '') <> coalesce(y ->> 'page_from', '')) then
      ch := ch || '악보 PDF 교체'::text;
    end if;
    if cardinality(ch) = 0 then
      if exists (select 1 from jsonb_array_elements(new_items) x join jsonb_array_elements(old_items) y on y ->> 'song_id' = x ->> 'song_id'
                  where coalesce(x ->> 'memo', '') <> coalesce(y ->> 'memo', '')) then ch := ch || '메모 수정'::text;
      elsif exists (select 1 from jsonb_array_elements(new_items) x join jsonb_array_elements(old_items) y on y ->> 'song_id' = x ->> 'song_id'
                  where coalesce(x ->> 'bpm', '') <> coalesce(y ->> 'bpm', '') or coalesce(x ->> 'meter', '') <> coalesce(y ->> 'meter', '')) then ch := ch || 'BPM 수정'::text;
      else ch := ch || '내용 수정'::text; end if;
    end if;
  end if;

  update public.setlists set
    status = case when p_publish then 'published' else status end,
    version = version + 1,
    published_at = case when p_publish then coalesce(published_at, now()) else published_at end,
    updated_at = now(), updated_by = auth.uid(),
    target_sec = case when p_data ? 'target_sec' then nullif(p_data ->> 'target_sec', '')::int else target_sec end,
    pages = nullif(p_data ->> 'pages', '')::int,
    leaders = case when cardinality(names) > 0 then names else leaders end,
    changes = case when was_pub and p_publish then jsonb_build_object('text', to_jsonb(ch), 'key_songs', to_jsonb(keys), 'at', now()) else changes end
  where id = sl.id
  returning * into sl;
  return json_build_object('id', sl.id, 'version', sl.version, 'status', sl.status, 'changes', sl.changes, 'republished', was_pub and p_publish,
                           'past', s.service_date < (now() at time zone 'Asia/Seoul')::date);
end;
$$;
revoke all on function public.save_setlist(uuid, jsonb, boolean, int) from public, anon;
grant execute on function public.save_setlist(uuid, jsonb, boolean, int) to authenticated;


-- ---------------------------------------------------------------------
-- 4. 악보 공유 필기
-- ---------------------------------------------------------------------
alter table public.sheet_versions
  add column if not exists base_id bigint references public.sheet_versions(id) on delete set null;
-- 필기본(새 악보)은 원래 악보 파일을 함께 써요: path = '원래 경로#구분자'
do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'public.sheet_versions'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%originals%' loop
    execute format('alter table public.sheet_versions drop constraint %I', c);
  end loop;
end $$;
alter table public.sheet_versions add constraint sheet_versions_path_check
  check (path ~ '^(sheets|originals)/[0-9]+/[0-9a-f-]{36}\.pdf(#[a-z0-9]{1,16})?$');

create table if not exists public.sheet_ink (
  id            bigint generated always as identity primary key,
  sheet_id      bigint not null references public.sheet_versions(id) on delete cascade,
  page          smallint not null check (page between 1 and 40),
  cid           text not null unique check (cid ~ '^[A-Za-z0-9_-]{8,40}$'),
  stroke        jsonb not null check (jsonb_typeof(stroke) = 'object' and pg_column_size(stroke) < 60000),
  author        uuid references public.members(id) on delete set null,
  author_name   text check (length(author_name) <= 30),
  valid_from    date not null,
  created_at    timestamptz not null default now(),
  deleted_from  date,
  deleted_at    timestamptz,
  deleted_by    uuid references public.members(id) on delete set null
);
create index if not exists sheet_ink_sheet_idx on public.sheet_ink (sheet_id, page);
alter table public.sheet_ink enable row level security;
drop policy if exists sheet_ink_read on public.sheet_ink;
create policy sheet_ink_read on public.sheet_ink for select using (public.is_member());
grant select on public.sheet_ink to authenticated;
-- 쓰기는 함수로만

-- 이 예배 콘티에 이 악보가 쓰이는지 (임시 저장은 고칠 수 있는 사람만)
create or replace function public.sheet_in_service(p_service uuid, p_sheet bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.setlists sl join public.setlist_items i on i.setlist_id = sl.id
                  where sl.service_id = p_service and i.sheet_id = p_sheet and (sl.status = 'published' or public.can_edit_conti(p_service)));
$$;

-- 획 올리기 · 지우기 · 되살리기 (한 악보에 묶어서)
--   p_ops = { add: [{ cid, page, stroke: {t:'p'|'h'|'t', c, w, p:[x,y,…]} }], del: [cid], undel: [cid] }
--   고칠 수 있는 사람: 그 예배 인도자 · 밴드 마스터 · 리더십 · 그 예배 밴드
--   지우기: 내 획은 누구나 · 남의 획은 인도자 · 밴드 마스터 · 리더십만 (밴드는 수정 테이프로 덮기)
create or replace function public.sheet_ink_put(p_service uuid, p_sheet bigint, p_ops jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.services; v public.sheet_versions; a jsonb; st jsonb; n_add int := 0; n_del int := 0; n_skip int := 0; who text;
  allall boolean; r public.sheet_ink; c text; pts int;
begin
  if not public.can_edit_sheets(p_service) then raise exception '이 예배의 악보를 고칠 수 있는 사람이 아니에요. (인도자 · 밴드 마스터 · 리더십 · 그 예배 밴드)'; end if;
  select * into s from public.services where id = p_service;
  select * into v from public.sheet_versions where id = p_sheet;
  if v.id is null then raise exception '악보를 찾을 수 없어요.'; end if;
  if v.kind = 'original' then raise exception '원본 악보에는 바로 쓰지 않아요. 새 악보로 저장한 뒤 고쳐 주세요.'; end if;
  if not public.sheet_in_service(p_service, p_sheet) then raise exception '이 예배 콘티에 쓰인 악보가 아니에요. 새로고침해 주세요.'; end if;
  allall := public.can_edit_conti(p_service);
  who := (select name from public.members where id = auth.uid());

  for a in select * from jsonb_array_elements(coalesce(p_ops -> 'add', '[]'::jsonb)) loop
    st := a -> 'stroke';
    if jsonb_typeof(st) <> 'object' or coalesce(st ->> 't', '') not in ('p', 'h', 't')
       or coalesce(st ->> 'c', '') !~ '^#[0-9A-Fa-f]{6}$' or jsonb_typeof(st -> 'p') <> 'array' then
      raise exception '필기를 읽지 못했어요.';
    end if;
    pts := jsonb_array_length(st -> 'p');
    if pts < 2 or pts > 6000 or pts % 2 = 1 then raise exception '필기를 읽지 못했어요.'; end if;
    if coalesce((a ->> 'page')::int, 0) < 1 or (a ->> 'page')::int > v.pages then raise exception '쪽이 올바르지 않아요.'; end if;
    insert into public.sheet_ink (sheet_id, page, cid, stroke, author, author_name, valid_from)
    values (p_sheet, (a ->> 'page')::int, a ->> 'cid',
            jsonb_build_object('t', st ->> 't', 'c', st ->> 'c', 'w', greatest(1, least(2000, coalesce((st ->> 'w')::numeric, 30)::int)), 'p', st -> 'p'),
            auth.uid(), left(who, 30), s.service_date)
    on conflict (cid) do nothing;
    if found then n_add := n_add + 1; end if;
  end loop;

  foreach c in array array(select jsonb_array_elements_text(coalesce(p_ops -> 'del', '[]'::jsonb))) loop
    select * into r from public.sheet_ink where cid = c and sheet_id = p_sheet;
    if r.id is null or r.valid_from > s.service_date or (r.deleted_from is not null and r.deleted_from <= s.service_date) then continue; end if;
    if r.author is distinct from auth.uid() and not allall then n_skip := n_skip + 1; continue; end if;
    update public.sheet_ink set deleted_from = s.service_date, deleted_at = now(), deleted_by = auth.uid() where id = r.id;
    n_del := n_del + 1;
  end loop;

  foreach c in array array(select jsonb_array_elements_text(coalesce(p_ops -> 'undel', '[]'::jsonb))) loop
    select * into r from public.sheet_ink where cid = c and sheet_id = p_sheet;
    if r.id is null or r.deleted_from is null then continue; end if;
    if r.deleted_by is distinct from auth.uid() and not allall then continue; end if;
    update public.sheet_ink set deleted_from = null, deleted_at = null, deleted_by = null where id = r.id;
    n_del := n_del + 1;
  end loop;

  -- 이 악보를 쓰는 콘티(이 예배 날짜 이후)에 '악보 바뀜' — 알림 없음
  if n_add + n_del > 0 then
    update public.setlists sl set sheet_changes = jsonb_build_object('at', now(), 'by', who)
     where sl.status = 'published' and sl.service_id is not null
       and exists (select 1 from public.setlist_items i where i.setlist_id = sl.id and i.sheet_id = p_sheet)
       and exists (select 1 from public.services x where x.id = sl.service_id and x.service_date >= s.service_date);
  end if;
  return json_build_object('added', n_add, 'deleted', n_del, 'skipped', n_skip);
end;
$$;

-- 새 악보로 저장 (필기본): 이 콘티 곡의 악보를 같은 파일 + 지금 필기를 옮긴 새 이름의 악보로 바꿈
--   원본(필기 없는 악보)에 고치려면 먼저 이걸로 새 악보를 만들어요
create or replace function public.sheet_fork(p_service uuid, p_ord int, p_name text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare s public.services; sl public.setlists; it public.setlist_items; v public.sheet_versions; nid bigint; nm text := left(trim(coalesce(p_name, '')), 60); who text;
begin
  if not public.can_edit_sheets(p_service) then raise exception '이 예배의 악보를 고칠 수 있는 사람이 아니에요.'; end if;
  if length(nm) < 1 then raise exception '새 악보 이름을 적어 주세요.'; end if;
  select * into s from public.services where id = p_service;
  select * into sl from public.setlists where service_id = p_service for update;
  if sl.id is null then raise exception '콘티가 아직 없어요.'; end if;
  if sl.status <> 'published' and not public.can_edit_conti(p_service) then raise exception '올라온 콘티가 있어야 악보를 고칠 수 있어요.'; end if;
  select * into it from public.setlist_items where setlist_id = sl.id and ord = p_ord;
  if it.id is null or it.sheet_id is null then raise exception '이 곡에는 악보가 없어요.'; end if;
  select * into v from public.sheet_versions where id = it.sheet_id;
  who := (select name from public.members where id = auth.uid());
  insert into public.sheet_versions (song_id, kind, name, key, pages, path, size_bytes, thumb, created_by, setlist_id, base_id)
  values (v.song_id, 'sheet', nm, coalesce(it.key, v.key), v.pages, split_part(v.path, '#', 1) || '#' || substr(md5(random()::text || clock_timestamp()::text), 1, 10),
          v.size_bytes, v.thumb, auth.uid(), sl.id, coalesce(v.base_id, v.id))
  returning id into nid;
  -- 지금 보이는 필기를 옮김 (새 악보에서는 처음부터 있던 것으로)
  insert into public.sheet_ink (sheet_id, page, cid, stroke, author, author_name, valid_from, created_at)
  select nid, k.page, replace(gen_random_uuid()::text, '-', ''), k.stroke, k.author, k.author_name, date '1900-01-01', k.created_at
    from public.sheet_ink k
   where k.sheet_id = v.id and k.valid_from <= s.service_date and (k.deleted_from is null or k.deleted_from > s.service_date)
   order by k.id;
  update public.setlist_items set sheet_id = nid where id = it.id;
  update public.setlists set version = version + 1, notified_version = version + 1, updated_at = now(), updated_by = auth.uid(),
         sheet_changes = jsonb_build_object('at', now(), 'by', who)
   where id = sl.id returning * into sl;
  return json_build_object('sheet_id', nid, 'name', nm, 'version', sl.version, 'base_id', coalesce(v.base_id, v.id));
end;
$$;

-- 악보 이름 바꾸기 · 지우기 (021) — 필기본은 파일을 함께 쓰니 파일은 지우지 않아요
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
    if exists (select 1 from public.setlist_items where sheet_id = v.id) then raise exception '콘티에 쓰인 악보는 지울 수 없어요.'; end if;
    delete from public.sheet_versions where id = v.id;
    return json_build_object('deleted', true, 'path',
      case when v.path like '%#%' or exists (select 1 from public.sheet_versions x where split_part(x.path, '#', 1) = split_part(v.path, '#', 1)) then null else v.path end);
  end if;
  update public.sheet_versions set name = left(trim(p_name), 60) where id = v.id;
  return json_build_object('ok', true);
end;
$$;

revoke all on function public.sheet_in_service(uuid, bigint) from public, anon;
revoke all on function public.sheet_ink_put(uuid, bigint, jsonb) from public, anon;
revoke all on function public.sheet_fork(uuid, int, text) from public, anon;
revoke all on function public.edit_sheet(bigint, text, boolean) from public, anon;
grant execute on function public.sheet_in_service(uuid, bigint) to authenticated;
grant execute on function public.sheet_ink_put(uuid, bigint, jsonb) to authenticated;
grant execute on function public.sheet_fork(uuid, int, text) to authenticated;
grant execute on function public.edit_sheet(bigint, text, boolean) to authenticated;

-- 곡들의 악보 목록 (021) + 필기본 · 공유 필기 획 수
create or replace function public.song_sheets(p_songs bigint[])
returns json
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.is_member() then null else coalesce((
    select json_agg(json_build_object('id', v.id, 'song_id', v.song_id, 'kind', v.kind, 'name', v.name, 'key', v.key, 'pages', v.pages,
        'path', v.path, 'size_bytes', v.size_bytes, 'thumb', v.thumb, 'created_at', v.created_at, 'base_id', v.base_id,
        'by', (select name from public.members where id = v.created_by),
        'from_date', sl.service_date, 'from_leaders', sl.leaders,
        'ink', (select count(*) from public.sheet_ink k where k.sheet_id = v.id and k.deleted_from is null),
        'used', (select count(*) from public.setlist_items i join public.setlists x on x.id = i.setlist_id where i.sheet_id = v.id and x.status = 'published'))
      order by v.kind desc, v.created_at desc)
      from public.sheet_versions v left join public.setlists sl on sl.id = v.setlist_id
     where v.song_id = any (p_songs)), '[]'::json) end;
$$;
revoke all on function public.song_sheets(bigint[]) from public, anon;
grant execute on function public.song_sheets(bigint[]) to authenticated;


-- ---------------------------------------------------------------------
-- 5. 적용찬양: 같은 곡 묶기 · 내 메모
-- ---------------------------------------------------------------------
alter table public.applied_songs
  add column if not exists norm text generated always as (lower(regexp_replace(title, '[\s\(\)\[\]·.,!?''"-]', '', 'g'))) stored;
create index if not exists applied_songs_norm_idx on public.applied_songs (norm);

alter table public.sheet_notes drop constraint if exists sheet_notes_key_check;
alter table public.sheet_notes add constraint sheet_notes_key_check
  check (key ~ '^(s:[0-9]{1,12}|p:[0-9]{1,12}|a:[0-9]{1,12}|b:[a-z0-9]{1,8})$');
alter table public.sheet_notes add column if not exists anorm text;
create index if not exists sheet_notes_anorm_idx on public.sheet_notes (member_id, anorm) where anorm is not null;
-- 적용찬양 메모는 곡 이름(묶음)을 함께 저장 → '이 곡 지난 메모 보기'
create or replace function public.sheet_notes_anorm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.key like 'a:%' then
    new.anorm := (select norm from public.applied_songs where id = substring(new.key from 3)::bigint);
  else new.anorm := null; end if;
  return new;
end;
$$;
drop trigger if exists sheet_notes_anorm on public.sheet_notes;
create trigger sheet_notes_anorm before insert or update on public.sheet_notes
  for each row execute function public.sheet_notes_anorm();


-- ---------------------------------------------------------------------
-- 6. 콘티 읽기 (023) + BPM · 악보 필기본 · 적용찬양 묶음
-- ---------------------------------------------------------------------
create or replace function public.conti_one(p_service uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.is_member() then null else (
    select json_build_object(
      'id', s.id, 'date', s.service_date, 'ministry_id', s.ministry_id, 'ministry_name', mi.name, 'label', s.label,
      'start_time', s.start_time, 'end_time', s.end_time, 'published', s.status = 'published',
      'communion', public.has_communion(s.id), 'communion_set', s.communion,
      'can_edit', public.can_edit_conti(s.id), 'can_edit_sheets', public.can_edit_sheets(s.id),
      'can_applied', public.is_admin() or public.can_edit_conti(s.id),
      'past', s.service_date < (now() at time zone 'Asia/Seoul')::date,
      'deadline', public.conti_deadline(s.id), 'target_sec', public.conti_target(s.id),
      'practice_cancelled', s.ministry_id is null and coalesce((select practice_cancelled from public.team_meetings where meeting_date = s.service_date - 1), false),
      'lineup', coalesce((select json_agg(json_build_object('pos', a.position_code, 'slot', a.slot, 'member_id', a.member_id,
          'name', coalesce(m.name, g.name, a.former_name), 'guest', a.is_guest, 'sl', a.is_singer_leader, 'bm', a.is_band_master)
          order by p.sort_order, a.slot)
        from public.assignments a join public.positions p on p.code = a.position_code
        left join public.members m on m.id = a.member_id left join public.guests g on g.id = a.guest_id
        where a.service_id = s.id), '[]'::json),
      'applied', coalesce((select json_agg(json_build_object('id', x.id, 'ord', x.ord, 'title', x.title, 'key', x.key, 'note', x.note, 'images', x.images, 'norm', x.norm) order by x.ord, x.id)
        from public.applied_songs x where x.service_id = s.id), '[]'::json),
      'proc', public.proc_list(s.service_date, public.has_communion(s.id)),
      'setlist', (select json_build_object('id', sl.id, 'status', sl.status, 'version', sl.version, 'published_at', sl.published_at,
          'updated_at', sl.updated_at, 'target_sec', sl.target_sec, 'deadline', sl.deadline, 'pages', sl.pages, 'changes', sl.changes,
          'sheet_changes', sl.sheet_changes,
          'leaders', sl.leaders, 'updated_by', (select name from public.members where id = sl.updated_by),
          'items', coalesce((select json_agg(json_build_object('ord', i.ord, 'song_id', i.song_id, 'title', so.title, 'main_key', so.main_key,
              'team_sec', so.team_sec, 'team_bpm', so.team_bpm, 'team_meter', so.team_meter, 'bpm', i.bpm, 'meter', i.meter,
              'key', i.key, 'medley', i.medley, 'refs', i.refs, 'duration_sec', i.duration_sec, 'duration_src', i.duration_src,
              'memo', i.memo, 'sheet_id', i.sheet_id, 'sheet_name', sv.name, 'sheet_pages', sv.pages, 'sheet_path', sv.path, 'sheet_kind', sv.kind,
              'sheet_base', coalesce(sv.base_id, sv.id),
              'page_from', i.page_from, 'page_to', i.page_to) order by i.ord)
            from public.setlist_items i join public.songs so on so.id = i.song_id left join public.sheet_versions sv on sv.id = i.sheet_id
            where i.setlist_id = sl.id), '[]'::json))
        from public.setlists sl where sl.service_id = s.id and (sl.status = 'published' or public.can_edit_conti(s.id)))
    ) from public.services s left join public.ministries mi on mi.id = s.ministry_id
    where s.id = p_service and (s.status = 'published' or public.is_admin())
  ) end;
$$;
revoke all on function public.conti_one(uuid) from public, anon;
grant execute on function public.conti_one(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 7. 기록 (021) + 고칠 수 있는지 · BPM · 적용찬양
--    setlists: sid(예배) · e(콘티를 고칠 수 있음) · es(악보를 고칠 수 있음) · items 6번째 = BPM
--    applied : [id, 날짜, 곡 이름, 키, 사진, 묶음 이름, 예배, 사역 이름] — 지난 예배만
-- ---------------------------------------------------------------------
create or replace function public.history_bundle()
returns json
language sql
stable
security invoker
set search_path = public
as $$
  select case when not public.is_member() then null else json_build_object(
    'songs', coalesce((select json_agg(json_build_object('id', s.id, 'title', s.title, 'main_key', s.main_key, 'memo', s.memo, 'bpm', s.team_bpm, 'meter', s.team_meter) order by s.id) from public.songs s), '[]'::json),
    'setlists', coalesce((select json_agg(json_build_object(
        'd', sl.service_date, 'leaders', sl.leaders, 'note', coalesce(sl.note, ''), 'sid', sl.service_id,
        'e', case when sl.service_id is not null then public.can_edit_conti(sl.service_id) end,
        'es', case when sl.service_id is not null then public.can_edit_sheets(sl.service_id) end,
        'items', coalesce((select json_agg(json_build_array(i.ord, i.song_id, i.key, i.medley, i.refs, i.bpm) order by i.ord) from public.setlist_items i where i.setlist_id = sl.id), '[]'::json))
      order by sl.service_date)
      from public.setlists sl
     where sl.status = 'published'
       and sl.service_date <= (now() at time zone 'Asia/Seoul')::date
       and (sl.service_id is null or exists (select 1 from public.services s where s.id = sl.service_id and s.ministry_id is null))), '[]'::json),
    'lineup', coalesce((select json_agg(json_build_array(l.service_date, l.position, l.slot, l.person_name, l.is_guest) order by l.service_date, l.position, l.slot) from public.lineup_history l), '[]'::json),
    'applied', coalesce((select json_agg(json_build_array(x.id, s.service_date, x.title, x.key, x.images, x.norm, s.id, mi.name) order by s.service_date, x.ord, x.id)
      from public.applied_songs x join public.services s on s.id = x.service_id left join public.ministries mi on mi.id = s.ministry_id
     where s.status = 'published' and s.service_date <= (now() at time zone 'Asia/Seoul')::date), '[]'::json)
  ) end;
$$;
revoke all on function public.history_bundle() from public, anon;
grant execute on function public.history_bundle() to authenticated;


-- ---------------------------------------------------------------------
-- 8. 섬김이 팀 공유 링크 (자막팀 · 방송팀 …) — 로그인 없이 보기만
-- ---------------------------------------------------------------------
create table if not exists public.share_links (
  id            bigint generated always as identity primary key,
  token         text not null unique check (token ~ '^[A-Za-z0-9_-]{20,64}$'),
  label         text not null check (length(trim(label)) between 1 and 30),
  active        boolean not null default true,
  created_by    uuid references public.members(id) on delete set null,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);
alter table public.share_links enable row level security;
drop policy if exists share_links_admin on public.share_links;
create policy share_links_admin on public.share_links for all using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.share_links to authenticated;


-- ---------------------------------------------------------------------
-- 9. 백업찬양: 이미지로 곡 더하기 — 주제도 받음 (코드 자동 추천: 키 · 주제 · 다음 번호)
-- ---------------------------------------------------------------------
drop function if exists public.backup_add_custom(text, text, text, text[]);
create or replace function public.backup_add_custom(p_title text, p_key text, p_code text, p_images text[], p_topic int default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare c text := lower(trim(coalesce(p_code, ''))); r public.backup_songs; n int; k text := nullif(lower(trim(coalesce(p_key, ''))), '');
begin
  if not public.can_lead_backup() then raise exception '이번 주 인도자 · 리더십만 곡을 더할 수 있어요.'; end if;
  if length(trim(coalesce(p_title, ''))) < 1 then raise exception '곡 이름을 적어 주세요.'; end if;
  if not public.paths_ok(p_images, 'backup/') then raise exception '악보 이미지를 1~12장 올려 주세요.'; end if;
  if k is not null and k !~ '^[a-g]$' then raise exception '키를 다시 골라 주세요.'; end if;
  if p_topic is not null and (p_topic < 0 or p_topic > 9) then raise exception '주제를 다시 골라 주세요.'; end if;
  if c = '' then
    select coalesce(max(substring(code from 2)::int), 0) + 1 into n from public.backup_songs where book_id is null and code ~ '^x[0-9]{1,5}$';
    c := 'x' || n;
  end if;
  if c !~ '^[a-z0-9+]{1,6}$' then raise exception '코드는 영문 소문자 · 숫자 6자까지예요.'; end if;
  if exists (select 1 from public.backup_songs s left join public.backup_books b on b.id = s.book_id
              where s.code = c and not s.hidden and (s.book_id is null or b.active)) then raise exception '이미 있는 코드예요 (%).', c; end if;
  insert into public.backup_songs (book_id, code, title, key, topic, pages, images, created_by)
  values (null, c, trim(p_title), k, p_topic, cardinality(p_images), p_images, auth.uid())
  returning * into r;
  return row_to_json(r);
end;
$$;
revoke all on function public.backup_add_custom(text, text, text, text[], int) from public, anon;
grant execute on function public.backup_add_custom(text, text, text, text[], int) to authenticated;

-- 확인: select count(*) from sheet_ink;  select column_name from information_schema.columns where table_name='songs' and column_name like 'team_%';
