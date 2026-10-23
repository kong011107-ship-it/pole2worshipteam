-- =====================================================================
--  025 — v26: 메트로놈 1/4 · 음원과 키 다름(*) · 메들리 · 콘티 카톡 복사 · 백업 개편
--  · 박자에 1/4 (강박 없이 모든 박이 같은 소리) — songs.team_meter · setlist_items.meter
--  · setlist_items.diff_key  : 음원과 키 다름 → 키 뒤에 '*' (콘티 보기 · 악보 보기 · 카톡 복사)
--  · setlist_items.join_prev : 앞 곡에 이어서 (메들리 묶음). medley = 묶음에 든 곡 (기록 · 통계는 곡마다 그대로)
--  · medleys · medley_songs  : 메들리 (곡은 라이브러리에 따로, 메들리에는 합친 악보 · 레퍼런스 · 곡 시간)
--      콘티에 메들리를 넣으면 곡들이 한 번호 아래로 · 예상 RT는 메들리 시간
--      sheet_versions.medley_id : 메들리 악보 (파일 경로는 첫 곡 폴더)
--  · '+'가 들어간 곡(예: '마음의 예배 + 내 삶의 이유라') → 메들리로 정리 (리더십이 하나씩 확인)
--      곡을 나눠 만들거나 이어 붙이고, 악보 · 레퍼런스 · 곡 시간 · 부른 기록을 옮겨요 (기록은 곡마다 셈)
--  · conti_share_links : 카톡 복사에 붙일 섬김이 팀 링크 (콘티를 고칠 수 있는 사람)
--  · backup_log : 종류(백업 · 복원) · 표 별 개수 · 파일 수 · 보관 이름 — 설정 › 백업 '결과 확인 표'
--  · ops_secrets : 이관 · 복원에 필요한 비밀값 메모 — 최상위 리더십만 보고 고쳐요
--  migration_024 다음에 SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 괜찮아요.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 박자: 1/4
-- ---------------------------------------------------------------------
do $$
declare c record;
begin
  for c in select conrelid::regclass::text tbl, conname from pg_constraint
            where conrelid in ('public.songs'::regclass, 'public.setlist_items'::regclass) and contype = 'c'
              and pg_get_constraintdef(oid) like '%6/8%' loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end $$;
alter table public.songs add constraint songs_team_meter_check check (team_meter in ('4/4', '3/4', '6/8', '1/4'));
alter table public.setlist_items add constraint setlist_items_meter_check check (meter in ('4/4', '3/4', '6/8', '1/4'));

create or replace function public.meter_ok(p text)
returns boolean language sql immutable as $$ select p in ('4/4', '3/4', '6/8', '1/4'); $$;

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
  if p_meter is not null and not public.meter_ok(p_meter) then raise exception '박자는 4/4 · 3/4 · 6/8 · 1/4 중에서 골라 주세요.'; end if;
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
-- 2. 메들리
-- ---------------------------------------------------------------------
create table if not exists public.medleys (
  id          bigint generated always as identity primary key,
  title       text not null check (length(trim(title)) between 1 and 120),
  norm        text not null unique,
  ref_yt      text check (ref_yt ~ '^[A-Za-z0-9_-]{11}$'),
  ref_start   int check (ref_start between 0 and 86400),
  ref_end     int check (ref_end between 1 and 86400),
  team_sec    int check (team_sec between 10 and 3600),
  memo        text check (length(memo) <= 300),
  from_song   text check (length(from_song) <= 120),     -- '+' 곡에서 정리한 경우 원래 이름
  created_by  uuid references public.members(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table if not exists public.medley_songs (
  medley_id  bigint not null references public.medleys(id) on delete cascade,
  ord        smallint not null check (ord between 1 and 8),
  song_id    bigint not null references public.songs(id),
  key        text check (length(key) <= 12),
  primary key (medley_id, ord)
);
create index if not exists medley_songs_song_idx on public.medley_songs (song_id);

create or replace function public.medleys_norm()
returns trigger language plpgsql as $$
begin
  new.title := trim(new.title);
  new.norm := lower(regexp_replace(new.title, '\s', '', 'g'));
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists medleys_norm on public.medleys;
create trigger medleys_norm before insert or update on public.medleys for each row execute function public.medleys_norm();

alter table public.medleys      enable row level security;
alter table public.medley_songs enable row level security;
drop policy if exists medleys_read on public.medleys;
drop policy if exists medleys_admin on public.medleys;
drop policy if exists medley_songs_read on public.medley_songs;
drop policy if exists medley_songs_admin on public.medley_songs;
create policy medleys_read on public.medleys for select using (public.is_member());
create policy medleys_admin on public.medleys for all using (public.is_admin()) with check (public.is_admin());
create policy medley_songs_read on public.medley_songs for select using (public.is_member());
create policy medley_songs_admin on public.medley_songs for all using (public.is_admin()) with check (public.is_admin());

drop trigger if exists audit_row on public.medleys;
create trigger audit_row after insert or update or delete on public.medleys
  for each row execute function public.audit_row('id', '', '', 'norm', '');

alter table public.sheet_versions
  add column if not exists medley_id bigint references public.medleys(id) on delete set null;
create index if not exists sheet_versions_medley_idx on public.sheet_versions (medley_id) where medley_id is not null;

alter table public.setlist_items
  add column if not exists diff_key  boolean not null default false,
  add column if not exists join_prev boolean not null default false,
  add column if not exists medley_id bigint references public.medleys(id) on delete set null;
alter table public.setlist_items drop constraint if exists setlist_items_duration_src_check;
alter table public.setlist_items add constraint setlist_items_duration_src_check check (duration_src in ('manual', 'team', 'video', 'medley'));

-- 플랫폼에서 쓴 콘티(v22~25): '메들리 · 앞 곡과 이어서'로 쓴 표시를 이어서(join_prev)로 옮김
update public.setlist_items i set join_prev = true
  from public.setlists sl
 where sl.id = i.setlist_id and sl.source = 'platform' and i.medley and i.ord > 1 and not i.join_prev;
update public.setlist_items i set medley = true
  from public.setlists sl
 where sl.id = i.setlist_id and sl.source = 'platform' and not i.medley
   and exists (select 1 from public.setlist_items n where n.setlist_id = i.setlist_id and n.ord = i.ord + 1 and n.join_prev);

-- 메들리를 만들 수 있는 사람: 리더십 · 최근 예배 인도자 · 밴드 마스터 (새 곡 더하기와 같음)
create or replace function public.can_add_song()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.assignments a join public.services s on s.id = a.service_id
     where a.member_id = auth.uid() and (a.position_code = 'leader' or a.is_band_master) and s.service_date >= current_date - 14);
$$;
revoke all on function public.can_add_song() from public, anon;
grant execute on function public.can_add_song() to authenticated;

-- 메들리 만들기 · 고치기
--   p_data = { title, songs: [{ song_id, key }], ref_yt, ref_start, ref_end, team_sec, memo, sheet_id }
--   sheet_id: 이 콘티(p_service)에서 첫 곡에 저장한 합친 악보를 메들리 악보로
create or replace function public.save_medley(p_id bigint, p_data jsonb, p_service uuid default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare m public.medleys; s jsonb; k int := 0; t text := trim(coalesce(p_data ->> 'title', '')); n int; sv public.sheet_versions; first_song bigint;
begin
  if not public.can_add_song() then raise exception '메들리는 리더십 · 인도자 · 밴드 마스터만 만들 수 있어요.'; end if;
  if p_id is not null and not public.is_admin() then
    select * into m from public.medleys where id = p_id;
    if m.created_by is distinct from auth.uid() then raise exception '메들리 고치기는 리더십이나 만든 사람만 할 수 있어요.'; end if;
  end if;
  n := jsonb_array_length(coalesce(p_data -> 'songs', '[]'::jsonb));
  if n < 2 or n > 8 then raise exception '메들리에는 곡을 2~8곡 넣어 주세요.'; end if;
  if t = '' then
    select string_agg(so.title, ' + ' order by x.o) into t
      from jsonb_array_elements(p_data -> 'songs') with ordinality x(v, o) join public.songs so on so.id = (x.v ->> 'song_id')::bigint;
  end if;
  if length(t) > 120 then raise exception '메들리 이름은 120자까지예요.'; end if;
  if exists (select 1 from public.medleys where norm = lower(regexp_replace(t, '\s', '', 'g')) and id is distinct from p_id) then
    raise exception '같은 이름의 메들리가 이미 있어요 (%).', t;
  end if;
  if p_id is null then
    insert into public.medleys (title, norm) values (t, '') returning * into m;
  else
    select * into m from public.medleys where id = p_id for update;
    if m.id is null then raise exception '메들리를 찾을 수 없어요.'; end if;
  end if;
  update public.medleys set title = t,
    ref_yt = case when p_data ? 'ref_yt' then nullif(p_data ->> 'ref_yt', '') else ref_yt end,
    ref_start = case when p_data ? 'ref_start' then nullif(p_data ->> 'ref_start', '')::int else ref_start end,
    ref_end = case when p_data ? 'ref_end' then nullif(p_data ->> 'ref_end', '')::int else ref_end end,
    team_sec = case when p_data ? 'team_sec' then nullif(p_data ->> 'team_sec', '')::int else team_sec end,
    memo = case when p_data ? 'memo' then nullif(trim(p_data ->> 'memo'), '') else memo end
   where id = m.id returning * into m;
  delete from public.medley_songs where medley_id = m.id;
  for s in select * from jsonb_array_elements(p_data -> 'songs') loop
    k := k + 1;
    if not exists (select 1 from public.songs where id = (s ->> 'song_id')::bigint) then raise exception '곡을 찾을 수 없어요 (%번째).', k; end if;
    insert into public.medley_songs (medley_id, ord, song_id, key) values (m.id, k, (s ->> 'song_id')::bigint, nullif(trim(s ->> 'key'), ''));
  end loop;
  first_song := (p_data -> 'songs' -> 0 ->> 'song_id')::bigint;
  -- 합친 악보: 이 콘티에서 첫 곡에 새로 저장한 악보만 메들리 악보로 옮김 (다른 콘티에서 쓰던 그 곡 악보는 그대로)
  if nullif(p_data ->> 'sheet_id', '') is not null then
    select * into sv from public.sheet_versions where id = (p_data ->> 'sheet_id')::bigint;
    if sv.id is not null and sv.medley_id is null and sv.song_id = first_song
       and (public.is_admin() or (p_service is not null and sv.setlist_id = (select id from public.setlists where service_id = p_service))) then
      update public.sheet_versions set medley_id = m.id where id = sv.id;
    end if;
  end if;
  return json_build_object('id', m.id, 'title', m.title, 'team_sec', m.team_sec);
end;
$$;

-- 메들리 지우기 (리더십) — 콘티 기록은 곡마다 그대로 남고, 메들리 악보는 첫 곡 악보로 돌아가요
create or replace function public.delete_medley(p_id bigint)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception '메들리 지우기는 리더십만 할 수 있어요.'; end if;
  update public.sheet_versions set medley_id = null where medley_id = p_id;
  delete from public.medleys where id = p_id;
  return json_build_object('ok', true);
end;
$$;

-- 메들리 목록 (곡 · 키 · 부른 횟수 · 악보 수)
create or replace function public.medley_list()
returns json language sql stable security definer set search_path = public as $$
  select case when not public.is_member() then null else coalesce((
    select json_agg(json_build_object('id', m.id, 'title', m.title, 'norm', m.norm, 'ref_yt', m.ref_yt, 'ref_start', m.ref_start, 'ref_end', m.ref_end,
        'team_sec', m.team_sec, 'memo', m.memo, 'from_song', m.from_song, 'created_at', m.created_at,
        'songs', coalesce((select json_agg(json_build_object('song_id', x.song_id, 'title', so.title, 'key', x.key, 'team_bpm', so.team_bpm, 'team_meter', so.team_meter) order by x.ord)
                            from public.medley_songs x join public.songs so on so.id = x.song_id where x.medley_id = m.id), '[]'::json),
        'used', (select count(distinct i.setlist_id) from public.setlist_items i join public.setlists sl on sl.id = i.setlist_id where i.medley_id = m.id and sl.status = 'published'),
        'last', (select max(sl.service_date) from public.setlist_items i join public.setlists sl on sl.id = i.setlist_id where i.medley_id = m.id and sl.status = 'published'),
        'sheets', (select count(*) from public.sheet_versions v where v.medley_id = m.id)) order by m.title)
      from public.medleys m), '[]'::json) end;
$$;

-- 메들리 악보 (곡 악보 목록과 같은 모양)
create or replace function public.medley_sheets(p_ids bigint[])
returns json language sql stable security definer set search_path = public as $$
  select case when not public.is_member() then null else coalesce((
    select json_agg(json_build_object('id', v.id, 'song_id', v.song_id, 'medley_id', v.medley_id, 'kind', v.kind, 'name', v.name, 'key', v.key, 'pages', v.pages,
        'path', v.path, 'size_bytes', v.size_bytes, 'thumb', v.thumb, 'created_at', v.created_at, 'base_id', v.base_id,
        'by', (select name from public.members where id = v.created_by),
        'from_date', sl.service_date, 'from_leaders', sl.leaders,
        'ink', (select count(*) from public.sheet_ink k where k.sheet_id = v.id and k.deleted_from is null),
        'used', (select count(*) from public.setlist_items i join public.setlists x on x.id = i.setlist_id where i.sheet_id = v.id and x.status = 'published'))
      order by v.kind desc, v.created_at desc)
      from public.sheet_versions v left join public.setlists sl on sl.id = v.setlist_id
     where v.medley_id = any (p_ids)), '[]'::json) end;
$$;

-- 곡 악보 목록 (024): 메들리 악보는 빼요 (메들리 쪽에서 보여요)
create or replace function public.song_sheets(p_songs bigint[])
returns json language sql stable security definer set search_path = public as $$
  select case when not public.is_member() then null else coalesce((
    select json_agg(json_build_object('id', v.id, 'song_id', v.song_id, 'kind', v.kind, 'name', v.name, 'key', v.key, 'pages', v.pages,
        'path', v.path, 'size_bytes', v.size_bytes, 'thumb', v.thumb, 'created_at', v.created_at, 'base_id', v.base_id,
        'by', (select name from public.members where id = v.created_by),
        'from_date', sl.service_date, 'from_leaders', sl.leaders,
        'ink', (select count(*) from public.sheet_ink k where k.sheet_id = v.id and k.deleted_from is null),
        'used', (select count(*) from public.setlist_items i join public.setlists x on x.id = i.setlist_id where i.sheet_id = v.id and x.status = 'published'))
      order by v.kind desc, v.created_at desc)
      from public.sheet_versions v left join public.setlists sl on sl.id = v.setlist_id
     where v.song_id = any (p_songs) and v.medley_id is null), '[]'::json) end;
$$;

-- 메들리 원본 악보 올리기 (필기 없는 합친 악보)
create or replace function public.add_medley_original(p_medley bigint, p_key text, p_name text, p_path text, p_pages int, p_size int, p_thumb text)
returns bigint language plpgsql security definer set search_path = public as $$
declare first_song bigint; sid bigint;
begin
  if not public.can_upload_sheet() then raise exception '악보는 리더십 · 인도자 · 밴드 마스터만 올릴 수 있어요.'; end if;
  select song_id into first_song from public.medley_songs where medley_id = p_medley order by ord limit 1;
  if first_song is null then raise exception '메들리를 찾을 수 없어요.'; end if;
  if p_path !~ ('^originals/' || first_song || '/[0-9a-f-]{36}\.pdf$') then raise exception '악보 파일 경로가 올바르지 않아요.'; end if;
  insert into public.sheet_versions (song_id, medley_id, kind, name, key, pages, path, size_bytes, thumb, created_by)
  values (first_song, p_medley, 'original', left(coalesce(nullif(trim(p_name), ''), '원본 ' || coalesce(p_key, '')), 60), nullif(trim(p_key), ''), p_pages, p_path, p_size, p_thumb, auth.uid())
  returning id into sid;
  return sid;
end;
$$;

revoke all on function public.save_medley(bigint, jsonb, uuid) from public, anon;
revoke all on function public.delete_medley(bigint) from public, anon;
revoke all on function public.medley_list() from public, anon;
revoke all on function public.medley_sheets(bigint[]) from public, anon;
revoke all on function public.song_sheets(bigint[]) from public, anon;
revoke all on function public.add_medley_original(bigint, text, text, text, int, int, text) from public, anon;
grant execute on function public.save_medley(bigint, jsonb, uuid) to authenticated;
grant execute on function public.delete_medley(bigint) to authenticated;
grant execute on function public.medley_list() to authenticated;
grant execute on function public.medley_sheets(bigint[]) to authenticated;
grant execute on function public.song_sheets(bigint[]) to authenticated;
grant execute on function public.add_medley_original(bigint, text, text, text, int, int, text) to authenticated;


-- ---------------------------------------------------------------------
-- 3. 콘티 저장 (024) + 음원과 키 다름 · 이어서(메들리) · 메들리 악보 · 1/4
--    묶음 첫 곡의 시간 = 메들리 전체 시간 (뒤 곡은 0 · 'medley') — 예상 RT는 메들리 시간으로
--    직접 고친 시간: 묶음이 아니면 곡의 팀 기준, 메들리 첫 곡이면 메들리 팀 기준, 그냥 이어 붙인 묶음이면 저장 안 함
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
  n_items int; bp int; mt text; arr jsonb; jp boolean; nxt boolean; mid bigint; head boolean; grp boolean;
begin
  if not public.can_edit_conti(p_service) then raise exception '이 예배의 콘티를 고칠 수 있는 사람이 아니에요. (인도자 · 밴드 마스터 · 리더십)'; end if;
  select * into s from public.services where id = p_service;
  if s.id is null then raise exception '예배를 찾을 수 없어요.'; end if;
  arr := coalesce(p_data -> 'items', '[]'::jsonb);
  n_items := jsonb_array_length(arr);
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
           'bpm', i.bpm, 'meter', i.meter, 'diff_key', i.diff_key, 'join_prev', i.join_prev, 'medley_id', i.medley_id) order by i.ord), '[]'::jsonb)
    into old_items from public.setlist_items i join public.songs so on so.id = i.song_id where i.setlist_id = sl.id;
  if was_pub and p_publish then
    insert into public.setlist_versions (setlist_id, version, snapshot, saved_by)
    values (sl.id, sl.version, jsonb_build_object('items', old_items, 'pages', sl.pages, 'target_sec', sl.target_sec, 'published_at', sl.published_at, 'updated_at', sl.updated_at), auth.uid())
    on conflict do nothing;
  end if;

  delete from public.setlist_items where setlist_id = sl.id;
  for it in select * from jsonb_array_elements(arr) loop
    i := i + 1;
    if not exists (select 1 from public.songs where id = (it ->> 'song_id')::bigint) then raise exception '곡을 찾을 수 없어요 (%번째).', i; end if;
    jp := i > 1 and coalesce((it ->> 'join_prev')::boolean, false);
    nxt := i < n_items and coalesce((arr -> i ->> 'join_prev')::boolean, false);
    head := not jp and nxt; grp := jp or nxt;
    mid := nullif(it ->> 'medley_id', '')::bigint;
    if mid is not null and (not grp or not exists (select 1 from public.medleys where id = mid)) then mid := null; end if;
    sid := nullif(it ->> 'sheet_id', '')::bigint;
    ns := it -> 'new_sheet';
    if ns is not null and jsonb_typeof(ns) = 'object' then
      if coalesce(ns ->> 'path', '') !~ ('^sheets/' || (it ->> 'song_id') || '/[0-9a-f-]{36}\.pdf$') then raise exception '악보 파일 경로가 올바르지 않아요.'; end if;
      insert into public.sheet_versions (song_id, kind, name, key, pages, path, size_bytes, thumb, created_by, setlist_id, medley_id)
      values ((it ->> 'song_id')::bigint, 'sheet', left(coalesce(nullif(trim(ns ->> 'name'), ''), '악보'), 60), nullif(trim(it ->> 'key'), ''),
              (ns ->> 'pages')::int, ns ->> 'path', nullif(ns ->> 'size', '')::int, ns ->> 'thumb', auth.uid(), sl.id, case when head then mid end)
      on conflict (path) do update set name = excluded.name
      returning id into sid;
    end if;
    bp := nullif(it ->> 'bpm', '')::int;
    if bp is not null and (bp < 20 or bp > 320) then raise exception 'BPM은 20~320 사이로 적어 주세요 (%번째).', i; end if;
    mt := nullif(it ->> 'meter', '');
    if mt is not null and not public.meter_ok(mt) then mt := null; end if;
    insert into public.setlist_items (setlist_id, ord, song_id, key, medley, refs, duration_sec, duration_src, memo, sheet_id, page_from, page_to, bpm, meter,
                                      diff_key, join_prev, medley_id)
    values (sl.id, i, (it ->> 'song_id')::bigint, nullif(trim(it ->> 'key'), ''), grp,
            case when jsonb_typeof(it -> 'refs') = 'array' then it -> 'refs' else '[]'::jsonb end,
            case when jp then 0 else nullif(it ->> 'duration_sec', '')::int end, case when jp then 'medley' else nullif(it ->> 'duration_src', '') end,
            nullif(trim(it ->> 'memo'), ''),
            sid, nullif(it ->> 'page_from', '')::int, nullif(it ->> 'page_to', '')::int, bp, case when bp is null and mt is null then null else coalesce(mt, '4/4') end,
            coalesce((it ->> 'diff_key')::boolean, false), jp, mid);
    -- 직접 고친 곡 시간 = 다음부터 팀 기준 (묶음이 아니면 곡, 메들리 첫 곡이면 메들리)
    if it ->> 'duration_src' = 'manual' and nullif(it ->> 'duration_sec', '') is not null and not jp then
      if not grp then
        update public.songs set team_sec = (it ->> 'duration_sec')::int where id = (it ->> 'song_id')::bigint and team_sec is distinct from (it ->> 'duration_sec')::int;
      elsif head and mid is not null then
        update public.medleys set team_sec = (it ->> 'duration_sec')::int where id = mid and team_sec is distinct from (it ->> 'duration_sec')::int;
      end if;
    end if;
    -- 025: 적은 BPM · 박자 = 다음부터 팀 기준 (곡마다)
    if bp is not null then
      update public.songs set team_bpm = bp, team_meter = coalesce(mt, '4/4')
       where id = (it ->> 'song_id')::bigint and (team_bpm is distinct from bp or team_meter is distinct from coalesce(mt, '4/4'));
    end if;
    -- 레퍼런스 구간 (다음부터 자동 적용): 묶음이 아니면 곡, 메들리 첫 곡이면 메들리
    rr := it -> 'ref_range';
    if rr is not null and jsonb_typeof(rr) = 'object' and coalesce(rr ->> 'yt', '') ~ '^[A-Za-z0-9_-]{11}$' and not jp then
      if not grp then
        insert into public.song_refs (song_id, youtube_id, start_sec, end_sec)
        values ((it ->> 'song_id')::bigint, rr ->> 'yt', coalesce(nullif(rr ->> 'start', '')::int, 0), nullif(rr ->> 'end', '')::int)
        on conflict (song_id, youtube_id) do update set start_sec = excluded.start_sec, end_sec = excluded.end_sec, updated_at = now();
      elsif head and mid is not null then
        update public.medleys set ref_yt = rr ->> 'yt', ref_start = coalesce(nullif(rr ->> 'start', '')::int, 0), ref_end = nullif(rr ->> 'end', '')::int where id = mid;
      end if;
    end if;
  end loop;

  -- 다시 올리면 바뀐 것 정리
  if was_pub and p_publish then
    select coalesce(jsonb_agg(jsonb_build_object('song_id', i.song_id, 'title', so.title, 'key', i.key, 'sheet_id', i.sheet_id, 'page_from', i.page_from, 'page_to', i.page_to, 'memo', i.memo,
             'bpm', i.bpm, 'meter', i.meter, 'diff_key', i.diff_key, 'join_prev', i.join_prev) order by i.ord), '[]'::jsonb)
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
    if exists (select 1 from jsonb_array_elements(new_items) x join jsonb_array_elements(old_items) y on y ->> 'song_id' = x ->> 'song_id'
                where coalesce((x ->> 'join_prev')::boolean, false) <> coalesce((y ->> 'join_prev')::boolean, false)) then ch := ch || '메들리 변경'::text; end if;
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
                  where coalesce((x ->> 'diff_key')::boolean, false) <> coalesce((y ->> 'diff_key')::boolean, false)) then ch := ch || '음원과 키 다름 표시'::text;
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

-- 악보만 고치기 (022) — 메들리 첫 곡에 새로 저장한 악보는 메들리 악보로
create or replace function public.save_setlist_sheets(p_service uuid, p_data jsonb, p_base int)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  sl public.setlists; it jsonb; i int := 0; sid bigint; ns jsonb; cur bigint[]; got bigint[]; who text; row_ public.setlist_items; hd boolean;
begin
  if not public.can_edit_sheets(p_service) then raise exception '이 예배의 악보를 고칠 수 있는 사람이 아니에요. (그 예배 밴드 · 인도자 · 리더십)'; end if;
  select * into sl from public.setlists where service_id = p_service for update;
  if sl.id is null or sl.status <> 'published' then raise exception '올라온 콘티가 있어야 악보를 고칠 수 있어요.'; end if;
  if p_base is not null and sl.version <> p_base then
    raise exception using errcode = 'PT409', message = '다른 사람이 먼저 이 콘티를 고쳤어요. 새로 불러온 뒤 다시 고쳐 주세요.',
      detail = json_build_object('version', sl.version, 'by', (select name from public.members where id = sl.updated_by))::text;
  end if;
  cur := array(select song_id from public.setlist_items where setlist_id = sl.id order by ord);
  got := array(select (x ->> 'song_id')::bigint from jsonb_array_elements(coalesce(p_data -> 'items', '[]'::jsonb)) x);
  if cur <> got then raise exception '콘티 곡이 바뀌었어요. 새로 불러온 뒤 다시 고쳐 주세요.'; end if;

  for it in select * from jsonb_array_elements(p_data -> 'items') loop
    i := i + 1;
    select * into row_ from public.setlist_items where setlist_id = sl.id and ord = i;
    hd := not row_.join_prev and exists (select 1 from public.setlist_items n where n.setlist_id = sl.id and n.ord = i + 1 and n.join_prev);
    sid := nullif(it ->> 'sheet_id', '')::bigint;
    ns := it -> 'new_sheet';
    if ns is not null and jsonb_typeof(ns) = 'object' then
      if coalesce(ns ->> 'path', '') !~ ('^sheets/' || (it ->> 'song_id') || '/[0-9a-f-]{36}\.pdf$') then raise exception '악보 파일 경로가 올바르지 않아요.'; end if;
      insert into public.sheet_versions (song_id, kind, name, key, pages, path, size_bytes, thumb, created_by, setlist_id, medley_id)
      values ((it ->> 'song_id')::bigint, 'sheet', left(coalesce(nullif(trim(ns ->> 'name'), ''), '악보'), 60), row_.key,
              (ns ->> 'pages')::int, ns ->> 'path', nullif(ns ->> 'size', '')::int, ns ->> 'thumb', auth.uid(), sl.id, case when hd then row_.medley_id end)
      on conflict (path) do update set name = excluded.name
      returning id into sid;
    elsif sid is not null and not exists (select 1 from public.sheet_versions where id = sid and song_id = (it ->> 'song_id')::bigint) then
      raise exception '악보를 찾을 수 없어요 (%번째).', i;
    end if;
    update public.setlist_items set sheet_id = sid,
           page_from = nullif(it ->> 'page_from', '')::int, page_to = nullif(it ->> 'page_to', '')::int
     where setlist_id = sl.id and ord = i;
  end loop;

  who := (select name from public.members where id = auth.uid());
  update public.setlists set
    version = version + 1,
    notified_version = version + 1,
    pages = case when p_data ? 'pages' then nullif(p_data ->> 'pages', '')::int else pages end,
    updated_at = now(), updated_by = auth.uid(),
    sheet_changes = jsonb_build_object('at', now(), 'by', who)
  where id = sl.id
  returning * into sl;
  return json_build_object('id', sl.id, 'version', sl.version, 'sheet_changes', sl.sheet_changes);
end;
$$;
revoke all on function public.save_setlist_sheets(uuid, jsonb, int) from public, anon;
grant execute on function public.save_setlist_sheets(uuid, jsonb, int) to authenticated;

-- 새 악보로 저장 (024) — 메들리 악보면 새 악보도 메들리 악보
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
  insert into public.sheet_versions (song_id, medley_id, kind, name, key, pages, path, size_bytes, thumb, created_by, setlist_id, base_id)
  values (v.song_id, v.medley_id, 'sheet', nm, coalesce(it.key, v.key), v.pages, split_part(v.path, '#', 1) || '#' || substr(md5(random()::text || clock_timestamp()::text), 1, 10),
          v.size_bytes, v.thumb, auth.uid(), sl.id, coalesce(v.base_id, v.id))
  returning id into nid;
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
revoke all on function public.sheet_fork(uuid, int, text) from public, anon;
grant execute on function public.sheet_fork(uuid, int, text) to authenticated;


-- ---------------------------------------------------------------------
-- 4. 콘티 읽기 (024) + 음원과 키 다름 · 이어서 · 메들리
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
              'key', i.key, 'diff_key', i.diff_key, 'medley', i.medley, 'join_prev', i.join_prev, 'medley_id', i.medley_id, 'medley_title', md.title,
              'refs', i.refs, 'duration_sec', i.duration_sec, 'duration_src', i.duration_src,
              'memo', i.memo, 'sheet_id', i.sheet_id, 'sheet_name', sv.name, 'sheet_pages', sv.pages, 'sheet_path', sv.path, 'sheet_kind', sv.kind,
              'sheet_base', coalesce(sv.base_id, sv.id),
              'page_from', i.page_from, 'page_to', i.page_to) order by i.ord)
            from public.setlist_items i join public.songs so on so.id = i.song_id left join public.sheet_versions sv on sv.id = i.sheet_id
            left join public.medleys md on md.id = i.medley_id
            where i.setlist_id = sl.id), '[]'::json))
        from public.setlists sl where sl.service_id = s.id and (sl.status = 'published' or public.can_edit_conti(s.id)))
    ) from public.services s left join public.ministries mi on mi.id = s.ministry_id
    where s.id = p_service and (s.status = 'published' or public.is_admin())
  ) end;
$$;
revoke all on function public.conti_one(uuid) from public, anon;
grant execute on function public.conti_one(uuid) to authenticated;

-- 기록 (024) + 메들리 목록 · 콘티 곡 7번째 = 메들리 id · 8번째 = 앞 곡에 이어서
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
    'lineup', coalesce((select json_agg(json_build_array(l.service_date, l.position, l.slot, l.person_name, l.is_guest) order by l.service_date, l.position, l.slot) from public.lineup_history l), '[]'::json),
    'applied', coalesce((select json_agg(json_build_array(x.id, s.service_date, x.title, x.key, x.images, x.norm, s.id, mi.name) order by s.service_date, x.ord, x.id)
      from public.applied_songs x join public.services s on s.id = x.service_id left join public.ministries mi on mi.id = s.ministry_id
     where s.status = 'published' and s.service_date <= (now() at time zone 'Asia/Seoul')::date), '[]'::json)
  ) end;
$$;
revoke all on function public.history_bundle() from public, anon;
grant execute on function public.history_bundle() to authenticated;


-- ---------------------------------------------------------------------
-- 5. 카톡 복사에 붙일 섬김이 팀 링크 (콘티를 고칠 수 있는 사람)
-- ---------------------------------------------------------------------
create or replace function public.conti_share_links(p_service uuid)
returns json language sql stable security definer set search_path = public as $$
  select case when not public.can_edit_conti(p_service) then null else coalesce((
    select json_agg(json_build_object('id', l.id, 'label', l.label, 'token', l.token) order by l.created_at)
      from public.share_links l where l.active), '[]'::json) end;
$$;
revoke all on function public.conti_share_links(uuid) from public, anon;
grant execute on function public.conti_share_links(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 6. '+'가 들어간 곡 → 메들리로 정리 (리더십)
-- ---------------------------------------------------------------------
-- 후보: 이름에 '+'가 있는 곡 · 나눈 곡 이름마다 같은 이름의 곡 · 부른 횟수 · 악보 수
create or replace function public.plus_song_candidates()
returns json language sql stable security definer set search_path = public as $$
  select case when not public.is_admin() then null else coalesce((
    select json_agg(json_build_object('id', s.id, 'title', s.title, 'main_key', s.main_key, 'team_sec', s.team_sec,
        'used', (select count(*) from public.setlist_items i join public.setlists sl on sl.id = i.setlist_id where i.song_id = s.id and sl.status = 'published'),
        'last', (select max(sl.service_date) from public.setlist_items i join public.setlists sl on sl.id = i.setlist_id where i.song_id = s.id and sl.status = 'published'),
        'sheets', (select count(*) from public.sheet_versions v where v.song_id = s.id),
        'refs', (select count(*) from public.song_refs r where r.song_id = s.id),
        'medley', (select json_build_object('id', m.id, 'title', m.title) from public.medleys m where m.norm = s.norm),
        'parts', (select json_agg(json_build_object('title', p.t,
                     'match', (select json_build_object('id', x.id, 'title', x.title) from public.songs x where x.norm = lower(regexp_replace(p.t, '\s', '', 'g')) and x.id <> s.id)) order by p.o)
                    from (select trim(v) t, o from unnest(regexp_split_to_array(s.title, '\s*\+\s*')) with ordinality u(v, o) where trim(v) <> '') p)
      ) order by s.title)
      from public.songs s where s.title ~ '\+'), '[]'::json) end;
$$;

-- 정리하기: p_parts = [{ song_id } | { title }] (순서대로 2~8곡)
--   메들리를 만들고(이름 = 원래 곡 이름), 원래 곡의 악보 · 레퍼런스 · 곡 시간을 메들리로,
--   부른 기록은 나눈 곡마다 한 줄씩(한 번호 아래 이어서), 키가 'G-A'처럼 곡 수만큼 나뉘면 곡마다 나눠 넣어요. 원래 곡은 지워요
create or replace function public.convert_plus_song(p_song bigint, p_parts jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.songs; m public.medleys; p jsonb; k int := 0; ids bigint[] := '{}'; pid bigint; t text; n int;
  slid bigint; rows_ jsonb; r jsonb; o int; keys_ text[]; nrow int := 0; moved int := 0; r_yt text; r_st int; r_en int;
begin
  if not public.is_admin() then raise exception '리더십만 할 수 있어요.'; end if;
  select * into s from public.songs where id = p_song for update;
  if s.id is null then raise exception '곡을 찾을 수 없어요.'; end if;
  n := jsonb_array_length(coalesce(p_parts, '[]'::jsonb));
  if n < 2 or n > 8 then raise exception '나눈 곡을 2~8곡 골라 주세요.'; end if;
  for p in select * from jsonb_array_elements(p_parts) loop
    k := k + 1;
    pid := nullif(p ->> 'song_id', '')::bigint;
    if pid is null then
      t := trim(coalesce(p ->> 'title', ''));
      if t = '' or length(t) > 80 then raise exception '%번째 곡 이름을 확인해 주세요.', k; end if;
      select id into pid from public.songs where norm = lower(regexp_replace(t, '\s', '', 'g')) and id <> s.id;
      if pid is null then insert into public.songs (title) values (t) returning id into pid; end if;
    elsif pid = s.id or not exists (select 1 from public.songs where id = pid) then raise exception '%번째 곡을 다시 골라 주세요.', k;
    end if;
    ids := ids || pid;
  end loop;
  if exists (select 1 from public.medleys where norm = s.norm) then raise exception '같은 이름의 메들리가 이미 있어요.'; end if;

  select r2.youtube_id, r2.start_sec, r2.end_sec into r_yt, r_st, r_en from public.song_refs r2 where r2.song_id = s.id order by r2.updated_at desc limit 1;
  insert into public.medleys (title, norm, team_sec, memo, from_song, ref_yt, ref_start, ref_end)
  values (s.title, '', s.team_sec, s.memo, s.title, r_yt, r_st, r_en) returning * into m;
  -- 키: 곡 라이브러리의 '주로 부른 키'가 곡 수만큼 나뉘면 곡마다
  keys_ := case when s.main_key is not null and cardinality(string_to_array(s.main_key, '-')) = n then string_to_array(s.main_key, '-') end;
  for k in 1..n loop
    insert into public.medley_songs (medley_id, ord, song_id, key) values (m.id, k, ids[k], case when keys_ is not null then keys_[k] else s.main_key end);
  end loop;
  -- 레퍼런스가 없으면 콘티 기록에서 가장 최근 것
  if m.ref_yt is null then
    update public.medleys set ref_yt = x.yt, ref_start = x.st from (
      select i.refs -> 0 ->> 0 yt, coalesce((i.refs -> 0 ->> 1)::int, 0) st from public.setlist_items i join public.setlists sl on sl.id = i.setlist_id
       where i.song_id = s.id and jsonb_array_length(i.refs) > 0 and coalesce(i.refs -> 0 ->> 0, '') ~ '^[A-Za-z0-9_-]{11}$' order by sl.service_date desc limit 1) x
     where id = m.id;
  end if;

  -- 악보 · 내 메모 → 메들리 (파일은 그대로, 첫 곡 아래)
  update public.sheet_versions set song_id = ids[1], medley_id = m.id where song_id = s.id;
  update public.sheet_notes set song_id = ids[1] where song_id = s.id;
  delete from public.song_refs where song_id = s.id;

  -- 부른 기록: 콘티마다 곡을 나눠 다시 넣음
  for slid in select distinct setlist_id from public.setlist_items where song_id = s.id loop
    select jsonb_agg(to_jsonb(i) order by i.ord) into rows_ from public.setlist_items i where i.setlist_id = slid;
    if jsonb_array_length(rows_) + (n - 1) * (select count(*) from jsonb_array_elements(rows_) x where (x ->> 'song_id')::bigint = s.id) > 30 then
      raise exception '곡이 30곡을 넘는 콘티가 있어서 나눌 수 없어요.';
    end if;
    delete from public.setlist_items where setlist_id = slid;
    o := 0;
    for r in select * from jsonb_array_elements(rows_) loop
      if (r ->> 'song_id')::bigint <> s.id then
        o := o + 1;
        insert into public.setlist_items (setlist_id, ord, song_id, key, medley, refs, sheet_id, page_from, page_to, duration_sec, duration_src, memo, bpm, meter, diff_key, join_prev, medley_id) select setlist_id, ord, song_id, key, medley, refs, sheet_id, page_from, page_to, duration_sec, duration_src, memo, bpm, meter, diff_key, join_prev, medley_id from jsonb_populate_record(null::public.setlist_items, r || jsonb_build_object('ord', o));
      else
        keys_ := case when r ->> 'key' is not null and cardinality(string_to_array(r ->> 'key', '-')) = n then string_to_array(r ->> 'key', '-') end;
        for k in 1..n loop
          o := o + 1;
          insert into public.setlist_items (setlist_id, ord, song_id, key, medley, refs, sheet_id, page_from, page_to, duration_sec, duration_src, memo, bpm, meter, diff_key, join_prev, medley_id) select setlist_id, ord, song_id, key, medley, refs, sheet_id, page_from, page_to, duration_sec, duration_src, memo, bpm, meter, diff_key, join_prev, medley_id from jsonb_populate_record(null::public.setlist_items, r || jsonb_build_object(
            'ord', o, 'song_id', ids[k], 'medley', true, 'join_prev', k > 1, 'medley_id', m.id,
            'key', case when keys_ is not null then keys_[k] else r ->> 'key' end,
            'refs', case when k = 1 then r -> 'refs' else '[]'::jsonb end,
            'duration_sec', case when k = 1 then r -> 'duration_sec' else '0'::jsonb end,
            'duration_src', case when k = 1 then r -> 'duration_src' else '"medley"'::jsonb end,
            'sheet_id', case when k = 1 then r -> 'sheet_id' else 'null'::jsonb end,
            'page_from', case when k = 1 then r -> 'page_from' else 'null'::jsonb end,
            'page_to', case when k = 1 then r -> 'page_to' else 'null'::jsonb end,
            'memo', case when k = 1 then r -> 'memo' else 'null'::jsonb end,
            'bpm', case when k = 1 then r -> 'bpm' else 'null'::jsonb end,
            'meter', case when k = 1 then r -> 'meter' else 'null'::jsonb end));
          nrow := nrow + 1;
        end loop;
        moved := moved + 1;
      end if;
    end loop;
  end loop;
  -- 메들리 안의 곡 (다른 메들리에 이 곡이 들어 있으면)
  if exists (select 1 from public.medley_songs where song_id = s.id) then raise exception '이 곡이 다른 메들리에 들어 있어요. 그 메들리에서 먼저 빼 주세요.'; end if;
  delete from public.songs where id = s.id;
  return json_build_object('medley_id', m.id, 'title', m.title, 'songs', to_jsonb(ids), 'contis', moved, 'rows', nrow);
end;
$$;
revoke all on function public.plus_song_candidates() from public, anon;
revoke all on function public.convert_plus_song(bigint, jsonb) from public, anon;
grant execute on function public.plus_song_candidates() to authenticated;
grant execute on function public.convert_plus_song(bigint, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- 7. 백업 · 복원 기록 · 결과 확인 표 · 비밀값 메모
-- ---------------------------------------------------------------------
alter table public.backup_log
  add column if not exists kind      text not null default 'backup' check (kind in ('backup', 'restore')),
  add column if not exists counts    jsonb,
  add column if not exists files     int,
  add column if not exists artifact  text check (length(artifact) <= 120),
  add column if not exists source_at timestamptz;

-- 표 별 개수 (백업 직후 · 복원 직후 같은 함수로 셈 → 결과 확인 표)
create or replace function public.backup_counts()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare j jsonb; so bigint;
begin
  j := jsonb_build_object(
    'members', (select count(*) from public.members),
    'auth_users', (select count(*) from auth.users),
    'applications', (select count(*) from public.applications),
    'services', (select count(*) from public.services),
    'assignments', (select count(*) from public.assignments),
    'attendance', (select count(*) from public.attendance),
    'setlists', (select count(*) from public.setlists),
    'setlist_items', (select count(*) from public.setlist_items),
    'songs', (select count(*) from public.songs),
    'sheet_versions', (select count(*) from public.sheet_versions),
    'prayers', (select count(*) from public.prayers),
    'notifications', (select count(*) from public.notifications));
  if to_regclass('storage.objects') is not null then
    execute $q$select count(*) from storage.objects where bucket_id = 'sheets'$q$ into so;
    j := j || jsonb_build_object('storage_objects', so);
  end if;
  return j;
end;
$$;
revoke all on function public.backup_counts() from public, anon, authenticated;
grant execute on function public.backup_counts() to service_role;

create or replace function public.backup_counts_admin()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then public.backup_counts() end;
$$;
revoke all on function public.backup_counts_admin() from public, anon;
grant execute on function public.backup_counts_admin() to authenticated;
-- 리더십: 마지막 백업 · 복원 (설정 › 백업)
create or replace function public.backup_status()
returns json language sql stable security definer set search_path = public as $$
  select case when not public.is_admin() then null else json_build_object(
    'backups', coalesce((select json_agg(row_to_json(b) order by b.at desc) from (select id, at, ok, size_bytes, note, counts, files, artifact from public.backup_log where kind = 'backup' order by at desc limit 8) b), '[]'::json),
    'restores', coalesce((select json_agg(row_to_json(b) order by b.at desc) from (select id, at, ok, note, counts, files, artifact, source_at from public.backup_log where kind = 'restore' order by at desc limit 4) b), '[]'::json),
    'now', public.backup_counts_admin()) end;
$$;

revoke all on function public.backup_status() from public, anon;
grant execute on function public.backup_status() to authenticated;

-- 이관 · 복원에 필요한 비밀값 메모 (VAPID · CRON_SECRET · 백업 암호 등) — 최상위 리더십만 보고 고쳐요
--   주의: 백업 암호(BACKUP_PASSPHRASE)는 여기에만 두면 안 돼요 — DB가 날아가면 같이 없어져요. 팀 계정 메모 등 바깥에도
create table if not exists public.ops_secrets (
  name        text primary key check (name ~ '^[A-Z][A-Z0-9_]{1,40}$'),
  value       text not null check (length(value) <= 4000),
  note        text check (length(note) <= 200),
  updated_by  uuid references public.members(id) on delete set null,
  updated_at  timestamptz not null default now()
);
alter table public.ops_secrets enable row level security;
-- 정책 없음 = 화면에서 직접 읽기 · 쓰기 불가 (아래 함수로만, 최상위 리더십만)

create or replace function public.ops_secret_list()
returns json language sql stable security definer set search_path = public as $$
  select case when not public.is_owner() then null else coalesce((
    select json_agg(json_build_object('name', name, 'value', value, 'note', note, 'updated_at', updated_at,
                                      'by', (select m.name from public.members m where m.id = updated_by)) order by name)
      from public.ops_secrets), '[]'::json) end;
$$;
create or replace function public.ops_secret_set(p_name text, p_value text, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception '최상위 리더십만 할 수 있어요.'; end if;
  if nullif(trim(coalesce(p_value, '')), '') is null then
    delete from public.ops_secrets where name = p_name;
    return json_build_object('deleted', true);
  end if;
  insert into public.ops_secrets (name, value, note, updated_by) values (upper(trim(p_name)), trim(p_value), nullif(trim(p_note), ''), auth.uid())
  on conflict (name) do update set value = excluded.value, note = excluded.note, updated_by = excluded.updated_by, updated_at = now();
  return json_build_object('ok', true);
end;
$$;
revoke all on function public.ops_secret_list() from public, anon;
revoke all on function public.ops_secret_set(text, text, text) from public, anon;
grant execute on function public.ops_secret_list() to authenticated;
grant execute on function public.ops_secret_set(text, text, text) to authenticated;

-- 확인: select count(*) from medleys;  select count(*) from songs where title ~ '\+';
--       select conname from pg_constraint where conname = 'setlist_items_meter_check';
