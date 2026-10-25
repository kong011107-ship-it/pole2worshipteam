import asyncio, sys, json, subprocess, os, re, urllib.request, uuid, datetime, time
sys.path.insert(0, "/home/claude/tests")
from h import *
def q(sql):
    return subprocess.run(["su", "postgres", "-c", f"psql -d wt -At -c \"{sql}\""], capture_output=True, text=True).stdout.strip()
def http(path, body=None, token=None, headers=None, method=None, raw=None, ctype="application/json"):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(BASE + path, data=data, method=method or ("POST" if data is not None else "GET"))
    req.add_header("Content-Type", ctype)
    if token: req.add_header("Authorization", "Bearer " + token)
    for k, v in (headers or {}).items(): req.add_header(k, v)
    try:
        with urllib.request.urlopen(req) as r:
            b = r.read()
            try: return r.status, json.loads(b) if b else {}
            except Exception: return r.status, b
    except urllib.error.HTTPError as e:
        b = e.read()
        try: return e.code, json.loads(b) if b else {}
        except Exception: return e.code, b
def tok(email, pw): return http("/auth/v1/token?grant_type=password", {"email": email, "password": pw})[1]["access_token"]
def rpc(fn, args, token): return http("/rest/v1/rpc/" + fn, args, token)
def rest(path, token, body=None, method=None, prefer=None):
    return http("/rest/v1/" + path, body, token, {"Prefer": prefer} if prefer else None, method)
def up(path, file, token, ctype):
    return http("/storage/v1/object/sheets/" + path, raw=open(file, "rb").read(), token=token, ctype=ctype)
ok = 0; bad = []
def check(c, msg):
    global ok
    if c: ok += 1
    else: bad.append(msg); print("FAIL", msg)
SHOT = "/home/claude/tests/v28_"
FX = "/home/claude/tests/fx/"
PW = "pole2test!"
U = lambda: str(uuid.uuid4())
ST = "document.querySelector('.cv-viewer')._viewer.ink.state"
CID = lambda: uuid.uuid4().hex[:24]
STK = lambda: {"t": "p", "c": "#1F5C99", "w": 30, "p": [1000, 1000, 3000, 1500, 5000, 1200]}
def pushes(): 
    try: return [json.loads(l) for l in open("/home/claude/pgrst/push.log")]
    except Exception: return []

async def draw(pg, box, pts, steps=6):
    x0, y0 = box["x"] + box["width"] * pts[0][0], box["y"] + box["height"] * pts[0][1]
    await pg.mouse.move(x0, y0); await pg.mouse.down()
    for (fx, fy) in pts[1:]:
        await pg.mouse.move(box["x"] + box["width"] * fx, box["y"] + box["height"] * fy, steps=steps)
    await pg.mouse.up(); await pg.wait_for_timeout(150)

def setup():
    T = tok("admin@x.com", "adminpass")
    st, r = http("/api/demo", {"action": "seed"}, T); print("seed", st, r.get("members"))
    D = {n: tok(f"demo{n:02d}@pole2.test", PW) for n in range(1, 13)}
    mid = {n: q(f"select id from members where email='demo{n:02d}@pole2.test'") for n in range(1, 13)}
    sun = q("select min(service_date) from services where ministry_id is null and status='published' and service_date >= current_date")
    sid = q(f"select id from services where service_date='{sun}' and ministry_id is null")
    fix_lineup(q, sid)
    sd = datetime.date.fromisoformat(sun)
    nxt = str(sd + datetime.timedelta(days=7))
    q(f"insert into services(service_date, status) values ('{nxt}', 'published') on conflict do nothing")
    q(f"update services set status='published' where service_date='{nxt}' and ministry_id is null")
    sid2 = q(f"select id from services where service_date='{nxt}' and ministry_id is null")
    return T, D, mid, sun, sid, nxt, sid2

async def main():
    T, D, mid, sun, sid, nxt, sid2 = setup()
    print("sunday", sun, sid, "next", nxt)
    lineup = q(f"select count(distinct member_id) from assignments where service_id='{sid}' and member_id is not null")
    print("lineup", lineup)
    open("/home/claude/pgrst/push.log", "a").close()

    # ================= 1. 적용찬양: 처음 올릴 때만 알림 · 수정됨
    ap1 = f"applied/{sid}/{U()}.jpg"; check(up(ap1, FX + "ap1.jpg", D[1], "image/jpeg")[0] == 200, "leader uploads applied image")
    st, r = rest("applied_songs", D[1], {"service_id": sid, "ord": 1, "title": "주의 손에", "key": "D", "images": [ap1]}, "POST", "return=representation")
    check(st in (200, 201), f"applied insert {st} {r}")
    aid = int(q(f"select id from applied_songs where service_id='{sid}' and title='주의 손에'"))
    check(http("/api/conti", {"action": "applied-notify", "service_id": sid}, D[2])[0] == 403, "singer cannot trigger applied notify")
    st, r = http("/api/conti", {"action": "applied-notify", "service_id": sid}, D[1])
    check(st == 200 and r.get("recipients") == int(lineup) - 1, f"applied notify to lineup minus me {st} {r}")
    n = q("select title||'|'||kind||'|'||recipients from notifications order by id desc limit 1")
    check("적용찬양이 올라왔어요" in n and "|conti|" in n, f"applied notification row {n}")
    check(q(f"select count(*) from notification_inbox i join notifications n on n.id=i.notification_id where n.title like '%적용찬양%' and i.member_id='{mid[1]}'") == "0", "uploader not notified")
    check(q(f"select count(*) from notification_inbox i join notifications n on n.id=i.notification_id where n.title like '%적용찬양%' and i.member_id='{mid[5]}'") == "0", "non-lineup not notified")
    st, r = http("/api/conti", {"action": "applied-notify", "service_id": sid}, D[1])
    check(st == 200 and r.get("skipped") and r.get("already"), f"second applied notify skipped {r}")
    # 10분 안에 더 올리면 수정됨 아님
    ap2 = f"applied/{sid}/{U()}.jpg"; up(ap2, FX + "ap2.jpg", D[1], "image/jpeg")
    rest("applied_songs", D[1], {"service_id": sid, "ord": 2, "title": "은혜 아니면", "key": "G", "images": [ap2, ap1]}, "POST")
    aid2 = int(q(f"select id from applied_songs where service_id='{sid}' and title='은혜 아니면'"))
    c = rpc("conti_one", {"p_service": sid}, D[2])[1]
    check(c["applied_meta"]["notified_at"] and not c["applied_meta"]["edited_at"], f"no edited mark within 10 min {c['applied_meta']}")
    q(f"update applied_meta set notified_at = now() - interval '11 minutes' where service_id='{sid}'")
    rest(f"applied_songs?id=eq.{aid2}", D[1], {"ord": 3}, "PATCH")
    check(not rpc("conti_one", {"p_service": sid}, D[2])[1]["applied_meta"]["edited_at"], "reorder only: no edited mark")

    # ================= 2. 공유 필기: 적용찬양 (권한 · 지우기)
    c1, c2, c3 = CID(), CID(), CID()
    st, r = rpc("ink_put", {"p_service": sid, "p_target": f"a:{aid}", "p_ver": None, "p_ops": {"add": [{"cid": c1, "page": 1, "stroke": STK()}]}}, D[8])
    check(st == 200 and r["added"] == 1, f"band (e_guitar) writes applied ink {st} {r}")
    check(rpc("ink_put", {"p_service": sid, "p_target": f"a:{aid}", "p_ver": None, "p_ops": {"add": [{"cid": CID(), "page": 1, "stroke": STK()}]}}, D[2])[0] >= 400, "singer cannot write")
    check(rpc("ink_put", {"p_service": sid2, "p_target": f"a:{aid}", "p_ver": None, "p_ops": {"add": [{"cid": CID(), "page": 1, "stroke": STK()}]}}, T)[0] >= 400, "applied of other service rejected")
    check(rpc("ink_put", {"p_service": sid, "p_target": "z:1", "p_ver": None, "p_ops": {}}, D[8])[0] >= 400, "bad target rejected")
    st, r = rpc("ink_put", {"p_service": sid, "p_target": f"a:{aid}", "p_ver": None, "p_ops": {"add": [{"cid": c2, "page": 1, "stroke": STK()}]}}, D[1])
    check(st == 200, "leader writes applied ink")
    st, r = rpc("ink_put", {"p_service": sid, "p_target": f"a:{aid}", "p_ver": None, "p_ops": {"del": [c2]}}, D[8])
    check(st == 200 and r["skipped"] == 1 and r["deleted"] == 0, f"band cannot erase leader stroke {r}")
    st, r = rpc("ink_put", {"p_service": sid, "p_target": f"a:{aid}", "p_ver": None, "p_ops": {"del": [c1]}}, D[6])
    check(st == 200 and r["deleted"] == 1, f"band master erases others {r}")
    st, r = rpc("ink_put", {"p_service": sid, "p_target": f"a:{aid}", "p_ver": None, "p_ops": {"undel": [c1]}}, D[6])
    check(st == 200 and r["deleted"] == 1, "undel by eraser")
    check(rpc("ink_put", {"p_service": sid, "p_target": f"a:{aid}", "p_ver": None, "p_ops": {"add": [{"cid": CID(), "page": 2, "stroke": STK()}]}}, D[8])[1].get("added") == 1, "page 2 allowed (<=40)")
    sl_ch = q(f"select count(*) from setlists where service_id='{sid}' and sheet_changes is not null")
    check(q(f"select count(*) from ink_extra where target='a:{aid}' and deleted_from is null") == "3", "3 applied strokes live")
    check(len(rest(f"ink_extra?target=eq.a:{aid}&select=cid", D[3])[1]) == 3, "members can read ink")
    # 사진 바꾸면 필기도 지움 + 수정됨
    ap3 = f"applied/{sid}/{U()}.jpg"; up(ap3, FX + "ap2.jpg", D[1], "image/jpeg")
    rest(f"applied_songs?id=eq.{aid}", D[1], {"images": [ap3]}, "PATCH")
    check(q(f"select count(*) from ink_extra where target='a:{aid}'") == "0", "image change clears applied ink")
    m = rpc("conti_one", {"p_service": sid}, D[2])[1]["applied_meta"]
    check(m["edited_at"] and m["edited_by"] == q(f"select name from members where id='{mid[1]}'"), f"edited mark after image change {m}")
    rest(f"applied_songs?id=eq.{aid}", D[1], {"images": [ap1]}, "PATCH")

    # ================= 3. 예배 진행곡: 그 곡을 바꿀 때까지 쌓임
    pp = f"proc/{U()}.pdf"; check(up(pp, FX + "proc.pdf", T, "application/pdf")[0] == 200, "upload proc")
    for kind, title in [("blessing", "축복합니다"), ("offering", "드리네"), ("benediction", "아론의 축복")]:
        rest("worship_proc", T, {"kind": kind, "title": title, "path": pp, "pages": 1, "start_date": "2026-01-01"}, "POST")
    pb = int(q("select id from worship_proc where kind='blessing' order by id desc limit 1"))
    cp = CID()
    st, r = rpc("ink_put", {"p_service": sid, "p_target": f"p:{pb}", "p_ver": None, "p_ops": {"add": [{"cid": cp, "page": 1, "stroke": STK()}]}}, D[8])
    check(st == 200 and r["added"] == 1, f"band writes proc ink {r}")
    check(rpc("ink_put", {"p_service": sid, "p_target": f"p:{pb}", "p_ver": None, "p_ops": {"add": [{"cid": CID(), "page": 2, "stroke": STK()}]}}, D[8])[0] >= 400, "proc page beyond pages rejected")
    check(q(f"select valid_from from ink_extra where cid='{cp}'") == sun, "proc ink valid from service date")
    # 다음 주 예배에서도 보임 (valid_from <= 다음 주) · 다음 주에 지우면 이번 주는 그대로
    q(f"insert into assignments(service_id, position_code, slot, member_id, is_band_master) select '{sid2}', position_code, slot, member_id, is_band_master from assignments where service_id='{sid}' on conflict do nothing")
    st, r = rpc("ink_put", {"p_service": sid2, "p_target": f"p:{pb}", "p_ver": None, "p_ops": {"del": [cp]}}, D[1])
    check(st == 200 and r["deleted"] == 1 and q(f"select deleted_from from ink_extra where cid='{cp}'") == nxt, f"next week erase dated {r}")
    # 새 축복송으로 바꾸면(새 id) 지난 곡 필기는 그 곡에만
    rest("worship_proc", T, {"kind": "blessing", "title": "새 축복송", "path": pp, "pages": 1, "start_date": sun}, "POST")
    pb2 = int(q("select id from worship_proc where kind='blessing' order by id desc limit 1"))
    check(rpc("ink_put", {"p_service": sid, "p_target": f"p:{pb}", "p_ver": None, "p_ops": {"add": [{"cid": CID(), "page": 1, "stroke": STK()}]}}, D[8])[0] >= 400, "replaced proc no longer writable")
    check(rpc("ink_put", {"p_service": sid, "p_target": f"p:{pb2}", "p_ver": None, "p_ops": {"add": [{"cid": CID(), "page": 1, "stroke": STK()}]}}, D[8])[1].get("added") == 1, "new proc writable fresh")
    q(f"delete from worship_proc where id={pb2}")
    check(q(f"select count(*) from ink_extra where target='p:{pb2}'") == "0", "proc delete clears ink")

    # ================= 4. 백업찬양: 확정 전 숨김 · 확정 · 수정 · 알림
    bp = f"book/{U()}.pdf"; check(up(bp, FX + "book.pdf", T, "application/pdf")[0] == 200, "upload book")
    songs = [{"code": "g40", "title": "비 준비하시니", "key": "g", "topic": 4, "page": 3}, {"code": "g51", "title": "주의 이름 높이며", "key": "g", "topic": 5, "page": 4},
             {"code": "f40", "title": "비 준비하시니", "key": "f", "topic": 4, "page": 5}, {"code": "g54", "title": "오직 주의 사랑에 매여", "key": "g", "topic": 5, "page": 6}]
    st, r = rpc("backup_book_save", {"p_label": "Ver.2605", "p_path": bp, "p_pages": 8, "p_size": 1000, "p_topics": None, "p_songs": songs}, T)
    check(st == 200, f"book save {st} {r}")
    book = q("select id from backup_books where active")
    g = {c: int(q(f"select id from backup_songs where book_id={book} and code='{c}'")) for c in ("g40", "g51", "g54")}
    st, r = rpc("backup_update", {"p": {"candidates": [g["g40"], g["g51"]]}}, D[1])
    check(st == 200 and r["candidates"] == [g["g40"], g["g51"]] and r["confirmed"] is False, f"leader drafts {r}")
    s2 = rpc("backup_state_live", {}, D[2])[1]
    check(s2["candidates"] == [] and s2["confirmed"] is False and s2.get("pub_candidates") is None, f"member sees nothing before confirm {s2}")
    check(rpc("backup_confirm", {}, D[2])[0] >= 400, "member cannot confirm")
    check(http("/api/conti", {"action": "backup-notify"}, D[1])[0] == 400, "notify before confirm rejected")
    st, r = rpc("backup_confirm", {}, D[1])
    check(st == 200 and r["confirmed"] and r["service_id"] == sid and r["pub_candidates"] == [g["g40"], g["g51"]], f"confirm {st} {r}")
    s2 = rpc("backup_state_live", {}, D[2])[1]
    check(s2["candidates"] == [g["g40"], g["g51"]] and s2["confirmed"], f"member sees confirmed {s2['candidates']}")
    check(s2["can_ink"] is False and rpc("backup_state_live", {}, D[8])[1]["can_ink"] is True and rpc("backup_state_live", {}, D[8])[1]["can_ink_all"] is False, "backup ink perms")
    check(http("/api/conti", {"action": "backup-notify"}, D[2])[0] == 403, "other member cannot notify")
    p0 = len(pushes())
    st, r = http("/api/conti", {"action": "backup-notify"}, D[1])
    check(st == 200 and r.get("kind") == "backup_pick" and r.get("recipients") == int(lineup) - 1, f"backup confirm notify {st} {r}")
    n = q("select title||'|'||coalesce(body,'')||'|'||url from notifications order by id desc limit 1")
    check("백업찬양 후보가 정해졌어요" in n and "g40 비 준비하시니 · g51 주의 이름 높이며" in n and "#worship/backup" in n, f"backup pick text {n}")
    check(http("/api/conti", {"action": "backup-notify"}, D[1])[1].get("skipped"), "notify once per version")
    # 수정: 고르는 중엔 팀원에게 확정본
    rpc("backup_update", {"p": {"candidates": [g["g40"], g["g54"]]}}, D[1])
    check(rpc("backup_state_live", {}, D[2])[1]["candidates"] == [g["g40"], g["g51"]], "member keeps confirmed while leader edits")
    st, r = rpc("backup_confirm", {}, D[1])
    check(st == 200 and r["pub_candidates"] == [g["g40"], g["g54"]], "edit confirm")
    st, r = http("/api/conti", {"action": "backup-notify"}, D[1])
    n = q("select title||'|'||coalesce(body,'') from notifications order by id desc limit 1")
    check(r.get("kind") == "backup_edit" and "후보가 바뀌었어요" in n and "추가: g54 오직 주의 사랑에 매여" in n and "빠짐: g51 주의 이름 높이며" in n, f"backup edit notify {r} {n}")
    check(rpc("backup_confirm", {}, D[1])[0] >= 400, "edit without change rejected")
    rpc("backup_update", {"p": {"candidates": [g["g54"], g["g40"]]}}, D[1]); rpc("backup_confirm", {}, D[1])
    http("/api/conti", {"action": "backup-notify"}, D[1])
    check("순서 변경" in q("select coalesce(body,'') from notifications order by id desc limit 1"), "reorder edit text")
    # 알림 끄면 알림 없이 버전만
    rest("notify_settings", T, {"kind": "backup_edit", "enabled": False, "title": "{예배} 백업찬양 후보가 바뀌었어요", "body": "{바뀐 것}"}, "POST", "resolution=merge-duplicates")
    rpc("backup_update", {"p": {"candidates": [g["g40"], g["g54"]]}}, D[1]); rpc("backup_confirm", {}, D[1])
    nn = q("select count(*) from notifications")
    st, r = http("/api/conti", {"action": "backup-notify"}, D[1])
    check(r.get("skipped") and q("select count(*) from notifications") == nn and q("select pub_ver=notified_ver from backup_live") == "t", f"disabled kind skipped {r}")
    rest("notify_settings?kind=eq.backup_edit", T, {"enabled": True}, "PATCH")
    # 백업찬양 공유 필기
    cb = CID()
    st, r = rpc("ink_put", {"p_service": sid, "p_target": "b:g40", "p_ver": book, "p_ops": {"add": [{"cid": cb, "page": 1, "stroke": STK()}]}}, D[8])
    check(st == 200 and r["added"] == 1, f"band writes backup ink {r}")
    check(rpc("ink_put", {"p_service": sid2, "p_target": "b:g40", "p_ver": book, "p_ops": {"add": [{"cid": CID(), "page": 1, "stroke": STK()}]}}, T)[0] >= 400, "backup ink only for backup service")
    check(rpc("ink_put", {"p_service": sid, "p_target": "b:g40", "p_ver": "999", "p_ops": {"add": [{"cid": CID(), "page": 1, "stroke": STK()}]}}, D[8])[0] >= 400, "wrong book version rejected")
    check(rpc("ink_put", {"p_service": sid, "p_target": "b:g40", "p_ver": book, "p_ops": {"add": [{"cid": CID(), "page": 2, "stroke": STK()}]}}, D[8])[0] >= 400, "backup page beyond song pages rejected")
    check(q(f"select ver from ink_extra where cid='{cb}'") == book, "backup ink keeps book version")

    # ================= 5. 메트로놈 함께 맞추기 (DB)
    check(rpc("metro_set", {"p_service": sid, "p": {"on": True, "bpm": 72}}, D[2])[0] >= 400, "singer cannot control metro")
    check(rpc("metro_set", {"p_service": sid, "p": {"on": True, "bpm": 72}}, T)[0] >= 400, "admin outside lineup cannot control metro")
    check(rpc("metro_set", {"p_service": sid, "p": {"on": True}}, D[10])[0] >= 400, "needs bpm")
    t1 = time.time() * 1000
    st, r = rpc("metro_set", {"p_service": sid, "p": {"on": True, "bpm": 72, "meter": "4/4", "ord": 1, "title": "x"}}, D[10])
    check(st == 200 and r["on"] and r["bpm"] == 72 and abs(r["t0"] - r["now"] - 700) < 300 and abs(r["now"] - t1) < 3000, f"drum turns on {st} {r}")
    st, r2 = rpc("metro_set", {"p_service": sid, "p": {"on": True, "bpm": 72, "meter": "4/4", "ord": 2}}, D[6])
    check(st == 200 and r2["t0"] == r["t0"] and r2["by_name"] == q(f"select name from members where id='{mid[6]}'"), "same bpm keeps phase (band master)")
    st, r3 = rpc("metro_set", {"p_service": sid, "p": {"on": True, "bpm": 90, "meter": "6/8", "ord": 3}}, D[1])
    check(st == 200 and r3["t0"] > r["t0"] and r3["meter"] == "6/8", "new bpm new downbeat (leader)")
    rpc("metro_set", {"p_service": sid, "p": {"on": False}}, D[1])
    check(q(f"select on_ from metro_live where service_id='{sid}'") == "f", "off")
    check(rpc("conti_one", {"p_service": sid}, D[10])[1]["can_metro"] is True and rpc("conti_one", {"p_service": sid}, D[2])[1]["can_metro"] is False, "can_metro flag")
    check(q("select count(*) from notify_settings where kind in ('applied_up','backup_pick','backup_edit')") == "3", "notify settings rows")

    # ================= 6. 공유 링크: 적용찬양 · 진행곡 · 백업찬양 필기 · 확정본
    tk = re.sub(r"[^A-Za-z0-9_-]", "", uuid.uuid4().hex + uuid.uuid4().hex)[:32]
    rest("share_links", T, {"token": tk, "label": "섬김이 팀", "active": True}, "POST")
    st, sh = http("/api/conti", {"action": "share", "t": tk})
    f = next(s for s in sh["services"] if s["id"] == sid)
    ap_ = next(a for a in f["applied"] if a["title"] == "은혜 아니면")
    check(st == 200 and isinstance(ap_.get("ink"), list), f"share applied ink field {st}")
    pr_ = next(p for p in f["proc"] if p["kind"] == "blessing")
    check(len(pr_["ink"]) >= 1, f"share proc ink {len(pr_['ink'])}")
    bks = sh["backup"]
    check(bks["candidates"] == [g["g40"], g["g54"]] and any(x["code"] == "g40" and len(x["ink"]) == 1 for x in bks["songs"]), f"share backup confirmed + ink {bks['candidates']}")
    rpc("backup_update", {"p": {"active": True}}, D[1]); rpc("backup_update", {"p": {"active": False}}, D[1])
    s2 = rpc("backup_state_live", {}, D[2])[1]
    check(s2["candidates"] == [] and not s2["confirmed"], f"end resets confirm {s2['candidates']}")
    check(http("/api/conti", {"action": "share-live", "t": tk})[1]["candidates"] == [], "share-live hides unconfirmed")
    rpc("backup_confirm", {}, D[1]); http("/api/conti", {"action": "backup-notify"}, D[1])

    globals().update(dict(T=T, D=D, mid=mid, sun=sun, sid=sid, nxt=nxt, sid2=sid2, aid=aid, aid2=aid2, g=g, book=book, bp=bp, pp=pp, pb=pb, tk=tk))
    await browser_part()
    print("ok", ok, "bad", bad)

MS = "document.querySelector('.cv-viewer')._viewer.ms?.state"
MT = "CONTI.METRO.state"
async def browser_part():
    # 콘티 올리기 (인도자): 곡 2개 · BPM 72 / 90
    p1, p2 = f"sheets/162/{U()}.pdf", f"sheets/18/{U()}.pdf"
    up(p1, FX + "conti5.pdf", D[1], "application/pdf"); up(p2, FX + "conti5.pdf", D[1], "application/pdf")
    st, r = rpc("save_setlist", {"p_service": sid, "p_data": {"pages": 5, "items": [
        {"song_id": 162, "key": "G", "bpm": 72, "meter": "4/4", "new_sheet": {"name": "공준혁 G", "path": p1, "pages": 3, "size": 100}, "page_from": 1, "page_to": 3},
        {"song_id": 18, "key": "A", "bpm": 90, "meter": "6/8", "new_sheet": {"name": "공준혁 A", "path": p2, "pages": 2, "size": 100}, "page_from": 4, "page_to": 5}]}, "p_publish": True, "p_base": None}, D[1])
    check(st == 200, f"publish conti {st} {r}")
    async with async_playwright() as p:
        # ================= A. 밴드: 적용찬양 · 예배 진행곡 악보 고치기
        b, ctx = await browser(p, viewport={"width": 1194, "height": 834})
        pg = await login(ctx, "demo08@pole2.test", PW, dest=None)
        await pg.goto(BASE + f"/me.html#worship/{sid}"); await pg.wait_for_timeout(2200)
        check(await pg.locator(".cv-aped").count() == 1, "applied card shows 수정됨")
        await pg.click(".cv-pdfbar"); await pg.wait_for_timeout(2500)
        await pg.locator(".cvv-jump button.applied").first.click(); await pg.wait_for_timeout(1800)
        s0 = await pg.evaluate(ST)
        check(s0["target"] == f"a:{aid}" and s0["canEdit"], f"applied shared target {s0.get('target')} {s0.get('canEdit')}")
        fix = pg.locator(".cvv-top [data-iv=fix]")
        check(await fix.is_visible(), "fix button visible on applied")
        await fix.click(); await pg.wait_for_timeout(400)
        check(await pg.locator("#cvvInk .iv-bar.iv-shared").count() == 1, "shared toolbar on applied")
        check(await pg.locator("#cvvInk [data-iv=fork]").count() == 0 and await pg.locator("#cvvInk [data-iv=wipe]").count() == 0, "no fork / no wipe for band")
        box = await pg.locator("#cvvCanvas").bounding_box()
        await draw(pg, box, [(0.2, 0.3), (0.5, 0.35), (0.7, 0.3)])
        await pg.wait_for_timeout(1500)
        check(q(f"select count(*) from ink_extra where target='a:{aid}' and author='{mid[8]}' and deleted_from is null") == "1", "applied stroke saved via ink_put")
        await pg.screenshot(path=SHOT + "applied_fix.png")
        # 예배 진행곡
        await pg.locator(".cvv-jump button.proc").first.click(); await pg.wait_for_timeout(1800)
        s1 = await pg.evaluate(ST)
        check(s1["target"] == f"p:{pb}" and s1["pen"] and s1["layer"] == "shared" and s1["shared"] == 1, f"proc keeps fix mode, shows prior stroke {s1.get('target')} {s1.get('shared')}")
        box = await pg.locator("#cvvCanvas").bounding_box()
        await draw(pg, box, [(0.3, 0.6), (0.6, 0.62)])
        await pg.wait_for_timeout(1500)
        check(q(f"select count(*) from ink_extra where target='p:{pb}' and author='{mid[8]}' and valid_from='{sun}'") == "2", "proc stroke saved")
        await pg.locator("#cvvInk [data-iv=done]").click()
        check(pg.errs == [], f"band errs {pg.errs[:3]}")
        await ctx.close(); await b.close()

        # ================= B. 인도자: 전부 지우기 · 되돌리기
        b, ctx = await browser(p, viewport={"width": 1194, "height": 834})
        pg = await login(ctx, "demo01@pole2.test", PW, dest=None)
        pg.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
        await pg.goto(BASE + f"/me.html#worship/{sid}"); await pg.wait_for_timeout(2200)
        await pg.click(".cv-pdfbar"); await pg.wait_for_timeout(2500)
        await pg.locator(".cvv-jump button.applied").first.click(); await pg.wait_for_timeout(1800)
        await pg.locator(".cvv-top [data-iv=fix]").click(); await pg.wait_for_timeout(400)
        wipe = pg.locator("#cvvInk [data-iv=wipe]")
        check(await wipe.count() == 1 and await pg.locator("#cvvInk [data-iv=fork]").count() == 0, "leader sees wipe, no fork")
        check((await pg.evaluate(ST))["shared"] == 1, "leader sees band stroke")
        await wipe.click(); await pg.wait_for_timeout(1500)
        check((await pg.evaluate(ST))["shared"] == 0 and q(f"select count(*) from ink_extra where target='a:{aid}' and deleted_from is null") == "0", "wipe removes all")
        await pg.locator("#cvvInk [data-iv=undo]").click(); await pg.wait_for_timeout(1500)
        check((await pg.evaluate(ST))["shared"] == 1 and q(f"select count(*) from ink_extra where target='a:{aid}' and deleted_from is null") == "1", "undo restores wiped")
        await wipe.click(); await pg.wait_for_timeout(1500)
        await pg.screenshot(path=SHOT + "leader_wipe.png")
        # 콘티 곡에도 전부 지우기 · 새 악보로 저장은 그대로
        await pg.locator(".cvv-jump button").first.click(); await pg.wait_for_timeout(1500)
        check(await pg.locator("#cvvInk [data-iv=fork]").count() + await pg.locator("#cvvInk .iv-name").count() >= 1, "conti song still has fork")
        await pg.locator("#cvvInk [data-iv=done]").click()
        check(pg.errs == [], f"leader errs {pg.errs[:3]}")
        await ctx.close(); await b.close()

        # ================= C. 이 곡 지난 필기 보기 (적용찬양 · 같은 곡 이름)
        apx = f"applied/{sid2}/{U()}.jpg"; up(apx, FX + "ap2.jpg", T, "image/jpeg")
        rest("applied_songs", T, {"service_id": sid2, "ord": 1, "title": "주의 손에", "key": "E", "images": [apx]}, "POST")
        ax = int(q(f"select id from applied_songs where service_id='{sid2}' and title='주의 손에'"))
        rpc("ink_put", {"p_service": sid2, "p_target": f"a:{ax}", "p_ver": None, "p_ops": {"add": [{"cid": CID(), "page": 1, "stroke": STK()}]}}, D[1])
        b, ctx = await browser(p, viewport={"width": 1194, "height": 834})
        pg = await login(ctx, "demo02@pole2.test", PW, dest=None)
        await pg.goto(BASE + f"/me.html#worship/{sid}"); await pg.wait_for_timeout(2200)
        await pg.click(".cv-pdfbar"); await pg.wait_for_timeout(2500)
        await pg.locator(".cvv-jump button.applied").first.click(); await pg.wait_for_timeout(2500)
        s2 = await pg.evaluate(ST)
        check(s2["shHist"] == 1 and await pg.locator(".iv-hint:not(.hidden) [data-iv=shhist]").count() == 1, f"shared history hint {s2.get('shHist')}")
        check("이 곡 지난 필기 보기" in (await pg.locator("[data-iv=shhist]").text_content()), "hint label")
        check(await pg.locator(".cvv-top [data-iv=fix]").is_hidden(), "singer has no fix button")
        await pg.click("[data-iv=shhist]"); await pg.wait_for_timeout(2500)
        check(await pg.locator(".iv-ref").count() == 1 and "주의 손에" in await pg.locator(".iv-ref-sel").text_content() and "악보 고치기" in await pg.locator(".iv-ref-foot").text_content(), "shared history panel")
        check(await pg.evaluate("document.querySelector('.iv-ref canvas').width") > 100, "history canvas drawn")
        await pg.screenshot(path=SHOT + "applied_history.png")
        await pg.click("[data-ref=close]")
        check(pg.errs == [], f"singer errs {pg.errs[:3]}")
        await ctx.close(); await b.close()

        # ================= D. 백업찬양: 밴드 악보 고치기 · 이전 판 필기
        b, ctx = await browser(p, viewport={"width": 1194, "height": 834})
        pg = await login(ctx, "demo08@pole2.test", PW, dest=None)
        await pg.goto(BASE + "/me.html#worship/backup"); await pg.wait_for_timeout(2500)
        check(await pg.locator('#worshipNav [data-ws="backup"][aria-pressed="true"]').count() == 1, "deep link opens backup tab")
        check(await pg.locator(".bk-slot:not(.empty)").count() == 2, "member sees confirmed slots")
        await pg.locator(f'.bk-slot[data-bk-view="{g["g40"]}"]').click(); await pg.wait_for_timeout(2500)
        s3 = await pg.evaluate(ST)
        check(s3["target"] == "b:g40" and s3["ver"] == book and s3["shared"] == 1 and s3["canEdit"], f"backup preview shared {s3.get('target')} {s3.get('ver')} {s3.get('shared')}")
        await pg.locator(".cvv-top [data-iv=fix]").click(); await pg.wait_for_timeout(400)
        box = await pg.locator("#cvvCanvas").bounding_box()
        await draw(pg, box, [(0.2, 0.5), (0.7, 0.55)]); await pg.wait_for_timeout(1500)
        check(q(f"select count(*) from ink_extra where target='b:g40' and ver='{book}' and deleted_from is null") == "2", "backup stroke saved with ver")
        await pg.locator("#cvvInk [data-iv=done]").click()
        await pg.locator(".cvv-back").click(); await pg.wait_for_timeout(500)
        # 새 판 악보집
        bp2 = f"book/{U()}.pdf"; up(bp2, FX + "book.pdf", T, "application/pdf")
        songs = [{"code": "g40", "title": "비 준비하시니", "key": "g", "topic": 4, "page": 3}, {"code": "g54", "title": "오직 주의 사랑에 매여", "key": "g", "topic": 5, "page": 6}]
        rpc("backup_book_save", {"p_label": "Ver.2611", "p_path": bp2, "p_pages": 8, "p_size": 1000, "p_topics": None, "p_songs": songs}, T)
        book2 = q("select id from backup_books where active")
        ng40 = int(q(f"select id from backup_songs where book_id={book2} and code='g40'"))
        check(json.loads(q("select array_to_json(pub_candidates) from backup_live")) [0] in (ng40, int(q(f"select id from backup_songs where book_id={book2} and code='g54'"))), "pub candidates mapped to new edition")
        await pg.reload(); await pg.wait_for_timeout(2500)
        await pg.locator(f'.bk-slot[data-bk-view="{ng40}"]').click(); await pg.wait_for_timeout(2500)
        s4 = await pg.evaluate(ST)
        check(s4["ver"] == book2 and s4["shared"] == 0 and s4["shHist"] == 1, f"new edition: no carry, old available {s4.get('ver')} {s4.get('shared')} {s4.get('shHist')}")
        check("이전 판 필기 보기" in (await pg.locator(".iv-hint [data-iv=shhist]").text_content()), "old edition hint label")
        await pg.click("[data-iv=shhist]"); await pg.wait_for_timeout(2500)
        check(await pg.locator(".iv-ref").count() == 1 and "Ver.2605" in await pg.locator(".iv-ref-sel").text_content(), "old edition panel")
        await pg.screenshot(path=SHOT + "backup_oldver.png")
        check(pg.errs == [], f"backup errs {pg.errs[:3]}")
        await ctx.close(); await b.close()

        # ================= E. 백업찬양 확정 · 수정 · 확정 없이 시작 (화면)
        rpc("backup_update", {"p": {"active": True}}, D[1]); rpc("backup_update", {"p": {"active": False, "candidates": [ng40]}}, D[1])
        lb, lctx = await browser(p, viewport={"width": 1194, "height": 834})
        lp = await login(lctx, "demo01@pole2.test", PW, dest=None)
        mb, mctx = await browser(p, mobile=True)
        mp = await login(mctx, "demo03@pole2.test", PW, dest=None)
        await mp.goto(BASE + "/me.html#worship/backup"); await mp.wait_for_timeout(2500)
        check(await mp.locator(".bk-slot:not(.empty)").count() == 0 and "확정하면" in await mp.locator("#wsBackup").text_content(), "member: hidden before confirm")
        await lp.goto(BASE + "/me.html#worship/backup"); await lp.wait_for_timeout(2500)
        check("확정 전" in await lp.locator(".bk-conf").text_content() and await lp.locator("[data-bk=confirm]").is_enabled(), "leader: 확정 전 + confirm button")
        await lp.screenshot(path=SHOT + "backup_before_confirm.png", full_page=True)
        await lp.locator("[data-bk=confirm]").click(); await lp.wait_for_timeout(2500)
        check(q("select confirmed_at is not null and pub_ver=notified_ver from backup_live") == "t", "confirm via UI + notified")
        check("확정됨" in await lp.locator(".bk-conf").text_content() and await lp.locator("[data-bk=edit]").is_disabled(), "leader: 확정됨, edit disabled")
        n = q("select title from notifications order by id desc limit 1")
        check("후보가 정해졌어요" in n, f"ui confirm notification {n}")
        await mp.reload(); await mp.wait_for_timeout(2500)
        await mp.click('#worshipNav [data-ws="backup"]'); await mp.wait_for_timeout(2000)
        check(await mp.locator(".bk-slot:not(.empty)").count() == 1 and "확정" in await mp.locator("#wsBackup").text_content(), "member sees after confirm")
        sw = await mp.evaluate("document.documentElement.scrollWidth")
        check(sw <= 392, f"phone backup no h-scroll {sw}")
        await mp.screenshot(path=SHOT + "member_backup_phone.png", full_page=True)
        # 후보 더하기 → 수정
        await lp.locator(f'[data-bk-song="{int(q(f"select id from backup_songs where book_id={book2} and code='g54'"))}"]').click(); await lp.wait_for_timeout(1200)
        check("수정 전" in await lp.locator(".bk-conf").text_content() and await lp.locator("[data-bk=edit]").is_enabled(), "edit pending shown")
        check(len(rpc("backup_state_live", {}, D[3])[1]["candidates"]) == 1, "member still sees confirmed one")
        await lp.locator("[data-bk=edit]").click(); await lp.wait_for_timeout(2500)
        n = q("select title||'|'||coalesce(body,'') from notifications order by id desc limit 1")
        check("바뀌었어요" in n and "추가: g54" in n, f"ui edit notification {n}")
        check(len(rpc("backup_state_live", {}, D[3])[1]["candidates"]) == 2, "member sees edited")
        # 확정 없이 시작 → 한 번 묻기
        rpc("backup_update", {"p": {"active": True}}, D[1]); rpc("backup_update", {"p": {"active": False}}, D[1])
        await lp.reload(); await lp.wait_for_timeout(1500); await lp.click('#worshipNav [data-ws="backup"]'); await lp.wait_for_timeout(2000)
        msgs = []
        async def dismiss(d): msgs.append(d.message); await d.dismiss()
        lp.on("dialog", dismiss)
        await lp.locator("[data-bk=start]").click(); await lp.wait_for_timeout(1200)
        check(msgs and "확정 전" in msgs[0] and q("select active from backup_live") == "f", f"start asks once, dismiss keeps idle {msgs[:1]}")
        lp.remove_listener("dialog", dismiss)
        async def accept(d): await d.accept()
        lp.on("dialog", accept)
        await lp.locator("[data-bk=start]").click(); await lp.wait_for_timeout(2500)
        check(q("select active from backup_live") == "t" and q("select service_id is not null from backup_live") == "t", "accepted start without confirm")
        check(await lp.locator(".bk-live").count() == 1 and await lp.locator("#bkBar [data-iv=fix]").count() == 1, "live view has fix button")
        await mp.goto(BASE + "/me.html#worship"); await mp.wait_for_timeout(1500); await mp.click('#worshipNav [data-ws="backup"]'); await mp.wait_for_timeout(2500)
        check(await mp.locator(".bk-livecard").count() >= 1, "member sees live")
        rpc("backup_update", {"p": {"active": False}}, D[1])
        check(lp.errs == [] and mp.errs == [], f"confirm ui errs {lp.errs[:2]} {mp.errs[:2]}")
        await lctx.close(); await lb.close(); await mctx.close(); await mb.close()

        # ================= F. 메트로놈 함께 맞추기 (드럼 ↔ 싱어)
        ab, actx = await browser(p, viewport={"width": 1194, "height": 834})
        ap_ = await login(actx, "demo10@pole2.test", PW, dest=None)
        bb, bctx = await browser(p, viewport={"width": 820, "height": 1180})
        bp_ = await login(bctx, "demo02@pole2.test", PW, dest=None)
        for x in (ap_, bp_):
            await x.goto(BASE + f"/me.html#worship/{sid}"); await x.wait_for_timeout(2000)
            await x.click(".cv-pdfbar"); await x.wait_for_timeout(2500)
        check(await ap_.locator("[data-cvv=sync]").count() == 1 and await bp_.locator("[data-cvv=sync]").count() == 0, "only controller has sync button")
        check(await bp_.locator(".cvv-synctag").count() == 0, "no sync tag yet")
        await ap_.locator("[data-cvv=sync]").click(); await ap_.wait_for_timeout(1500)
        ma = await ap_.evaluate(MT)
        check(ma["sync"] and ma["bpm"] == 72 and ma["mode"] >= 1 and q(f"select on_||'|'||bpm from metro_live where service_id='{sid}'") == "true|72", f"drum turns on sync {ma}")
        await bp_.wait_for_timeout(5000)
        mb_ = await bp_.evaluate(MT)
        check(mb_["sync"] and mb_["bpm"] == 72 and mb_["mode"] == 1 and await bp_.locator(".cvv-synctag").is_visible(), f"singer follows {mb_.get('sync')} {mb_.get('bpm')}")
        ea = await ap_.evaluate("performance.timeOrigin + CONTI.METRO.state.anchor"); eb = await bp_.evaluate("performance.timeOrigin + CONTI.METRO.state.anchor")
        check(abs(ea - eb) < 60, f"same downbeat across devices {ea - eb:.1f}ms")
        n0 = mb_["lastN"]; await bp_.wait_for_timeout(1700)
        check((await bp_.evaluate(MT))["lastN"] >= n0 + 1, "singer blinking")
        await bp_.screenshot(path=SHOT + "metro_follow.png")
        # 싱어가 넘겨도 그대로
        await bp_.keyboard.press("ArrowRight"); await bp_.keyboard.press("ArrowRight"); await bp_.keyboard.press("ArrowRight"); await bp_.wait_for_timeout(1200)
        check((await bp_.evaluate(MT))["bpm"] == 72 and q(f"select bpm from metro_live where service_id='{sid}'") == "72", "member page turn doesn't change bpm")
        # 소리는 각자
        await bp_.locator("#cvvBpm .cvv-dot").click(); await bp_.wait_for_timeout(300)
        check((await bp_.evaluate(MT))["mode"] == 2 and (await ap_.evaluate(MT))["mode"] == 1, "sound is personal")
        # 드럼이 다음 곡 → BPM 따라감
        await ap_.locator(".cvv-jump button").nth(1).click(); await ap_.wait_for_timeout(1500)
        check(q(f"select bpm||'|'||meter from metro_live where service_id='{sid}'") == "90|6/8", "controller page turn follows next song bpm")
        await bp_.wait_for_timeout(5000)
        mb2 = await bp_.evaluate(MT)
        check(mb2["bpm"] == 90 and mb2["beats"] == 6 and mb2["mode"] == 2, f"singer follows new bpm, keeps sound {mb2.get('bpm')} {mb2.get('mode')}")
        # 적용찬양 쪽에서도 깜빡임 유지
        await ap_.locator(".cvv-jump button.applied").first.click(); await ap_.wait_for_timeout(800)
        check((await ap_.evaluate(MT))["sync"] and await ap_.locator("#cvvBpm [data-cvv=sync]").is_visible(), "sync stays on applied page")
        await ap_.screenshot(path=SHOT + "metro_controller.png")
        await ap_.locator("#cvvBpm [data-cvv=sync]").click(); await ap_.wait_for_timeout(1500)
        check(q(f"select on_ from metro_live where service_id='{sid}'") == "f" and not (await ap_.evaluate(MT))["sync"], "controller turns off")
        await bp_.wait_for_timeout(5000)
        mb3 = await bp_.evaluate(MT)
        check(not mb3["sync"] and mb3["mode"] == 0 and await bp_.locator(".cvv-synctag").count() == 0, "singer stops")
        check(ap_.errs == [] and bp_.errs == [], f"metro errs {ap_.errs[:2]} {bp_.errs[:2]}")
        await actx.close(); await ab.close(); await bctx.close(); await bb.close()
        # 폰 폭: 함께 칩이 넘치지 않음
        rpc("metro_set", {"p_service": sid, "p": {"on": True, "bpm": 72, "meter": "4/4", "ord": 1}}, D[10])
        b, ctx = await browser(p, mobile=True)
        pg = await login(ctx, "demo03@pole2.test", PW, dest=None)
        await pg.goto(BASE + f"/me.html#worship/{sid}"); await pg.wait_for_timeout(2000)
        await pg.click(".cv-pdfbar"); await pg.wait_for_timeout(3000)
        sw = await pg.evaluate("document.documentElement.scrollWidth")
        check(sw <= 392 and await pg.locator(".cvv-synctag").is_visible(), f"phone sync tag fits {sw}")
        await pg.screenshot(path=SHOT + "metro_phone.png")
        await ctx.close(); await b.close()
        rpc("metro_set", {"p_service": sid, "p": {"on": False}}, D[10])

        # ================= G. 알림 설정 화면 · 공유 링크 화면
        b, ctx = await browser(p)
        ad = await login(ctx, "admin@x.com", "adminpass")
        await navclick(ad, "notify"); await ad.wait_for_timeout(1500)
        await ad.locator('[data-ntab="settings"]').click(); await ad.wait_for_timeout(1500)
        txt = await ad.locator(".nlist").text_content()
        check("적용찬양 올라옴" in txt and "백업찬양 확정" in txt and "백업찬양 수정" in txt, "notify settings list new kinds")
        await ad.locator('[data-nk="backup_pick"]').click(); await ad.wait_for_timeout(800)
        check("라인업" in await ad.locator("#nBody").text_content(), "backup_pick info")
        await ad.screenshot(path=SHOT + "notify_settings.png", full_page=True)
        # 027(v27) 확인: 멤버 상세 '최근 2년' (지난 라인업 연결)
        await navclick(ad, "members"); await ad.wait_for_timeout(2000)
        await ad.locator("#content a.mrow[href^=\"#member/\"]").first.click(); await ad.wait_for_timeout(2500)
        check("최근 2년" in await ad.locator("#content").text_content(), "v27 member detail recent 2 years")
        await ad.screenshot(path=SHOT + "member_detail.png", full_page=True)
        check(ad.errs == [], f"admin errs {ad.errs[:3]}")
        await ctx.close(); await b.close()
        b, ctx = await browser(p, viewport={"width": 1194, "height": 834})
        sp = await ctx.new_page(); errs = []; sp.on("pageerror", lambda e: errs.append(str(e)))
        await sp.goto(BASE + f"/share.html?t={tk}"); await sp.wait_for_timeout(3500)
        await sp.screenshot(path=SHOT + "share.png", full_page=True)
        check(errs == [], f"share errs {errs[:2]}")
        await ctx.close(); await b.close()

if __name__ == "__main__":
    asyncio.run(main())
