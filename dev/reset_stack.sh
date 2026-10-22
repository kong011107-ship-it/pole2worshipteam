#!/bin/bash
B=/home/claude/base; W=/home/claude/wp; P=/home/claude/pgrst
pg_ctlcluster 16 main start 2>/dev/null; for i in 1 2 3 4 5; do pg_isready -q && break; sleep 1; done
MIGS="schema migration_002 migration_003 migration_004 migration_005 migration_006 migration_007 migration_008 migration_009 migration_010 ${EXTRA_MIGS-migration_011 migration_012 migration_013 migration_014 migration_015 migration_016 migration_017 migration_018 migration_019 migration_020 migration_020_history migration_021 migration_022 migration_023 migration_024}"
for f in $MIGS; do if [ -f $W/supabase/$f.sql ]; then cp $W/supabase/$f.sql /tmp/$f.sql; else cp $B/supabase/$f.sql /tmp/$f.sql; fi; done
cp $B/dev/shim.sql $B/dev/stack_extra.sql /tmp/; chmod 644 /tmp/*.sql
[ -n "$(pidof postgrest)" ] && kill $(pidof postgrest)
sleep 1
ARGS=""; for f in $MIGS; do [ $f = schema ] && ARGS="$ARGS -f /tmp/schema.sql -c 'create publication supabase_realtime'" || ARGS="$ARGS -f /tmp/$f.sql"; done
su postgres -c "dropdb --force --if-exists wt; createdb wt && psql -v ON_ERROR_STOP=1 -q -d wt -f /tmp/shim.sql $ARGS -f /tmp/stack_extra.sql" 2>&1 | grep -v -e wal_level -e HINT -e NOTICE
su postgres -c "psql -q -d wt -c \"alter role postgres password 'pgpw'\""
su postgres -c "psql -q -d wt" <<'SQL'
insert into auth.users(email, password) values ('admin@x.com','adminpass'),('lead2@x.com','lead2pass');
insert into members(id,name,email,role,main_position,must_change_password)
  select id, case email when 'admin@x.com' then '공준혁' else '김하람' end, email, 'admin', 'leader', false from auth.users;
update members set is_owner = true where email = 'admin@x.com' and exists (select 1 from information_schema.columns where table_name='members' and column_name='is_owner');
SQL
find /home/claude/pgrst/storage -type f -delete 2>/dev/null
cd $P
(nohup ./postgrest pgrst.conf > pgrst.log 2>&1 &)
fuser -k 8790/tcp >/dev/null 2>&1; sleep 1; rm -f push.log; (nohup node server.mjs > server.log 2>&1 &)
sleep 2
pidof postgrest >/dev/null && curl -s -o /dev/null -w "stack %{http_code}\n" localhost:8790/rest/v1/positions
