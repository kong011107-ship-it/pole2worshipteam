# v34.1: delete_sheet (migration_033) — 실제 PG16 + PostgREST 스택에서
#  권한 · 미리 보기(p_dry) · 올라온 콘티에서 빼기 · 알림 없음(notified_version) · '악보 바뀜' · 내 메모 지움 · 같은 PDF 공유 시 파일 남김
#  준비: 스택 리셋(마이그레이션 033까지) 후  python3 dev/tests/v34/db_delete.py
import json, subprocess, sys, urllib.request
BASE = "http://localhost:8790"
ok = 0; bad = []
def check(c, m):
    global ok
    if c: ok += 1; print("  ok ", m)
    else: bad.append(m); print("  BAD", m)
def q(sql):
    return subprocess.run(["su", "postgres", "-c", f"psql -d wt -At -c \"{sql}\""], capture_output=True, text=True).stdout.strip()
def http(path, body=None, token=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, method="POST" if body is not None else "GET")
    req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req) as r: b = r.read(); return r.status, (json.loads(b) if b else {})
    except urllib.error.HTTPError as e:
        b = e.read()
        try: return e.code, json.loads(b)
        except Exception: return e.code, b
def tok(e, p): return http("/auth/v1/token?grant_type=password", {"email": e, "password": p})[1]["access_token"]
def rpc(fn, a, t): return http("/rest/v1/rpc/" + fn, a, t)

A = tok("admin@x.com", "adminpass")
print("seed", http("/api/demo", {"action": "seed"}, A)[0])
PW = "pole2test!"
sun = q("select min(service_date) from services where ministry_id is null and status='published' and service_date >= current_date")
sid = q(f"select id from services where service_date='{sun}' and ministry_id is null")
# 이 예배 인도자 · 밴드 · 일반 싱어
lead = q(f"select m.email from assignments a join members m on m.id=a.member_id where a.service_id='{sid}' and a.position_code='leader' limit 1")
band = q(f"select m.email from assignments a join members m on m.id=a.member_id join positions p on p.code=a.position_code where a.service_id='{sid}' and p.kind='band' and not a.is_band_master limit 1")
sing = q(f"select m.email from assignments a join members m on m.id=a.member_id where a.service_id='{sid}' and a.position_code='singer' and not a.is_singer_leader limit 1")
other_lead = "lead2@x.com"   # 다른 리더(관리자 아님으로 바꿔서 씀)
q("update members set role='member' where email='lead2@x.com'")
L, B, S = tok(lead, PW), tok(band, PW), tok(sing, PW)
O = tok(other_lead, "lead2pass")
print("sunday", sun, "lead", lead, "band", band, "singer", sing)

# 곡 2개 · 악보 4개 (s1: 콘티에 씀 · s2/s2b: 같은 파일 (필기본은 path#꼬리) · s3: 원본)
song = q("select id from songs order by id limit 1")
song2 = q("select id from songs order by id offset 1 limit 1")
s1 = q(f"insert into sheet_versions(song_id, kind, name, pages, path, created_by) values ({song}, 'sheet', '잘못 넣은 악보', 2, 'sheets/1/11111111-1111-4111-8111-111111111111.pdf', (select id from members where email='{lead}')) returning id").splitlines()[0]
s2 = q(f"insert into sheet_versions(song_id, kind, name, pages, path, base_id) values ({song}, 'sheet', '필기본', 2, 'sheets/1/22222222-2222-4222-8222-222222222222.pdf#ab', null) returning id").splitlines()[0]
s2b = q(f"insert into sheet_versions(song_id, kind, name, pages, path) values ({song}, 'sheet', '필기본 2', 2, 'sheets/1/22222222-2222-4222-8222-222222222222.pdf') returning id").splitlines()[0]
s3 = q(f"insert into sheet_versions(song_id, kind, name, pages, path) values ({song2}, 'original', '원본 A', 1, 'originals/1/33333333-3333-4333-8333-333333333333.pdf') returning id").splitlines()[0]
sl = q(f"insert into setlists(service_date, leaders, source, service_id, status, version, notified_version, published_at, sheet_told) values ('{sun}', array['x'], 'platform', '{sid}', 'published', 3, 3, now(), array[{song}]::bigint[]) returning id").splitlines()[0]
q(f"insert into setlist_items(setlist_id, ord, song_id, key, sheet_id, page_from, page_to) values ({sl}, 1, {song}, 'G', {s1}, 1, 2), ({sl}, 2, {song2}, 'A', null, null, null)")
q(f"insert into sheet_notes(member_id, key, page, strokes) values ((select id from members where email='{sing}'), 's:{s1}', 1, '[]')")

print("== 권한")
st, r = rpc("delete_sheet", {"p_id": int(s1), "p_service": sid, "p_dry": True}, S)
check(st >= 400, f"일반 팀원은 못 지움 {st}")
st, r = rpc("delete_sheet", {"p_id": int(s1), "p_service": sid, "p_dry": True}, B)
check(st >= 400, f"밴드는 악보를 고칠 수 있어도 지우기는 못 함 {st}")
st, r = rpc("delete_sheet", {"p_id": int(s3), "p_service": None, "p_dry": True}, O)
check(st >= 400, f"상관없는 사람(리더십 아님)은 못 지움 {st}")
st, r = rpc("delete_sheet", {"p_id": int(s3), "p_service": None, "p_dry": True}, L)
check(st >= 400, f"인도자라도 이 예배와 상관없는 곡 악보는 못 지움 {st}")
st, r = rpc("delete_sheet", {"p_id": int(s3), "p_service": sid, "p_dry": True}, L)
check(st == 200, f"이 예배 콘티에 든 곡(song2)의 악보는 인도자가 지울 수 있음 {st} {r}")

print("== 미리 보기")
st, r = rpc("delete_sheet", {"p_id": int(s1), "p_service": sid, "p_dry": True}, L)
check(st == 200 and r["name"] == "잘못 넣은 악보" and len(r["uses"]) == 1 and r["uses"][0]["published"] is True and r["notes"] == 1, f"쓰인 콘티 · 내 메모 수 {r}")
check(q(f"select count(*) from sheet_versions where id={s1}") == "1", "미리 보기는 지우지 않음")

print("== 올라온 콘티에서 빼고 지우기")
st, r = rpc("delete_sheet", {"p_id": int(s1), "p_service": sid, "p_dry": False}, L)
check(st == 200 and r["deleted"] is True and r["path"] == "sheets/1/11111111-1111-4111-8111-111111111111.pdf", f"지움 · 파일 경로 돌려줌 {r}")
check(str(r.get("versions", {}).get(sid)) == "4", f"새 버전을 돌려줌 (화면이 이어서 저장) {r.get('versions')}")
check(q(f"select coalesce(sheet_id::text,'null')||'|'||coalesce(page_from::text,'null') from setlist_items where setlist_id={sl} and ord=1") == "null|null", "콘티 곡은 악보 없이 · 쪽 범위 비움")
row = q(f"select version||'|'||notified_version||'|'||(sheet_changes is not null)::text||'|'||coalesce(array_to_string(sheet_told, ','), '') from setlists where id={sl}")
check(row == "4|4|true|", f"버전 +1 · 알림 없음(notified 같이 +1) · '악보 바뀜' · 처음 채움 알림 기준에서 뺌 {row}")
check(q(f"select count(*) from sheet_notes where key='s:{s1}'") == "0", "이 악보에 쓴 내 메모도 지움")
check(q(f"select count(*) from sheet_versions where id={s1}") == "0", "악보 행 지움")

print("== 같은 PDF를 쓰는 악보가 있으면 파일은 남김 · 리더십")
st, r = rpc("delete_sheet", {"p_id": int(s2), "p_service": None, "p_dry": False}, A)
check(st == 200 and r["path"] is None and r["uses"] == [], f"path 없음 → 파일 안 지움 {r}")
st, r = rpc("delete_sheet", {"p_id": int(s2b), "p_service": None, "p_dry": False}, A)
check(st == 200 and r["path"] == "sheets/1/22222222-2222-4222-8222-222222222222.pdf", f"마지막 하나면 파일 경로 {r}")
st, r = rpc("delete_sheet", {"p_id": int(s2b), "p_service": None, "p_dry": True}, A)
check(st >= 400, f"이미 지운 악보 {st}")
st, r = rpc("delete_sheet", {"p_id": int(s3), "p_service": None, "p_dry": False}, None)
check(st >= 400, f"로그인 안 하면 못 함 {st}")
print("== edit_sheet 권한 (고침)")
s4 = q(f"insert into sheet_versions(song_id, kind, name, pages, path) values ({song2}, 'original', '원본 B', 1, 'originals/1/44444444-4444-4444-8444-444444444444.pdf') returning id").splitlines()[0]
st, r = rpc("edit_sheet", {"p_id": int(s4), "p_name": "바꿈", "p_delete": False}, S)
check(st >= 400 and q(f"select name from sheet_versions where id={s4}") == "원본 B", f"올린 사람이 비어 있어도 팀원은 이름 못 바꿈 {st}")
st, r = rpc("edit_sheet", {"p_id": int(s4), "p_name": None, "p_delete": True}, S)
check(st >= 400 and q(f"select count(*) from sheet_versions where id={s4}") == "1", f"팀원은 못 지움 {st}")
st, r = rpc("edit_sheet", {"p_id": int(s4), "p_name": "원본 B2", "p_delete": False}, A)
check(st == 200, f"리더십은 이름 바꿈 {st}")
print(f"ok {ok} bad {len(bad)} {bad}")
