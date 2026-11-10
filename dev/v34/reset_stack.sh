#!/bin/bash
# local stack: PG16 + PostgREST + dev server (site = $SITE or /home/claude/work)
W=${SITE:-/home/claude/work}; P=/home/claude/pgrst
pg_ctlcluster 16 main start 2>/dev/null; for i in 1 2 3 4 5; do pg_isready -q && break; sleep 1; done
MIGS="schema migration_002 migration_003 migration_004 migration_005 migration_006 migration_007 migration_008 migration_009 migration_010 migration_011 migration_012 migration_013 migration_014 migration_015 migration_016 migration_017 migration_018 migration_019 migration_020 migration_020_history migration_021 migration_022 migration_023 migration_024 migration_025 migration_026 migration_027 migration_028 migration_029 migration_030 migration_031 migration_032 migration_033 ${EXTRA}"
mkdir -p /tmp/sql; rm -f /tmp/sql/*.sql; M2=""; for f in $MIGS; do [ -f $W/supabase/$f.sql ] && { cp $W/supabase/$f.sql /tmp/sql/; M2="$M2 $f"; }; done; MIGS=$M2; cp /home/claude/shim.sql $W/dev/stack_extra.sql /tmp/sql/; chmod -R a+r /tmp/sql
pkill postgrest; sleep 1
ARGS=""; for f in $MIGS; do [ $f = schema ] && ARGS="$ARGS -f /tmp/sql/schema.sql -c 'create publication supabase_realtime'" || ARGS="$ARGS -f /tmp/sql/$f.sql"; done
su postgres -c "dropdb --force --if-exists wt; createdb wt && psql -v ON_ERROR_STOP=1 -q -d wt -f /tmp/sql/shim.sql $ARGS -f /tmp/sql/stack_extra.sql" 2>&1 | grep -v -e wal_level -e HINT -e NOTICE | tail -5
su postgres -c "psql -q -d wt -c \"alter role postgres password 'pgpw'\""
su postgres -c "psql -q -d wt" <<'SQL'
insert into auth.users(email, password) values ('admin@x.com','adminpass'),('lead2@x.com','lead2pass');
insert into members(id,name,email,role,main_position,must_change_password)
  select id, case email when 'admin@x.com' then '공준혁' else '김하람' end, email, 'admin', 'leader', false from auth.users;
update members set is_owner = true where email = 'admin@x.com';
SQL
find $P/storage -type f -delete 2>/dev/null
cd $P; (nohup ./postgrest pgrst.conf > pgrst.log 2>&1 &)
fuser -k 8790/tcp >/dev/null 2>&1; sleep 1; (SITE=$W nohup node server.mjs > server.log 2>&1 &)
sleep 2; curl -s -o /dev/null -w "stack %{http_code}\n" localhost:8790/rest/v1/positions
