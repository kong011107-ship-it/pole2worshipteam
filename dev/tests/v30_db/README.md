029 권한 확인 (실제 PostgreSQL · 간추린 스텁)
  createdb t && psql -d t -f stub.sql && psql -d t -f ../../../supabase/migration_029.sql && psql -d t -f perm.sql
