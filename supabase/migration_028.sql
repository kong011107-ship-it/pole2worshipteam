-- =====================================================================
--  028 — v29: 예배 순서 · 특별순서 · 등단송 켜기/끄기 · 진행곡 지우기 · 모든 순서에 BPM · 섬김이 링크 실시간
--  · services.flow        : 예배마다 순서 (비우면 기본: 본 콘티 → 축복송 → 등단송 → 적용찬양 → 백업찬양 → 성찬 1 · 2 → 봉헌송 → 축도송)
--      항목 이름 conti · blessing · entrance · applied · backup · communion · communion2 · offering · benediction · x:<특별순서 id>
--      set_flow(예배, 순서) — 그 예배 콘티를 고칠 수 있는 사람 (인도자 · 밴드 마스터 · 리더십). 알림 없음
--      flow_at · flow_by : 마지막으로 바꾼 때 · 사람 (콘티를 올린 뒤에 바꾸면 화면에 '순서 바뀜')
--  · services.entrance_on : 등단송 쓰기 (비우면 사역 = 켬 · 주일 = 끔) — set_entrance(예배, 켬/끔)
--  · service_extras       : 특별순서 (예: 파송식) — 이름 · 메모 · 키 · 악보(PDF 또는 사진) · BPM. 예배마다
--      내 메모(sheet_notes key x:<id>) · 공유 필기(ink_extra target x:<id>) · RT · 카톡 복사에는 넣지 않아요
--      Storage: extra/<예배 id>/<uuid>.(pdf|jpg) — 그 예배 콘티를 고칠 수 있는 사람
--  · worship_proc.removed : 예배 진행곡 지우기 — 그날부터 그 종류는 없음 (지난 기록은 그대로)
--  · BPM · 박자를 모든 순서에: worship_proc · applied_songs · service_extras 에 bpm · meter,
--      backup_bpm(백업찬양 코드마다 · 새 판도 같은 코드면 이어서). set_item_bpm(예배, 대상, BPM, 박자)
--      적용찬양은 같은 이름(묶음)의 지난 BPM을 자동으로 채워요
--  · share_links.live_topic : 섬김이 링크 실시간 — backup_live가 바뀌면 링크마다 공개 Broadcast 채널로 지금 · 다음 곡을 보내요
--      (Supabase realtime.send · 없으면 건너뜀 → 화면은 예전처럼 몇 초마다 확인). 링크를 새로 바꾸면 채널도 바뀌어요
--  migration_027 다음에 SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 괜찮아요.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 예배 순서 · 등단송 쓰기
-- ---------------------------------------------------------------------
alter table public.services
  add column if not exists flow        text[],
  add column if not exists flow_at     timestamptz,
  add column if not exists flow_by     text check (length(flow_by) <= 30),
  add column if not exists entrance_on boolean;
comment on column public.services.flow is '예배 순서 (null = 기본). conti · blessing · entrance · applied · backup · communion · communion2 · offering · benediction · x:<특별순서 id>';
comment on column public.services.entrance_on is '등단송 쓰기 (null = 자동: 사역 켬 · 주일 끔)';

create or replace function public.flow_ok(p text[])
returns boolean
language sql
immutable
as $$
  select p is null or (cardinality(p) <= 40
    and not exists (select 1 from unnest(p) x where x !~ '^(conti|blessing|entrance|applied|backup|communion|communion2|offering|benediction|x:[0-9]{1,12})$')
    and (select count(distinct x) from unnest(p) x) = cardinality(p));
$$;
alter table public.services drop constraint if exists services_flow_check;
alter table public.services add constraint services_flow_check check (public.flow_ok(flow));

create or replace function public.has_entrance(p_service uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select coalesce(s.entrance_on, s.ministry_id is not null) from public.services s where s.id = p_service), false);
$$;

-- 순서 바꾸기 (빈 배열이나 null이면 기본으로)
create or replace function public.set_flow(p_service uuid, p_flow text[])
returns json
language plpgsql
security definer
set search_path = public
as $$
declare s public.services; f text[] := nullif(p_flow, '{}'); who text;
begin
  if not public.can_edit_conti(p_service) then raise exception '예배 순서는 그 예배 인도자 · 밴드 마스터 · 리더십만 바꿀 수 있어요.'; end if;
  select * into s from public.services where id = p_service for update;
  if s.id is null then raise exception '예배를 찾을 수 없어요.'; end if;
  if not public.flow_ok(f) then raise exception '순서를 읽지 못했어요. 새로고침해 주세요.'; end if;
  if exists (select 1 from unnest(coalesce(f, '{}')) x where x like 'x:%'
              and not exists (select 1 from public.service_extras e where e.id = substring(x from 3)::bigint and e.service_id = p_service)) then
    raise exception '이 예배에 없는 특별순서가 있어요. 새로고침해 주세요.';
  end if;
  who := left((select name from public.members where id = auth.uid()), 30);
  update public.services set flow = f, flow_at = now(), flow_by = who where id = p_service;
  return json_build_object('flow', f, 'flow_at', now(), 'flow_by', who);
end;
$$;

-- 등단송 쓰기 켬 · 끔 (자동과 같으면 비워 둠)
create or replace function public.set_entrance(p_service uuid, p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare s public.services;
begin
  if not public.can_edit_conti(p_service) then raise exception '등단송은 그 예배 인도자 · 밴드 마스터 · 리더십만 켜고 끌 수 있어요.'; end if;
  select * into s from public.services where id = p_service;
  if s.id is null then raise exception '예배를 찾을 수 없어요.'; end if;
  update public.services set entrance_on = case when p_on is null or p_on = (s.ministry_id is not null) then null else p_on end where id = p_service;
  return public.has_entrance(p_service);
end;
$$;


-- ---------------------------------------------------------------------
-- 2. 특별순서
-- ---------------------------------------------------------------------
create table if not exists public.service_extras (
  id          bigint generated always as identity primary key,
  service_id  uuid not null references public.services(id) on delete cascade,
  title       text not null check (length(trim(title)) between 1 and 60),
  memo        text check (length(memo) <= 300),
  key         text check (length(key) <= 12),
  path        text check (path ~ '^extra/[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$'),
  pages       smallint check (pages between 1 and 40),
  images      text[],
  bpm         smallint check (bpm between 20 and 320),
  meter       text check (meter in ('4/4', '3/4', '6/8', '1/4')),
  created_by  uuid references public.members(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (path is null or path like 'extra/' || service_id::text || '/%'),
  check (images is null or public.paths_ok(images, 'extra/' || service_id::text || '/')),
  check (path is null or images is null)
);
create index if not exists service_extras_svc_idx on public.service_extras (service_id, id);
alter table public.service_extras enable row level security;
drop policy if exists service_extras_read on public.service_extras;
drop policy if exists service_extras_write on public.service_extras;
create policy service_extras_read on public.service_extras for select
  using (public.is_member() and exists (select 1 from public.services s where s.id = service_id and (s.status = 'published' or public.is_admin())));
create policy service_extras_write on public.service_extras for all
  using (public.can_edit_conti(service_id))
  with check (public.can_edit_conti(service_id));
grant select, insert, update, delete on public.service_extras to authenticated;

create or replace function public.service_extras_touch()
returns trigger language plpgsql as $$
begin
  new.title := trim(new.title); new.updated_at := now();
  if new.bpm is null then new.meter := null; elsif new.meter is null then new.meter := '4/4'; end if;
  return new;
end;
$$;
drop trigger if exists service_extras_touch on public.service_extras;
create trigger service_extras_touch before insert or update on public.service_extras
  for each row execute function public.service_extras_touch();

-- 악보를 바꾸거나 지우면 그 특별순서 공유 필기도 지움 (027 ink_extra_cleanup + 특별순서)
create or replace function public.ink_extra_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'applied_songs' then
    if tg_op = 'DELETE' or new.images is distinct from old.images then
      delete from public.ink_extra where target = 'a:' || old.id;
    end if;
  elsif tg_table_name = 'worship_proc' then
    if tg_op = 'DELETE' or new.path is distinct from old.path or new.images is distinct from old.images then
      delete from public.ink_extra where target = 'p:' || old.id;
    end if;
  elsif tg_table_name = 'service_extras' then
    if tg_op = 'DELETE' or new.path is distinct from old.path or new.images is distinct from old.images then
      delete from public.ink_extra where target = 'x:' || old.id;
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists ink_extra_cleanup on public.service_extras;
create trigger ink_extra_cleanup after update or delete on public.service_extras
  for each row execute function public.ink_extra_cleanup();

-- 내 메모 · 공유 필기 대상에 특별순서(x:)
alter table public.sheet_notes drop constraint if exists sheet_notes_key_check;
alter table public.sheet_notes add constraint sheet_notes_key_check
  check (key ~ '^(s:[0-9]{1,12}|p:[0-9]{1,12}|a:[0-9]{1,12}|x:[0-9]{1,12}|b:[a-z0-9+]{1,8})$');
alter table public.ink_extra drop constraint if exists ink_extra_target_check;
alter table public.ink_extra add constraint ink_extra_target_check
  check (target ~ '^(a:[0-9]{1,12}|p:[0-9]{1,12}|x:[0-9]{1,12}|b:[a-z0-9+]{1,8})$');

-- Storage 올리기 권한 (022) + 특별순서 악보: extra/<예배 id>/
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
    else false end;
$$;
revoke all on function public.can_upload_object(text) from public, anon;
grant execute on function public.can_upload_object(text) to authenticated;


-- ---------------------------------------------------------------------
-- 3. 예배 진행곡: 지우기 · BPM
-- ---------------------------------------------------------------------
alter table public.worship_proc
  add column if not exists removed boolean not null default false,
  add column if not exists bpm     smallint check (bpm between 20 and 320),
  add column if not exists meter   text check (meter in ('4/4', '3/4', '6/8', '1/4'));
comment on column public.worship_proc.removed is '지움: 이 날짜(start_date)부터 이 종류는 없음 (지난 곡은 기록으로)';

-- 그날 쓰는 예배 진행곡 (023) — 지운 종류는 빼요 · BPM 함께. 등단송은 화면이 그 예배 '등단송 쓰기'를 보고 정해요
create or replace function public.proc_list(p_date date, p_communion boolean)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.is_member() then null else coalesce((
    select json_agg(json_build_object('id', w.id, 'kind', w.kind, 'title', w.title, 'key', w.key, 'path', w.path, 'pages', w.pages,
                                      'images', w.images, 'start_date', w.start_date, 'bpm', w.bpm, 'meter', w.meter)
                    order by array_position(array['blessing', 'communion', 'communion2', 'offering', 'benediction', 'entrance'], w.kind))
      from (select distinct on (kind) * from public.worship_proc where start_date <= coalesce(p_date, current_date)
             order by kind, start_date desc, id desc) w
     where not w.removed and (coalesce(p_communion, false) or w.kind not in ('communion', 'communion2'))), '[]'::json) end;
$$;
revoke all on function public.proc_list(date, boolean) from public, anon;
grant execute on function public.proc_list(date, boolean) to authenticated;


-- ---------------------------------------------------------------------
-- 4. 적용찬양 BPM (같은 이름이면 지난 BPM 자동) · 백업찬양 BPM (코드마다)
-- ---------------------------------------------------------------------
alter table public.applied_songs
  add column if not exists bpm   smallint check (bpm between 20 and 320),
  add column if not exists meter text check (meter in ('4/4', '3/4', '6/8', '1/4'));

create or replace function public.applied_bpm_fill()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  if new.bpm is null then
    select a.bpm, a.meter into r from public.applied_songs a
     where a.norm = lower(regexp_replace(new.title, '[\s\(\)\[\]·.,!?''"-]', '', 'g')) and a.bpm is not null
     order by a.updated_at desc, a.id desc limit 1;
    if r.bpm is not null then new.bpm := r.bpm; new.meter := coalesce(r.meter, '4/4'); end if;
  end if;
  return new;
end;
$$;
drop trigger if exists applied_bpm_fill on public.applied_songs;
create trigger applied_bpm_fill before insert on public.applied_songs
  for each row execute function public.applied_bpm_fill();

create table if not exists public.backup_bpm (
  code        text primary key check (code ~ '^[a-z0-9+]{1,6}$'),
  bpm         smallint not null check (bpm between 20 and 320),
  meter       text not null default '4/4' check (meter in ('4/4', '3/4', '6/8', '1/4')),
  updated_by  text check (length(updated_by) <= 30),
  updated_at  timestamptz not null default now()
);
alter table public.backup_bpm enable row level security;
drop policy if exists backup_bpm_read on public.backup_bpm;
create policy backup_bpm_read on public.backup_bpm for select using (public.is_member());
grant select on public.backup_bpm to authenticated;
-- 쓰기는 함수로만

-- BPM · 박자 바꾸기 (콘티 곡 밖) — 인도자 · 밴드 마스터 · 리더십 · 그 예배 밴드. 알림 없음
--   p_target: p:<예배 진행곡 id> · a:<적용찬양 id> · b:<백업찬양 코드> · x:<특별순서 id> · BPM을 비우면 지움
create or replace function public.set_item_bpm(p_service uuid, p_target text, p_bpm int, p_meter text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare t text := split_part(p_target, ':', 1); v text := split_part(p_target, ':', 2); mt text; n int := 0; who text;
begin
  if not public.can_edit_sheets(p_service) then raise exception 'BPM은 인도자 · 밴드 마스터 · 리더십 · 그 예배 밴드만 고칠 수 있어요.'; end if;
  if p_bpm is not null and (p_bpm < 20 or p_bpm > 320) then raise exception 'BPM은 20~320 사이로 적어 주세요.'; end if;
  if p_meter is not null and not public.meter_ok(p_meter) then raise exception '박자는 4/4 · 3/4 · 6/8 · 1/4 중에서 골라 주세요.'; end if;
  if p_target !~ '^(a:[0-9]{1,12}|p:[0-9]{1,12}|x:[0-9]{1,12}|b:[a-z0-9+]{1,6})$' then raise exception '고칠 곡을 찾을 수 없어요.'; end if;
  mt := case when p_bpm is null then null else coalesce(p_meter, '4/4') end;
  if t = 'p' then
    update public.worship_proc set bpm = p_bpm, meter = mt where id = v::bigint and not removed;
  elsif t = 'a' then
    update public.applied_songs set bpm = p_bpm, meter = mt where id = v::bigint and service_id = p_service;
  elsif t = 'x' then
    update public.service_extras set bpm = p_bpm, meter = mt where id = v::bigint and service_id = p_service;
  else
    if p_service is distinct from public.backup_ctx_service() then raise exception '이번 백업찬양 예배가 아니에요. 새로고침해 주세요.'; end if;
    who := left((select name from public.members where id = auth.uid()), 30);
    if p_bpm is null then delete from public.backup_bpm where code = v;
    else insert into public.backup_bpm (code, bpm, meter, updated_by) values (v, p_bpm, mt, who)
         on conflict (code) do update set bpm = excluded.bpm, meter = excluded.meter, updated_by = excluded.updated_by, updated_at = now();
    end if;
    return json_build_object('target', p_target, 'bpm', p_bpm, 'meter', mt);
  end if;
  get diagnostics n = row_count;
  if n = 0 then raise exception '곡을 찾을 수 없어요. 새로고침해 주세요.'; end if;
  return json_build_object('target', p_target, 'bpm', p_bpm, 'meter', mt);
end;
$$;
revoke all on function public.set_item_bpm(uuid, text, int, text) from public, anon;
grant execute on function public.set_item_bpm(uuid, text, int, text) to authenticated;


-- ---------------------------------------------------------------------
-- 5. 공유 필기 (027 ink_put) + 특별순서(x:)
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
begin
  if p_target !~ '^(a:[0-9]{1,12}|p:[0-9]{1,12}|x:[0-9]{1,12}|b:[a-z0-9+]{1,8})$' then raise exception '고칠 악보를 찾을 수 없어요.'; end if;
  if not public.can_edit_sheets(p_service) then raise exception '이 예배의 악보를 고칠 수 있는 사람이 아니에요. (인도자 · 밴드 마스터 · 리더십 · 그 예배 밴드)'; end if;
  select * into s from public.services where id = p_service;
  if s.id is null then raise exception '예배를 찾을 수 없어요.'; end if;
  if t = 'a' then
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


-- ---------------------------------------------------------------------
-- 6. 콘티 읽기 (027) + 예배 순서 · 등단송 쓰기 · 특별순서 · 적용찬양 BPM
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
      'entrance', public.has_entrance(s.id), 'entrance_set', s.entrance_on,
      'flow', s.flow, 'flow_at', s.flow_at, 'flow_by', s.flow_by,
      'can_edit', public.can_edit_conti(s.id), 'can_edit_sheets', public.can_edit_sheets(s.id),
      'can_applied', public.is_admin() or public.can_edit_conti(s.id),
      'can_metro', public.can_control_metro(s.id),
      'past', s.service_date < (now() at time zone 'Asia/Seoul')::date,
      'deadline', public.conti_deadline(s.id), 'target_sec', public.conti_target(s.id),
      'practice_cancelled', s.ministry_id is null and coalesce((select practice_cancelled from public.team_meetings where meeting_date = s.service_date - 1), false),
      'lineup', coalesce((select json_agg(json_build_object('pos', a.position_code, 'slot', a.slot, 'member_id', a.member_id,
          'name', coalesce(m.name, g.name, a.former_name), 'guest', a.is_guest, 'sl', a.is_singer_leader, 'bm', a.is_band_master)
          order by p.sort_order, a.slot)
        from public.assignments a join public.positions p on p.code = a.position_code
        left join public.members m on m.id = a.member_id left join public.guests g on g.id = a.guest_id
        where a.service_id = s.id), '[]'::json),
      'applied', coalesce((select json_agg(json_build_object('id', x.id, 'ord', x.ord, 'title', x.title, 'key', x.key, 'note', x.note, 'images', x.images, 'norm', x.norm,
          'bpm', x.bpm, 'meter', x.meter) order by x.ord, x.id)
        from public.applied_songs x where x.service_id = s.id), '[]'::json),
      'applied_meta', (select json_build_object('notified_at', am.notified_at, 'edited_at', am.edited_at, 'edited_by', am.edited_by)
        from public.applied_meta am where am.service_id = s.id),
      'extras', coalesce((select json_agg(json_build_object('id', x.id, 'title', x.title, 'memo', x.memo, 'key', x.key, 'path', x.path, 'pages', x.pages,
          'images', x.images, 'bpm', x.bpm, 'meter', x.meter, 'updated_at', x.updated_at) order by x.id)
        from public.service_extras x where x.service_id = s.id), '[]'::json),
      'proc', public.proc_list(s.service_date, public.has_communion(s.id)),
      'setlist', (select json_build_object('id', sl.id, 'status', sl.status, 'version', sl.version, 'published_at', sl.published_at,
          'updated_at', sl.updated_at, 'target_sec', sl.target_sec, 'deadline', sl.deadline, 'pages', sl.pages, 'changes', sl.changes,
          'sheet_changes', sl.sheet_changes,
          'leaders', sl.leaders, 'updated_by', (select name from public.members where id = sl.updated_by),
          'items', coalesce((select json_agg(json_build_object('ord', i.ord, 'song_id', i.song_id, 'title', so.title, 'main_key', so.main_key,
              'team_sec', so.team_sec, 'team_bpm', so.team_bpm, 'team_meter', so.team_meter, 'bpm', i.bpm, 'meter', i.meter,
              'key', i.key, 'diff_key', i.diff_key, 'medley', i.medley, 'join_prev', i.join_prev, 'medley_id', i.medley_id, 'medley_title', md.title,
              'medley_ref', case when md.ref_yt is not null then json_build_array(md.ref_yt, coalesce(md.ref_start, 0)) end,
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


-- ---------------------------------------------------------------------
-- 7. 섬김이 링크 실시간 (공개 Broadcast · 링크마다 짐작할 수 없는 채널 이름)
-- ---------------------------------------------------------------------
alter table public.share_links
  add column if not exists live_topic text not null default replace(gen_random_uuid()::text, '-', '');
create unique index if not exists share_links_topic_uniq on public.share_links (live_topic);

-- 링크를 새로 바꾸면(토큰) 채널도 새로
create or replace function public.share_links_topic()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.token is distinct from old.token then new.live_topic := replace(gen_random_uuid()::text, '-', ''); end if;
  return new;
end;
$$;
drop trigger if exists share_links_topic on public.share_links;
create trigger share_links_topic before update on public.share_links
  for each row execute function public.share_links_topic();

-- 보낼 내용: 지금 · 다음 곡 · 팀원에게 보이는 후보 (기도회 중 = 지금 후보 · 확정 = 확정 후보 · 아니면 없음) · seq
create or replace function public.share_live_payload(l public.backup_live)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'active', l.active, 'now', case when l.active then l.now_ref end, 'next', case when l.active then l.next_ref end, 'seq', l.seq,
    'candidates', to_jsonb(case when l.active then l.candidates
      when l.confirmed_at is not null and exists (select 1 from public.services s where s.id = l.service_id and s.service_date >= public.kst_today() - 1) then l.pub_candidates
      else '{}'::bigint[] end),
    'service_id', l.service_id);
$$;

create or replace function public.share_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
declare k record; body jsonb;
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then return null; end if;
  if tg_table_name = 'backup_live' then
    if new.seq is not distinct from old.seq then return null; end if;
    body := public.share_live_payload(new);
    for k in select live_topic from public.share_links where active loop
      begin
        perform realtime.send(body, 'live', 'share-' || k.live_topic, false);
      exception when others then null;
      end;
    end loop;
  else
    -- 콘티 · 순서 · 적용찬양 · 특별순서가 바뀜 → 다시 불러오라고만
    for k in select live_topic from public.share_links where active loop
      begin
        perform realtime.send(jsonb_build_object('at', now()), 'reload', 'share-' || k.live_topic, false);
      exception when others then null;
      end;
    end loop;
  end if;
  return null;
end;
$$;
drop trigger if exists share_broadcast on public.backup_live;
create trigger share_broadcast after update on public.backup_live
  for each row execute function public.share_broadcast();
drop trigger if exists share_broadcast on public.setlists;
create trigger share_broadcast after update of version, status, sheet_changes on public.setlists
  for each row when (new.status = 'published') execute function public.share_broadcast();
drop trigger if exists share_broadcast on public.service_extras;
create trigger share_broadcast after insert or update or delete on public.service_extras
  for each statement execute function public.share_broadcast();
drop trigger if exists share_broadcast on public.applied_songs;
create trigger share_broadcast after insert or update or delete on public.applied_songs
  for each statement execute function public.share_broadcast();
drop trigger if exists share_broadcast_flow on public.services;
create trigger share_broadcast_flow after update of flow, entrance_on on public.services
  for each statement execute function public.share_broadcast();

-- 확인: select count(*) from service_extras;  select code, bpm from backup_bpm;
--       select label, live_topic from share_links;
--       select id, flow, entrance_on from services where service_date >= current_date order by service_date limit 5;
