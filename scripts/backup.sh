#!/usr/bin/env bash
# Pole2 찬양팀 — 백업 만들기 (GitHub Actions 'DB 백업'이 불러요 · 손으로 돌려도 돼요)
#  필요한 값: DB_URL(Session pooler) · PASS(백업 암호)
#  악보 파일까지: SB_URL(https://xxxx.supabase.co) · SB_KEY(service_role 키) — 없으면 DB만 백업
#  결과: pole2-backup-날짜.tar.gpg  (안에 public-*.dump · auth-*.dump · counts.json · storage/sheets/… · manifest.tsv)
set -euo pipefail
: "${DB_URL:?DB_URL이 필요해요}" "${PASS:?PASS(백업 암호)가 필요해요}"
BIN=${BIN:-/usr/lib/postgresql/17/bin}
D=${STAMP:-$(TZ=Asia/Seoul date +%Y%m%d-%H%M)}
W=$(mktemp -d); OUT="$W/out"; mkdir -p "$OUT/storage/sheets"
# 1) 앱 데이터 전체 (표 · 함수 · 권한 규칙 · 권한(grant)까지 — 복원한 뒤에도 권한이 그대로)
"$BIN/pg_dump" "$DB_URL" --format=custom --no-owner --schema=public --file="$OUT/public-$D.dump"
# 2) 로그인 계정 (비밀번호는 암호화된 채로) — 데이터만
"$BIN/pg_dump" "$DB_URL" --format=custom --data-only --table=auth.users --table=auth.identities --file="$OUT/auth-$D.dump"
"$BIN/pg_restore" --list "$OUT/public-$D.dump" > "$W/list.txt"
grep -q "TABLE DATA public members" "$W/list.txt" || { echo "::error::백업에 members 표가 없어요"; exit 1; }
# 3) 표 별 개수 (복원 뒤 결과 확인 표에 씀)
"$BIN/psql" "$DB_URL" -At -c "select coalesce((select public.backup_counts())::text, '{}')" > "$OUT/counts.json" 2>/dev/null || echo '{}' > "$OUT/counts.json"
# 4) 악보 파일 (Storage 'sheets' 버킷)
FILES=0; BYTES=0
if [ -n "${SB_URL:-}" ] && [ -n "${SB_KEY:-}" ]; then
  "$BIN/psql" "$DB_URL" -At -c "select name from storage.objects where bucket_id = 'sheets' order by name" > "$W/objects.txt"
  : > "$OUT/manifest.tsv"
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    case "$name" in *..*|/*) echo "::warning::건너뜀 $name"; continue;; esac
    mkdir -p "$OUT/storage/sheets/$(dirname "$name")"
    curl -fsS --retry 3 -H "Authorization: Bearer $SB_KEY" -H "apikey: $SB_KEY" "$SB_URL/storage/v1/object/sheets/$name" -o "$OUT/storage/sheets/$name"
    s=$(stat -c %s "$OUT/storage/sheets/$name"); FILES=$((FILES + 1)); BYTES=$((BYTES + s))
    printf '%s\t%s\n' "$name" "$s" >> "$OUT/manifest.tsv"
  done < "$W/objects.txt"
  echo "악보 파일 $FILES개 · $((BYTES / 1024 / 1024))MB"
else
  echo "::warning::SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY Secrets가 없어서 악보 파일은 빼고 DB만 백업했어요"
  FILES=-1
fi
NAME="pole2-backup-$D"
tar -C "$OUT" -cf "$W/$NAME.tar" .
gpg --batch --yes --pinentry-mode loopback --passphrase "$PASS" --symmetric --cipher-algo AES256 -o "${DEST:-.}/$NAME.tar.gpg" "$W/$NAME.tar"
SIZE=$(stat -c %s "${DEST:-.}/$NAME.tar.gpg")
COUNTS=$(cat "$OUT/counts.json")
rm -rf "$W"
echo "NAME=$NAME"; echo "FILE=$NAME.tar.gpg"; echo "SIZE=$SIZE"; echo "FILES=$FILES"
if [ -n "${GITHUB_ENV:-}" ]; then { echo "NAME=$NAME"; echo "FILE=$NAME.tar.gpg"; echo "SIZE=$SIZE"; echo "FILES=$FILES"; echo "COUNTS=$COUNTS"; } >> "$GITHUB_ENV"; fi
