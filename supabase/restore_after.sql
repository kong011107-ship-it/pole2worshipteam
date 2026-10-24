-- =====================================================================
--  복원 뒤 한 번 (scripts/restore.sh가 자동으로 실행해요)
--  DB 백업에 들어가지 않는 것: Storage 'sheets' 버킷과 권한 규칙 · 실시간(Realtime) 등록
--  여러 번 실행해도 괜찮아요.
-- =====================================================================
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') and exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('sheets', 'sheets', false, 31457280, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = false, file_size_limit = 31457280, allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    execute 'drop policy if exists sheets_read on storage.objects';
    execute 'drop policy if exists sheets_insert on storage.objects';
    execute 'drop policy if exists sheets_delete on storage.objects';
    execute $p$create policy sheets_read on storage.objects for select to authenticated using (bucket_id = 'sheets' and public.is_member())$p$;
    execute $p$create policy sheets_insert on storage.objects for insert to authenticated with check (bucket_id = 'sheets' and public.can_upload_object(name))$p$;
    execute $p$create policy sheets_delete on storage.objects for delete to authenticated using (bucket_id = 'sheets' and public.is_admin())$p$;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'backup_live') then
    execute 'alter publication supabase_realtime add table public.backup_live';
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'applications') then
    execute 'alter publication supabase_realtime add table public.applications';
  end if;
  -- 027: 메트로놈 함께 맞추기
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and to_regclass('public.metro_live') is not null
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'metro_live') then
    execute 'alter publication supabase_realtime add table public.metro_live';
  end if;
end $$;
-- 확인: select id, public from storage.buckets;  select tablename from pg_publication_tables where pubname = 'supabase_realtime';
