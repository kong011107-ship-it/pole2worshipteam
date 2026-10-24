-- =====================================================================
--  027 — v28: 악보 고치기 넓히기 · 적용찬양 · 백업찬양 알림 · 메트로놈 함께 맞추기
--  · ink_extra      : 콘티 곡 밖의 공유 필기 (적용찬양 · 예배 진행곡(성찬 찬양 포함) · 백업찬양)
--      target  a:<적용찬양 id>   그 예배 사진에만 (다음 주로 넘어가지 않음)
--              p:<예배 진행곡 id> 리더십이 그 곡을 바꿀 때까지 쌓임
--              b:<백업찬양 코드>   주마다 쌓임 · ver = 악보집 id (사진 곡은 c<id>) — 새 판이면 이어 쓰지 않고 '이전 판 필기 보기'
--      고칠 수 있는 사람 · 지우기 규칙은 콘티 공유 필기(024)와 같아요: 그 예배 인도자 · 밴드 마스터 · 리더십 · 그 예배 밴드
--      남의 획 지우기는 인도자 · 밴드 마스터 · 리더십만. 그 예배 날짜부터 보이고, 지운 것도 그 날짜부터 (지난 예배는 그대로)
--  · ink_put(svc, target, ver, ops) : 획 올리기 · 지우기 · 되살리기 (알림 없음 · 적용찬양 · 예배 진행곡은 그 예배 콘티에 '악보 바뀜')
--  · applied_meta   : 적용찬양 알림 — 처음 올릴 때만 그 예배 라인업에 알림, 그 뒤 고치면 '수정됨' 표시 (10분 안에 이어 올린 건 빼요)
--  · backup_live    : 확정 · 수정 — 확정한 후보만 팀원에게 보여요 (기도회가 시작되면 지금 후보 그대로)
--      service_id(어느 예배의 백업찬양인지) · pub_candidates(팀원에게 보이는 후보) · confirmed_at/by · pub_ver/notified_ver · pub_changes
--      backup_confirm() : 확정 / 수정 (알림은 /api/conti backup-notify가 pub_ver마다 한 번)
--      기도회를 끝내면 확정도 풀려요 (후보는 남음)
--  · metro_live     : 메트로놈 함께 맞추기 — 예배마다 한 줄 (켜짐 · BPM · 박자 · 첫 박 시각 t0(서버 시계 ms))
--      켜고 끄고 BPM 따라가기는 그 예배 인도자 · 밴드 마스터 · 드럼만 (metro_set). 소리는 사람마다 따로 켜요
--      metro_now() : 서버 시계 (기기마다 시계 차이를 맞추는 데 써요)
--  · 알림 종류 3개 : applied_up(적용찬양 올라옴) · backup_pick(백업찬양 확정) · backup_edit(백업찬양 수정) — 알림함 종류는 conti
--  migration_026 다음에 SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 괜찮아요.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. 한국 날짜
-- ---------------------------------------------------------------------
create or replace function public.kst_today()
returns date language sql stable as $$ select (now() at time zone 'Asia/Seoul')::date; $$;


-- ---------------------------------------------------------------------
-- 1. 공유 필기 (콘티 곡 밖)
-- ---------------------------------------------------------------------
create table if not exists public.ink_extra (
  id            bigint generated always as identity primary key,
  target        text not null check (target ~ '^(a:[0-9]{1,12}|p:[0-9]{1,12}|b:[a-z0-9+]{1,8})$'),
  ver           text check (ver ~ '^(c?[0-9]{1,12})$'),
  service_id    uuid references public.services(id) on delete set null,   -- 쓴 예배 (기록용)
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
create index if not exists ink_extra_target_idx on public.ink_extra (target, ver, page);
alter table public.ink_extra enable row level security;
drop policy if exists ink_extra_read on public.ink_extra;
create policy ink_extra_read on public.ink_extra for select using (public.is_member());
grant select on public.ink_extra to authenticated;
-- 쓰기는 함수로만

-- 적용찬양을 지우거나 사진을 바꾸면 그 곡 필기도 지움 · 예배 진행곡을 지우면 함께
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
  end if;
  return null;
end;
$$;
drop trigger if exists ink_extra_cleanup on public.applied_songs;
create trigger ink_extra_cleanup after update or delete on public.applied_songs
  for each row execute function public.ink_extra_cleanup();
drop trigger if exists ink_extra_cleanup on public.worship_proc;
create trigger ink_extra_cleanup after update or delete on public.worship_proc
  for each row execute function public.ink_extra_cleanup();


-- ---------------------------------------------------------------------
-- 2. 백업찬양: 어느 예배의 백업찬양인지 · 확정 · 수정
-- ---------------------------------------------------------------------
alter table public.backup_live
  add column if not exists service_id     uuid references public.services(id) on delete set null,
  add column if not exists pub_candidates bigint[] not null default '{}',
  add column if not exists confirmed_at   timestamptz,
  add column if not exists confirmed_by   uuid references public.members(id) on delete set null,
  add column if not exists pub_ver        int not null default 0,
  add column if not exists notified_ver   int not null default 0,
  add column if not exists pub_changes    jsonb;

-- 인도자가 확정 · 시작할 때 고르는 예배: 내가 인도하는 가장 가까운 예배(어제 ~ 7일 뒤) > 다가오는 주일
create or replace function public.backup_service_pick()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.id from public.assignments a join public.services s on s.id = a.service_id
      where a.member_id = auth.uid() and a.position_code = 'leader'
        and s.service_date between public.kst_today() - 1 and public.kst_today() + 7
      order by s.service_date, s.start_time nulls first, s.sort_order limit 1),
    (select s.id from public.services s where s.ministry_id is null and s.service_date >= public.kst_today()
      order by s.service_date limit 1));
$$;

-- 지금 백업찬양의 예배: 정해 둔 예배(어제까지 유효) > 다가오는 주일
create or replace function public.backup_ctx_service()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select l.service_id from public.backup_live l join public.services s on s.id = l.service_id
      where l.id = 1 and s.service_date >= public.kst_today() - 1),
    (select s.id from public.services s where s.ministry_id is null and s.service_date >= public.kst_today()
      order by s.service_date limit 1));
$$;

-- 확정이 지금도 유효한지 (그 예배 다음 날까지)
create or replace function public.backup_confirmed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.backup_live l join public.services s on s.id = l.service_id
                  where l.id = 1 and l.confirmed_at is not null and s.service_date >= public.kst_today() - 1);
$$;

-- 지금 상태 — 팀원에게는 확정한 후보만 (기도회 중이면 지금 후보). 인도자는 고르는 중인 후보(candidates)와 확정본(pub_candidates)을 함께
create or replace function public.backup_state_live()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.is_member() then null else (
    select json_build_object('active', l.active, 'leader_id', l.leader_id, 'leader', m.name,
                             'candidates', case when z.lead or l.active then l.candidates when z.conf then l.pub_candidates else '{}'::bigint[] end,
                             'pub_candidates', case when z.lead then (case when z.conf then l.pub_candidates else '{}'::bigint[] end) end,
                             'confirmed', z.conf, 'confirmed_at', case when z.conf then l.confirmed_at end,
                             'confirmed_by', case when z.conf then (select name from public.members where id = l.confirmed_by) end,
                             'pub_ver', l.pub_ver,
                             'now', l.now_ref, 'next', l.next_ref, 'seq', l.seq, 'started_at', l.started_at, 'updated_at', l.updated_at,
                             'can_lead', z.lead,
                             'service_id', z.sid, 'service_date', (select service_date from public.services where id = z.sid),
                             'service_name', (select case when s.ministry_id is null then to_char(s.service_date, 'FMMM/FMDD') || ' 주일'
                                                          else coalesce(mi.name, '사역') || coalesce(' ' || s.label, '') end
                                                from public.services s left join public.ministries mi on mi.id = s.ministry_id where s.id = z.sid),
                             'can_ink', z.sid is not null and public.can_edit_sheets(z.sid),
                             'can_ink_all', z.sid is not null and public.can_edit_conti(z.sid))
      from public.backup_live l
      left join public.members m on m.id = l.leader_id
      cross join lateral (select public.can_lead_backup() as lead, public.backup_ctx_service() as sid, public.backup_confirmed() as conf) z
     where l.id = 1) end;
$$;

-- 진행 상태 바꾸기 (022) + 시작할 때 예배 정하기 · 끝내면 확정 풀기
create or replace function public.backup_update(p jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare L public.backup_live; c bigint[];
begin
  if not public.can_lead_backup() then raise exception '백업찬양은 이번 주 인도자 · 리더십만 진행할 수 있어요.'; end if;
  select * into L from public.backup_live where id = 1 for update;
  if L.id is null then insert into public.backup_live (id) values (1) returning * into L; end if;
  if p ? 'candidates' then
    c := array(select (x)::bigint from jsonb_array_elements_text(coalesce(p -> 'candidates', '[]'::jsonb)) x);
    if cardinality(c) > 16 then raise exception '후보는 16곡까지예요.'; end if;
    if exists (select 1 from unnest(c) x where not exists (select 1 from public.backup_songs s where s.id = x and not s.hidden)) then
      raise exception '곡을 찾을 수 없어요. 새로고침해 주세요.';
    end if;
    L.candidates := c;
  end if;
  if p ? 'now' then L.now_ref := nullif(p ->> 'now', ''); end if;
  if p ? 'next' then L.next_ref := nullif(p ->> 'next', ''); end if;
  if p ? 'active' then
    if (p ->> 'active')::boolean and not L.active then
      L.started_at := now();
      if not public.backup_confirmed() then L.service_id := public.backup_service_pick(); end if;
    end if;
    L.active := (p ->> 'active')::boolean;
    if not L.active then
      L.now_ref := null; L.next_ref := null;
      L.confirmed_at := null; L.confirmed_by := null; L.pub_candidates := '{}'; L.pub_changes := null; L.service_id := null;
    end if;
  end if;
  update public.backup_live set active = L.active, leader_id = auth.uid(), candidates = L.candidates, now_ref = L.now_ref, next_ref = L.next_ref,
         seq = seq + 1, started_at = L.started_at, updated_at = now(),
         service_id = L.service_id, confirmed_at = L.confirmed_at, confirmed_by = L.confirmed_by, pub_candidates = L.pub_candidates, pub_changes = L.pub_changes
   where id = 1 returning * into L;
  return public.backup_state_live();
end;
$$;

-- 확정 · 수정: 지금 고른 후보를 팀원에게 보이게 하고 pub_ver를 올림 (알림은 서버가 pub_ver마다 한 번)
create or replace function public.backup_confirm()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare L public.backup_live; conf boolean; sid uuid; added text[] := '{}'; removed text[] := '{}'; reorder boolean := false; kind text;
begin
  if not public.can_lead_backup() then raise exception '백업찬양은 이번 주 인도자 · 리더십만 확정할 수 있어요.'; end if;
  select * into L from public.backup_live where id = 1 for update;
  if L.id is null or cardinality(L.candidates) = 0 then raise exception '후보를 먼저 골라 주세요.'; end if;
  conf := public.backup_confirmed();
  sid := case when conf then L.service_id else public.backup_service_pick() end;
  if sid is null then raise exception '다가오는 예배를 찾을 수 없어요.'; end if;
  if conf then
    if L.candidates = L.pub_candidates then raise exception '확정한 뒤로 바뀐 후보가 없어요.'; end if;
    added := array(select s.code || ' ' || s.title from unnest(L.candidates) with ordinality x(id, n) join public.backup_songs s on s.id = x.id
                    where not (x.id = any (L.pub_candidates)) order by x.n);
    removed := array(select s.code || ' ' || s.title from unnest(L.pub_candidates) with ordinality x(id, n) join public.backup_songs s on s.id = x.id
                      where not (x.id = any (L.candidates)) order by x.n);
    reorder := cardinality(added) = 0 and cardinality(removed) = 0;
    kind := 'edit';
  else
    kind := 'confirm';
  end if;
  update public.backup_live
     set service_id = sid, pub_candidates = L.candidates, confirmed_at = now(), confirmed_by = auth.uid(), pub_ver = pub_ver + 1,
         pub_changes = jsonb_build_object('kind', kind, 'added', to_jsonb(added), 'removed', to_jsonb(removed), 'reorder', reorder),
         seq = seq + 1, updated_at = now()
   where id = 1;
  return public.backup_state_live();
end;
$$;

-- 악보집 새 판: 진행 후보와 확정 후보 모두 같은 코드의 새 곡으로 (022 + pub_candidates)
create or replace function public.backup_book_save(p_label text, p_path text, p_pages int, p_size int, p_topics jsonb, p_songs jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare bid bigint; s jsonb; n int := 0;
begin
  if not public.is_admin() then raise exception '악보집은 리더십만 올릴 수 있어요.'; end if;
  update public.backup_books set active = false where active;
  insert into public.backup_books (label, path, pages, size_bytes, topics, active, created_by)
  values (trim(p_label), p_path, p_pages, p_size, coalesce(p_topics, '{"1":"결단/선포","2":"믿음/신뢰","3":"위로/소망","4":"임재/경배","5":"간구/중보"}'::jsonb), true, auth.uid())
  returning id into bid;
  for s in select * from jsonb_array_elements(coalesce(p_songs, '[]'::jsonb)) loop
    insert into public.backup_songs (book_id, code, title, key, topic, page, pages, created_by)
    values (bid, lower(trim(s ->> 'code')), trim(s ->> 'title'), nullif(lower(trim(coalesce(s ->> 'key', ''))), ''), nullif(s ->> 'topic', '')::int,
            (s ->> 'page')::int, greatest(1, coalesce(nullif(s ->> 'pages', '')::int, 1)), auth.uid())
    on conflict (book_id, code) where book_id is not null do update set title = excluded.title, page = excluded.page;
    n := n + 1;
  end loop;
  update public.backup_live l set
    candidates = array(select coalesce((select ns.id from public.backup_songs os join public.backup_songs ns on ns.code = os.code and ns.book_id = bid where os.id = x and os.book_id is not null), x)
                         from unnest(l.candidates) x),
    pub_candidates = array(select coalesce((select ns.id from public.backup_songs os join public.backup_songs ns on ns.code = os.code and ns.book_id = bid where os.id = x and os.book_id is not null), x)
                             from unnest(l.pub_candidates) x),
    seq = seq + 1 where id = 1;
  return json_build_object('id', bid, 'songs', n);
end;
$$;

revoke all on function public.backup_service_pick() from public, anon;
revoke all on function public.backup_ctx_service() from public, anon;
revoke all on function public.backup_confirmed() from public, anon;
revoke all on function public.backup_confirm() from public, anon;
grant execute on function public.backup_service_pick() to authenticated;
grant execute on function public.backup_ctx_service() to authenticated;
grant execute on function public.backup_confirmed() to authenticated;
grant execute on function public.backup_confirm() to authenticated;


-- ---------------------------------------------------------------------
-- 3. 공유 필기 올리기 · 지우기 (적용찬양 · 예배 진행곡 · 백업찬양)
--    p_ops = { add: [{ cid, page, stroke }], del: [cid], undel: [cid] }
--    p_ver : 백업찬양만 — 지금 악보집 id 또는 c<사진 곡 id>
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
  n_add int := 0; n_del int := 0; n_skip int := 0; ap public.applied_songs; w public.worship_proc; bs public.backup_songs;
begin
  if p_target !~ '^(a:[0-9]{1,12}|p:[0-9]{1,12}|b:[a-z0-9+]{1,8})$' then raise exception '고칠 악보를 찾을 수 없어요.'; end if;
  if not public.can_edit_sheets(p_service) then raise exception '이 예배의 악보를 고칠 수 있는 사람이 아니에요. (인도자 · 밴드 마스터 · 리더십 · 그 예배 밴드)'; end if;
  select * into s from public.services where id = p_service;
  if s.id is null then raise exception '예배를 찾을 수 없어요.'; end if;
  if t = 'a' then
    select * into ap from public.applied_songs where id = v::bigint;
    if ap.id is null or ap.service_id <> p_service then raise exception '이 예배의 적용찬양이 아니에요. 새로고침해 주세요.'; end if;
  elsif t = 'p' then
    select * into w from public.worship_proc where id = v::bigint;
    if w.id is null or w.id <> (select x.id from public.worship_proc x where x.kind = w.kind and x.start_date <= s.service_date order by x.start_date desc, x.id desc limit 1) then
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

  -- 적용찬양 · 예배 진행곡: 그 예배 콘티에 '악보 바뀜' (알림 없음)
  if n_add + n_del > 0 and t in ('a', 'p') then
    update public.setlists set sheet_changes = jsonb_build_object('at', now(), 'by', who)
     where service_id = p_service and status = 'published';
  end if;
  return json_build_object('added', n_add, 'deleted', n_del, 'skipped', n_skip);
end;
$$;
revoke all on function public.ink_put(uuid, text, text, jsonb) from public, anon;
grant execute on function public.ink_put(uuid, text, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- 4. 적용찬양 알림 · 수정됨
-- ---------------------------------------------------------------------
create table if not exists public.applied_meta (
  service_id   uuid primary key references public.services(id) on delete cascade,
  notified_at  timestamptz,
  edited_at    timestamptz,
  edited_by    text check (length(edited_by) <= 30)
);
alter table public.applied_meta enable row level security;
drop policy if exists applied_meta_read on public.applied_meta;
create policy applied_meta_read on public.applied_meta for select using (public.is_member());
grant select on public.applied_meta to authenticated;

-- 알림을 보낸 뒤 10분이 지나서 더하거나 · 빼거나 · 사진을 바꾸면 '수정됨' (순서만 바꾼 건 빼요)
create or replace function public.applied_meta_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare sid uuid := coalesce(new.service_id, old.service_id);
begin
  if tg_op = 'UPDATE' and new.images is not distinct from old.images and new.title is not distinct from old.title
     and new.key is not distinct from old.key and new.note is not distinct from old.note then return null; end if;
  update public.applied_meta set edited_at = now(), edited_by = left((select name from public.members where id = auth.uid()), 30)
   where service_id = sid and notified_at is not null and notified_at < now() - interval '10 minutes';
  return null;
end;
$$;
drop trigger if exists applied_meta_touch on public.applied_songs;
create trigger applied_meta_touch after insert or update or delete on public.applied_songs
  for each row execute function public.applied_meta_touch();


-- ---------------------------------------------------------------------
-- 5. 메트로놈 함께 맞추기
-- ---------------------------------------------------------------------
create table if not exists public.metro_live (
  service_id  uuid primary key references public.services(id) on delete cascade,
  on_         boolean not null default false,
  bpm         int check (bpm between 20 and 320),
  meter       text check (meter in ('4/4', '3/4', '6/8', '1/4')),
  t0          bigint,                       -- 첫 박 시각 (서버 시계, 1970년부터 ms)
  ord         int,
  title       text check (length(title) <= 80),
  by_id       uuid references public.members(id) on delete set null,
  by_name     text check (length(by_name) <= 30),
  seq         int not null default 0,
  updated_at  timestamptz not null default now()
);
alter table public.metro_live enable row level security;
drop policy if exists metro_live_read on public.metro_live;
create policy metro_live_read on public.metro_live for select using (public.is_member());
grant select on public.metro_live to authenticated;

create or replace function public.metro_now()
returns bigint
language sql
volatile
as $$ select (extract(epoch from clock_timestamp()) * 1000)::bigint; $$;

-- 켜고 끄고 BPM을 바꿀 수 있는 사람: 그 예배 인도자 · 밴드 마스터 · 드럼
create or replace function public.can_control_metro(p_service uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.assignments a
                  where a.service_id = p_service and a.member_id = auth.uid()
                    and (a.position_code in ('leader', 'drum') or a.is_band_master));
$$;

-- p = { on: true|false, bpm, meter, ord, title }
--   켤 때 · BPM이나 박자가 바뀔 때는 0.7초 뒤를 첫 박으로 (모든 기기가 같은 때 첫 박). BPM · 박자가 같으면 박을 이어감
create or replace function public.metro_set(p_service uuid, p jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare M public.metro_live; on_ boolean := coalesce((p ->> 'on')::boolean, true); b int := nullif(p ->> 'bpm', '')::int;
        mt text := coalesce(nullif(p ->> 'meter', ''), '4/4'); nowms bigint := public.metro_now(); keep boolean;
begin
  if not public.can_control_metro(p_service) then raise exception '메트로놈 함께 맞추기는 그 예배 인도자 · 밴드 마스터 · 드럼만 켜고 끌 수 있어요.'; end if;
  if on_ then
    if b is null or b < 20 or b > 320 then raise exception 'BPM이 있는 곡에서 켜 주세요.'; end if;
    if not public.meter_ok(mt) then raise exception '박자를 읽지 못했어요.'; end if;
  end if;
  select * into M from public.metro_live where service_id = p_service for update;
  keep := M.service_id is not null and M.on_ and on_ and M.bpm = b and M.meter = mt and M.updated_at > now() - interval '3 hours';
  insert into public.metro_live as x (service_id, on_, bpm, meter, t0, ord, title, by_id, by_name, seq, updated_at)
  values (p_service, on_, case when on_ then b else M.bpm end, case when on_ then mt else M.meter end,
          case when keep then M.t0 when on_ then nowms + 700 else M.t0 end,
          case when on_ then nullif(p ->> 'ord', '')::int else M.ord end, case when on_ then left(p ->> 'title', 80) else M.title end,
          auth.uid(), left((select name from public.members where id = auth.uid()), 30), 1, now())
  on conflict (service_id) do update set on_ = excluded.on_, bpm = excluded.bpm, meter = excluded.meter, t0 = excluded.t0, ord = excluded.ord,
     title = excluded.title, by_id = excluded.by_id, by_name = excluded.by_name, seq = x.seq + 1, updated_at = now()
  returning * into M;
  return json_build_object('on', M.on_, 'bpm', M.bpm, 'meter', M.meter, 't0', M.t0, 'ord', M.ord, 'title', M.title, 'by_id', M.by_id, 'by_name', M.by_name,
                           'seq', M.seq, 'updated_at', M.updated_at, 'now', public.metro_now());
end;
$$;
revoke all on function public.metro_now() from public, anon;
revoke all on function public.can_control_metro(uuid) from public, anon;
revoke all on function public.metro_set(uuid, jsonb) from public, anon;
grant execute on function public.metro_now() to authenticated;
grant execute on function public.can_control_metro(uuid) to authenticated;
grant execute on function public.metro_set(uuid, jsonb) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'metro_live') then
    execute 'alter publication supabase_realtime add table public.metro_live';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 6. 콘티 읽기 (025) + 적용찬양 수정됨 · 메트로놈 조작 권한
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
      'applied', coalesce((select json_agg(json_build_object('id', x.id, 'ord', x.ord, 'title', x.title, 'key', x.key, 'note', x.note, 'images', x.images, 'norm', x.norm) order by x.ord, x.id)
        from public.applied_songs x where x.service_id = s.id), '[]'::json),
      'applied_meta', (select json_build_object('notified_at', am.notified_at, 'edited_at', am.edited_at, 'edited_by', am.edited_by)
        from public.applied_meta am where am.service_id = s.id),
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


-- ---------------------------------------------------------------------
-- 7. 알림 종류
-- ---------------------------------------------------------------------
alter table public.notify_settings drop constraint if exists notify_settings_kind_check;
alter table public.notify_settings add constraint notify_settings_kind_check
  check (kind in ('open', 'minopen', 'poll', 'remind', 'lineup', 'practice', 'apply', 'trainee', 'notice',
                  'prayer_new', 'prayer_remind', 'prayer_urgent', 'birthday_soon', 'birthday_today',
                  'conti_up', 'conti_edit', 'conti_open', 'conti_remind',
                  'sat_vote', 'sat_decide', 'proc',
                  'applied_up', 'backup_pick', 'backup_edit'));

insert into public.notify_settings (kind, title, body, schedule) values
  ('applied_up',  '{예배} 적용찬양이 올라왔어요',      '{곡}', null),
  ('backup_pick', '{예배} 백업찬양 후보가 정해졌어요', '{곡}', null),
  ('backup_edit', '{예배} 백업찬양 후보가 바뀌었어요', '{바뀐 것}', null)
on conflict (kind) do nothing;


-- ---------------------------------------------------------------------
-- 8. 초기화(022)에 새 표 포함
-- ---------------------------------------------------------------------
create or replace function public.reset_team_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.forecast_heirs where true;
  delete from public.forecast_exits where true;

  delete from public.practice_votes where true;
  delete from public.poll_votes where true;
  delete from public.poll_options where true;
  delete from public.polls where true;

  delete from public.notification_inbox where true;
  delete from public.notifications where true;
  delete from public.notify_sent where true;

  delete from public.prayer_taps where true;
  delete from public.prayers where true;

  delete from public.setlists where source = 'platform';
  delete from public.sheet_versions where true;
  delete from public.ink_extra where true;
  update public.backup_live set active = false, candidates = '{}', now_ref = null, next_ref = null, leader_id = null, seq = seq + 1,
         service_id = null, pub_candidates = '{}', confirmed_at = null, confirmed_by = null, pub_changes = null where id = 1;

  delete from public.practice_attendance where true;
  delete from public.practice_answers where true;
  delete from public.ministry_poll where true;
  delete from public.ministry_availability where true;
  delete from public.ministry_practices where true;
  delete from public.ministry_targets where true;
  delete from public.assignments where true;
  delete from public.services where true;          -- 적용찬양 · 적용찬양 알림 · 메트로놈도 함께
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

  delete from public.audit_log where true;
  insert into public.audit_log (tbl, op, label) values ('reset', 'DELETE', '초기화');
end;
$$;
revoke all on function public.reset_team_data() from public, anon, authenticated;
grant execute on function public.reset_team_data() to service_role;

-- 확인: select kind from notify_settings where kind in ('applied_up', 'backup_pick', 'backup_edit');
--       select tablename from pg_publication_tables where pubname = 'supabase_realtime';
--       select count(*) from ink_extra;  select * from metro_live;
