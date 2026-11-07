-- 030 실행용 최소 스텁
do $$ begin create role anon nologin; create role authenticated nologin; exception when others then null; end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.uid', true), '')::uuid $$;
grant usage on schema auth to authenticated; grant usage on schema public to authenticated;
create table members (id uuid primary key, name text, role text default 'member', is_active boolean default true);
create function is_admin() returns boolean language sql stable security definer set search_path=public as $$ select exists (select 1 from members where id = auth.uid() and role='admin' and is_active) $$;
create table setlists (id bigint generated always as identity primary key, status text, version int default 1);
create table sheet_versions (id bigint generated always as identity primary key, song_id bigint, kind text, name text, path text, created_by uuid,
  base_id bigint references sheet_versions(id) on delete set null);
create table setlist_items (setlist_id bigint references setlists(id), ord int, song_id bigint, sheet_id bigint references sheet_versions(id) on delete set null, page_from int, join_prev boolean default false);
