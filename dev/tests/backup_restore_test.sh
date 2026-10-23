#!/usr/bin/env bash
# v26: scripts/backup.sh → scripts/restore.sh 로컬 확인 (가짜 Storage 서버 · 두 번째 DB wt2)
#  미리: dev/reset_stack.sh + /api/demo seed. 악보 파일 두 개를 가짜로 만들어 storage.objects에 적어 둠
set -euo pipefail
SP=${SP:-/tmp/bk-test}; rm -rf "$SP"; mkdir -p "$SP/dst"
BIN=/usr/lib/postgresql/16/bin; W=/home/claude/wp
mkdir -p /home/claude/pgrst/storage/sheets/sheets/162
cp /home/claude/tests/fx/conti5.pdf /home/claude/pgrst/storage/sheets/sheets/162/11111111-1111-4111-8111-111111111111.pdf
cp /home/claude/tests/fx/ap1.jpg /home/claude/pgrst/storage/sheets/sheets/162/22222222-2222-4222-8222-222222222222.jpg
su postgres -c "psql -q -d wt" <<'SQL'
create schema if not exists storage; create table if not exists storage.objects(bucket_id text, name text); delete from storage.objects;
insert into storage.objects values ('sheets','sheets/162/11111111-1111-4111-8111-111111111111.pdf'),('sheets','sheets/162/22222222-2222-4222-8222-222222222222.jpg');
SQL
cat > "$SP/mock.py" <<'PY'
import http.server, os, sys
SRC="/home/claude/pgrst/storage/sheets"; DST=sys.argv[2]
class H(http.server.BaseHTTPRequestHandler):
    def _p(self): return self.path.split("/storage/v1/object/sheets/",1)[1]
    def do_GET(self):
        if self.headers.get("Authorization")!="Bearer SKEY": self.send_response(403); self.end_headers(); return
        f=os.path.join(SRC,self._p())
        if not os.path.exists(f): self.send_response(404); self.end_headers(); return
        b=open(f,"rb").read(); self.send_response(200); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        n=int(self.headers["Content-Length"]); b=self.rfile.read(n); f=os.path.join(DST,self._p()); os.makedirs(os.path.dirname(f),exist_ok=True); open(f,"wb").write(b)
        self.send_response(200); self.end_headers(); self.wfile.write(b'{"Key":"x"}')
    def log_message(self,*a): pass
http.server.HTTPServer(("127.0.0.1",int(sys.argv[1])),H).serve_forever()
PY
python3 "$SP/mock.py" 8799 "$SP/dst" & MP=$!; trap 'kill $MP' EXIT; sleep 1
cd "$SP"
DB_URL=postgres://postgres:pgpw@127.0.0.1/wt PASS=testpass SB_URL=http://127.0.0.1:8799 SB_KEY=SKEY BIN=$BIN DEST=$SP bash $W/scripts/backup.sh | tail -4
cp $W/dev/shim.sql /tmp/shim.sql; chmod 644 /tmp/shim.sql
su postgres -c "dropdb --force --if-exists wt2; createdb wt2 && psql -q -d wt2 -f /tmp/shim.sql -c 'create publication supabase_realtime' -c 'alter table auth.users add column if not exists password text' -c 'create schema if not exists storage; create table storage.buckets(id text primary key, name text, public bool, file_size_limit bigint, allowed_mime_types text[]); create table storage.objects(bucket_id text, name text);'" > /dev/null 2>&1
A=$(ls $SP/pole2-backup-*.tar.gpg | head -1)
echo "-- 같은 DB로 복원 → 멈춰야 함"; ! ARCHIVE=$A PASS=testpass T_DB=postgres://postgres:pgpw@127.0.0.1/wt CUR_DB=postgres://postgres:pgpw@127.0.0.1/wt BIN=$BIN REPO_DIR=$W bash $W/scripts/restore.sh 2>&1 | tail -1
echo "-- 팀원이 있는 DB → 멈춰야 함"; ! ARCHIVE=$A PASS=testpass T_DB=postgres://postgres:pgpw@127.0.0.1/wt CUR_DB=postgres://postgres.zzz:x@h/postgres BIN=$BIN REPO_DIR=$W bash $W/scripts/restore.sh 2>&1 | tail -1
echo "-- 틀린 암호 → 멈춰야 함"; ! ARCHIVE=$A PASS=wrong T_DB=postgres://postgres:pgpw@127.0.0.1/wt2 CUR_DB=postgres://postgres:pgpw@127.0.0.1/wt BIN=$BIN REPO_DIR=$W bash $W/scripts/restore.sh > /dev/null 2>&1
echo "-- 새 DB로 복원"
ARCHIVE=$A PASS=testpass T_DB=postgres://postgres:pgpw@127.0.0.1/wt2 CUR_DB=postgres://postgres:pgpw@127.0.0.1/wt T_URL=http://127.0.0.1:8799 T_KEY=SKEY BIN=$BIN REPO_DIR=$W GITHUB_STEP_SUMMARY=$SP/summary.md bash $W/scripts/restore.sh 2>&1 | grep -v NOTICE | tail -3
cat $SP/summary.md
test "$(find $SP/dst -type f | wc -l)" = 2 && echo "파일 2개 복원 OK"
su postgres -c "psql -At -d wt2 -c \"select has_function_privilege('authenticated','public.reset_team_data()','execute')::text || '|' || (select ok from backup_log where kind='restore' order by id desc limit 1)::text\"" | grep -qx "false|true" && echo "권한 · 복원 기록 OK"
su postgres -c "psql -q -d wt -c 'drop schema storage cascade'" 2>/dev/null || true
