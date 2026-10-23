#!/usr/bin/env bash
# Pole2 찬양팀 — 백업 파일로 새 Supabase 프로젝트에 되살리기 (GitHub Actions 'DB 복원'이 불러요)
#  필요한 값: ARCHIVE(.tar.gpg 파일) · PASS(백업 암호) · T_DB(새 프로젝트 Session pooler 주소)
#            T_URL · T_KEY (새 프로젝트 주소 · service_role 키 — 악보 파일 올리기)
#  선택: CUR_DB(지금 쓰는 DB 주소 — 같은 프로젝트면 멈춤) · CRON_SECRET · SITE_URL (예약 알림 다시 등록)
#  순서: 확인(새 프로젝트인지 · 비어 있는지) → 풀기 → 로그인 계정 → 앱 데이터 → 권한 · 버킷 · 실시간 · 예약 알림 → 악보 파일 → 결과 확인 표
set -euo pipefail
: "${ARCHIVE:?ARCHIVE가 필요해요}" "${PASS:?PASS가 필요해요}" "${T_DB:?T_DB(새 프로젝트 DB 주소)가 필요해요}"
BIN=${BIN:-/usr/lib/postgresql/17/bin}
REPO_DIR=${REPO_DIR:-.}
SUMMARY=${GITHUB_STEP_SUMMARY:-/dev/stdout}
ref_of() { # postgresql://postgres.REF:pw@host/... 또는 ...@db.REF.supabase.co → REF
  local u="$1" r
  r=$(printf '%s' "$u" | sed -nE 's#^[a-z]+://postgres\.([a-z0-9]+):.*#\1#p')
  [ -z "$r" ] && r=$(printf '%s' "$u" | sed -nE 's#.*@db\.([a-z0-9]+)\.supabase\.co.*#\1#p')
  [ -z "$r" ] && r=$(printf '%s' "$u" | sed -nE 's#^[a-z]+://[^@]*@([^?]+).*#\1#p')
  printf '%s' "$r"
}
# 1) 지금 쓰는 DB에 덮어쓰지 않게
if [ -n "${CUR_DB:-}" ]; then
  A=$(ref_of "$T_DB"); B=$(ref_of "$CUR_DB")
  if [ -n "$A" ] && [ "$A" = "$B" ]; then echo "::error::복원할 곳이 지금 쓰는 프로젝트와 같아요 ($A). 새 Supabase 프로젝트를 만들어 RESTORE_DB_URL에 넣어 주세요."; exit 1; fi
fi
if [ -n "${T_URL:-}" ] && [ -n "${CUR_URL:-}" ] && [ "${T_URL%/}" = "${CUR_URL%/}" ]; then echo "::error::RESTORE_SUPABASE_URL이 지금 쓰는 프로젝트 주소와 같아요."; exit 1; fi
HAS=$("$BIN/psql" "$T_DB" -At -c "select case when to_regclass('public.members') is null then 0 else 1 end")
if [ "$HAS" = "1" ]; then
  N=$("$BIN/psql" "$T_DB" -At -c "select count(*) from public.members")
  if [ "$N" != "0" ]; then echo "::error::복원할 DB에 이미 팀원 $N명이 있어요. 비어 있는 새 프로젝트에만 복원해요."; exit 1; fi
  echo "::error::복원할 DB에 이미 앱 표가 있어요(비어 있음). 새 프로젝트를 만들어 주세요."; exit 1
fi
# 2) 풀기
W=$(mktemp -d)
gpg --batch --yes --pinentry-mode loopback --passphrase "$PASS" -d -o "$W/b.tar" "$ARCHIVE"
mkdir -p "$W/x"; tar -C "$W/x" -xf "$W/b.tar"
PUB=$(ls "$W"/x/public-*.dump | head -1); AUTH=$(ls "$W"/x/auth-*.dump | head -1)
echo "백업 파일: $(basename "$PUB") · $(basename "$AUTH")"
# 3) 로그인 계정 → 앱 데이터 (계정이 먼저 있어야 멤버가 들어가요)
"$BIN/pg_restore" -d "$T_DB" --data-only --no-owner "$AUTH"
set +e
"$BIN/pg_restore" -d "$T_DB" --no-owner "$PUB" 2> "$W/err.txt"
set -e
if grep -v -e 'schema "public" already exists' -e 'errors ignored on restore' -e '^pg_restore: while' -e '^pg_restore: from TOC' -e 'Command was' -e '^$' -e 'warning: errors ignored' "$W/err.txt" | grep -q 'error'; then
  echo "::warning::앱 데이터를 넣는 중 오류가 있었어요 (아래 결과 확인 표로 확인하세요)"; grep error "$W/err.txt" | head -20
fi
# 4) 권한 · 버킷 · 실시간 · 예약 알림
#   권한: 저장소의 migration 파일들에 적힌 revoke · grant를 순서대로 다시 (예전 백업이라 권한이 빠져 있어도 원래대로)
ls "$REPO_DIR"/supabase/schema.sql "$REPO_DIR"/supabase/migration_*.sql 2>/dev/null | sort | xargs cat | grep -iE '^\s*(revoke|grant)\s' > "$W/grants.sql" || true
"$BIN/psql" "$T_DB" -q -f "$W/grants.sql" > /dev/null 2>&1 || true
"$BIN/psql" "$T_DB" -v ON_ERROR_STOP=1 -q -f "$REPO_DIR/supabase/restore_after.sql"
if [ -n "${CRON_SECRET:-}" ] && [ -n "${SITE_URL:-}" ]; then
  sed -e "s#https://pole2worshipteam.vercel.app#${SITE_URL%/}#" -e "s#__CRON_SECRET__#${CRON_SECRET}#" "$REPO_DIR/supabase/cron_012.sql" > "$W/cron.sql"
  "$BIN/psql" "$T_DB" -v ON_ERROR_STOP=1 -q -f "$W/cron.sql" && echo "예약 알림을 다시 등록했어요 (${SITE_URL%/}/api/cron)"
else
  echo "::warning::CRON_SECRET · SITE_URL이 없어서 예약 알림은 등록하지 않았어요 — 사이트 주소가 정해지면 cron_012.sql을 직접 실행하세요"
fi
# 5) 악보 파일
UP=0; FAIL=0
if [ -d "$W/x/storage/sheets" ] && [ -n "${T_URL:-}" ] && [ -n "${T_KEY:-}" ]; then
  while IFS= read -r -d '' f; do
    name=${f#"$W/x/storage/sheets/"}
    case "$name" in *.pdf) ct=application/pdf;; *.jpg|*.jpeg) ct=image/jpeg;; *.png) ct=image/png;; *.webp) ct=image/webp;; *) ct=application/octet-stream;; esac
    if curl -fsS --retry 3 -X POST -H "Authorization: Bearer $T_KEY" -H "apikey: $T_KEY" -H "x-upsert: true" -H "Content-Type: $ct" --data-binary "@$f" "${T_URL%/}/storage/v1/object/sheets/$name" > /dev/null; then UP=$((UP + 1)); else FAIL=$((FAIL + 1)); echo "::warning::못 올림 $name"; fi
  done < <(find "$W/x/storage/sheets" -type f -print0)
  echo "악보 파일 $UP개 올림$([ "$FAIL" -gt 0 ] && echo " · 실패 $FAIL")"
elif [ ! -d "$W/x/storage/sheets" ] || [ -z "$(ls -A "$W/x/storage/sheets" 2>/dev/null)" ]; then
  echo "::warning::이 백업에는 악보 파일이 없어요 (v25까지의 백업 · 또는 Storage Secrets 없이 만든 백업)"
fi
# 6) 결과 확인 표
BK=$(cat "$W/x/counts.json" 2>/dev/null || echo '{}'); [ -z "$BK" ] && BK='{}'
NOW=$("$BIN/psql" "$T_DB" -At -c "select public.backup_counts()::text")
python3 - "$BK" "$NOW" "$UP" > "$W/table.md" <<'PY'
import json, sys
bk, now, up = json.loads(sys.argv[1] or "{}"), json.loads(sys.argv[2] or "{}"), int(sys.argv[3])
names = {"members": "팀원", "auth_users": "로그인 계정", "applications": "지원서", "services": "예배 일정", "assignments": "배치",
         "attendance": "출석", "setlists": "콘티", "setlist_items": "콘티 곡", "songs": "곡", "sheet_versions": "악보",
         "prayers": "기도제목", "notifications": "알림", "storage_objects": "악보 파일"}
if "storage_objects" in bk: now["storage_objects"] = max(now.get("storage_objects", 0), up)
ok = True
print("| 항목 | 백업 | 복원 | |\n|---|---:|---:|---|")
for k, label in names.items():
    a, b = bk.get(k), now.get(k)
    if a is None and b is None: continue
    same = a is None or a == b
    ok = ok and same
    print(f"| {label} | {'—' if a is None else a} | {'—' if b is None else b} | {'✅' if same else '⚠️ 다름'} |")
print("\n" + ("**모두 같아요.**" if ok else "**다른 줄이 있어요 — 위 오류 기록을 확인하세요.**"))
PY
cat "$W/table.md" >> "$SUMMARY"
OK=$(python3 -c "import json,sys; b=json.loads(sys.argv[1] or '{}'); n=json.loads(sys.argv[2]); print(int(all(b[k]==n.get(k) for k in b if k!='storage_objects')))" "$BK" "$NOW")
"$BIN/psql" "$T_DB" -q -v ok="$OK" -v bk="$BK" -v now="$NOW" -v up="$UP" -v art="${ARTIFACT_NAME:-$(basename "$ARCHIVE")}" -v src="${SOURCE_AT:-}" <<'SQL'
insert into public.backup_log (kind, ok, note, counts, files, artifact, source_at)
values ('restore', :'ok' = '1', '복원', jsonb_build_object('backup', :'bk'::jsonb, 'restored', :'now'::jsonb), :'up'::int, :'art', nullif(:'src', '')::timestamptz);
SQL
rm -rf "$W"
[ "$OK" = "1" ] && echo "복원을 마쳤어요 · 결과 확인 표가 모두 같아요" || { echo "::warning::복원은 끝났지만 결과 확인 표에 다른 줄이 있어요"; }
