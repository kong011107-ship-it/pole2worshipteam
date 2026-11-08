-- 031 백업찬양 고치기 · 지우기 시험용 최소 스텁 (실제 스키마 일부)
create role authenticated; create role anon;
create schema if not exists auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.uid', true), '')::uuid $$;
create table members (id uuid primary key, name text, role text);
create function is_member() returns boolean language sql stable as $$ select exists (select 1 from members where id = auth.uid()) $$;
create function is_admin() returns boolean language sql stable as $$ select exists (select 1 from members where id = auth.uid() and role = 'admin') $$;
create function can_lead_backup() returns boolean language sql stable as $$ select is_admin() or auth.uid() = '00000000-0000-0000-0000-00000000000b' $$;
create function paths_ok(p_paths text[], p_prefix text) returns boolean language sql immutable as $$
  select coalesce(cardinality(p_paths), 0) between 1 and 12 and not exists (select 1 from unnest(p_paths) x where x !~ ('^' || p_prefix || '[0-9a-f-]{36}\.(jpg|png|webp|pdf)$')) $$;
create table backup_books (id bigint generated always as identity primary key, label text, active boolean not null default false);
create table backup_songs (id bigint generated always as identity primary key, book_id bigint references backup_books(id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9+]{1,6}$'), title text not null check (length(trim(title)) between 1 and 80), key text check (key ~ '^[a-g]$'),
  topic smallint, page smallint, pages smallint not null default 1 check (pages between 1 and 12), images text[], hidden boolean not null default false, created_by uuid,
  check ((book_id is not null and page is not null) or (book_id is null and images is not null and paths_ok(images, 'backup/'))));
create unique index backup_songs_custom_code_uniq on backup_songs (code) where book_id is null and not hidden;
create table backup_live (id int primary key default 1, active boolean not null default false, candidates bigint[] not null default '{}', pub_candidates bigint[] not null default '{}',
  now_ref text, next_ref text, seq int not null default 0, updated_at timestamptz);
insert into backup_live (id) values (1);
create function backup_state_live() returns json language sql stable as $$ select row_to_json(l) from backup_live l where id = 1 $$;
create table ink_extra (id bigint generated always as identity primary key, target text not null, ver text, page smallint not null, cid text unique);
create table backup_bpm (code text primary key, bpm smallint not null, meter text not null default '4/4');
grant usage on schema public, auth to authenticated;
grant select on all tables in schema public to authenticated;
create table songs (id bigint primary key, title text);
create table setlist_items (id bigint generated always as identity primary key, song_id bigint references songs(id), duration_src text);
alter table setlist_items add constraint setlist_items_duration_src_check check (duration_src in ('manual', 'team', 'video', 'medley'));
