-- 029 실행용 최소 스텁 (실제 스키마 모양만 흉내)
do $$ begin create role anon nologin; create role authenticated nologin; exception when others then null; end $$;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.uid', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon; grant usage on schema public to authenticated;
create table positions (code text primary key, name text, sort_order int);
insert into positions values ('leader','인도자',1),('singer','싱어',2),('key_main','메인건반',3),('e_guitar','일렉',5),('bass','베이스',6),('drum','드럼',7);
create table members (id uuid primary key, name text, role text default 'member', main_position text references positions(code), is_active boolean default true);
create table member_extra_positions (member_id uuid references members(id), position_code text references positions(code), primary key (member_id, position_code));
create table services (id uuid primary key default gen_random_uuid(), service_date date);
create table songs (id bigint primary key, title text);
create table medleys (id bigint primary key);
create table setlists (id bigint generated always as identity primary key, service_id uuid unique references services(id), status text, leaders text, sheet_changes jsonb);
create table sheet_versions (id bigint generated always as identity primary key, song_id bigint, medley_id bigint, kind text, name text, key text, pages int, path text, size_bytes int, thumb text, created_by uuid, setlist_id bigint, created_at timestamptz default now());
create table setlist_items (setlist_id bigint, sheet_id bigint);
create table sheet_notes (member_id uuid, key text, page int, constraint sheet_notes_key_check check (key ~ '^s:'));
create table ink_extra (id bigint generated always as identity primary key, target text, ver text, service_id uuid, page int, cid text unique, stroke jsonb, author uuid, author_name text, valid_from date, deleted_from date, deleted_at timestamptz, deleted_by uuid,
  constraint ink_extra_target_check check (target ~ '^a:'));
create table applied_songs (id bigint primary key, service_id uuid, images text[]);
create table worship_proc (id bigint primary key, kind text, start_date date, removed boolean, images text[], path text, pages int);
create table backup_songs (id bigint primary key, book_id bigint, code text, hidden boolean, pages int, images text[]);
create table backup_books (id bigint primary key, active boolean);
create table service_extras (id bigint primary key, service_id uuid, images text[], pages int);
create function is_admin() returns boolean language sql stable security definer set search_path=public as $$ select exists (select 1 from members where id = auth.uid() and role='admin' and is_active) $$;
create function is_member() returns boolean language sql stable security definer set search_path=public as $$ select exists (select 1 from members where id = auth.uid() and is_active) $$;
-- 콘티 권한: 시험용으로 표에서
create table perm (service_id uuid, member_id uuid, conti boolean, sheets boolean);
create function can_edit_conti(p uuid) returns boolean language sql stable security definer set search_path=public as $$ select is_admin() or exists (select 1 from perm where service_id=p and member_id=auth.uid() and conti) $$;
create function can_edit_sheets(p uuid) returns boolean language sql stable security definer set search_path=public as $$ select can_edit_conti(p) or exists (select 1 from perm where service_id=p and member_id=auth.uid() and sheets) $$;
create function can_upload_sheet() returns boolean language sql stable as $$ select true $$;
create function can_lead_backup() returns boolean language sql stable as $$ select false $$;
create function backup_ctx_service() returns uuid language sql stable as $$ select null::uuid $$;
