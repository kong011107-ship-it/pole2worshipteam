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
SHOT = "/home/claude/tests/v29_"
FX = "/home/claude/tests/fx/"
PW = "pole2test!"
U = lambda: str(uuid.uuid4())
CID = lambda: uuid.uuid4().hex[:24]
STK = lambda: {"t": "p", "c": "#1F5C99", "w": 30, "p": [1000, 1000, 3000, 1500, 5000, 1200]}
ST = "document.querySelector('.cv-viewer')._viewer.ink.state"
VS = "document.querySelector('.cv-viewer')._viewer.state"
G = globals()
def sent(): return [json.loads(l) for l in q("select row_to_json(s) from realtime.sent s order by id").splitlines() if l]

def setup():
    T = tok("admin@x.com", "adminpass")
    st, r = http("/api/demo", {"action": "seed"}, T); print("seed", st, r.get("members"))
    D = {n: tok(f"demo{n:02d}@pole2.test", PW) for n in range(1, 13)}
    mid = {n: q(f"select id from members where email='demo{n:02d}@pole2.test'") for n in range(1, 13)}
    sun = q("select min(service_date) from services where ministry_id is null and status='published' and service_date >= current_date")
    sid = q(f"select id from services where service_date='{sun}' and ministry_id is null")
    fix_lineup(q, sid)
    nxt = str(datetime.date.fromisoformat(sun) + datetime.timedelta(days=7))
    q(f"insert into services(service_date, status) values ('{nxt}', 'published') on conflict do nothing")
    q(f"update services set status='published' where service_date='{nxt}' and ministry_id is null")
    sid2 = q(f"select id from services where service_date='{nxt}' and ministry_id is null")
    fix_lineup(q, sid2)
    return T, D, mid, sun, sid, nxt, sid2

async def main():
    T, D, mid, sun, sid, nxt, sid2 = setup()
    print("sunday", sun, sid, "next", nxt)
    G = globals(); G.update(T=T, D=D, mid=mid, sun=sun, sid=sid, nxt=nxt, sid2=sid2)

    # ================= 0. 콘티 올리기 (레퍼런스 · 메들리 레퍼런스)
    p1, p2, p3 = f"sheets/162/{U()}.pdf", f"sheets/18/{U()}.pdf", f"sheets/20/{U()}.pdf"
    for p in (p1, p2, p3): up(p, FX + "conti5.pdf", D[1], "application/pdf")
    st, md_ = rpc("save_medley", {"p_id": None, "p_data": {"title": "", "songs": [{"song_id": 18, "key": "A"}, {"song_id": 20, "key": "A"}], "ref_yt": "MEDLEYref01", "ref_start": 42}}, D[1])
    check(st == 200, f"medley saved {st} {md_}")
    G["medley_id"] = md_["id"]
    st, r = rpc("save_setlist", {"p_service": sid, "p_data": {"pages": 5, "items": [
        {"song_id": 162, "key": "G", "bpm": 72, "meter": "4/4", "refs": [["SONGref0001", 15, ""]], "new_sheet": {"name": "공준혁 G", "path": p1, "pages": 2, "size": 100}, "page_from": 1, "page_to": 2},
        {"song_id": 18, "key": "A", "bpm": 90, "meter": "6/8", "refs": [["SONGref0002", 0, ""]], "medley_id": md_["id"], "new_sheet": {"name": "메들리 A", "path": p2, "pages": 2, "size": 100}, "page_from": 3, "page_to": 4},
        {"song_id": 20, "key": "A", "join_prev": True, "medley_id": md_["id"], "new_sheet": {"name": "둘째 A", "path": p3, "pages": 1, "size": 100}, "page_from": 5, "page_to": 5}]}, "p_publish": True, "p_base": None}, D[1])
    check(st == 200, f"publish conti {st} {r}")
    c = rpc("conti_one", {"p_service": sid}, D[2])[1]
    its = c["setlist"]["items"]
    check(its[1]["medley_ref"] == ["MEDLEYref01", 42], f"medley ref in conti_one {its[1].get('medley_ref')}")
    check(c["flow"] is None and c["entrance"] is False and c["extras"] == [], f"default flow/entrance/extras {c.get('flow')} {c.get('entrance')}")

    # ================= 1. 예배 진행곡 (축복 · 봉헌 · 축도 · 등단 · 성찬)
    pp = f"proc/{U()}.pdf"; up(pp, FX + "proc.pdf", T, "application/pdf")
    for kind, title in [("blessing", "축복합니다"), ("offering", "드리네"), ("benediction", "아론의 축복"), ("entrance", "주님 앞에"), ("communion", "성찬1"), ("communion2", "성찬2")]:
        rest("worship_proc", T, {"kind": kind, "title": title, "path": pp, "pages": 1, "start_date": "2026-01-01"}, "POST")
    pid = {k: int(q(f"select id from worship_proc where kind='{k}' order by id desc limit 1")) for k in ("blessing", "offering", "benediction", "entrance")}
    G["pid"] = pid
    c = rpc("conti_one", {"p_service": sid}, D[2])[1]
    check({x["kind"] for x in c["proc"]} >= {"blessing", "offering", "benediction", "entrance"}, "proc list includes entrance (screen decides)")

    # ================= 2. 등단송 쓰기
    check(rpc("set_entrance", {"p_service": sid, "p_on": True}, D[2])[0] >= 400, "singer cannot toggle entrance")
    st, r = rpc("set_entrance", {"p_service": sid, "p_on": True}, D[1])
    check(st == 200 and r is True and q(f"select entrance_on from services where id='{sid}'") == "t", f"leader turns entrance on {r}")
    check(rpc("set_entrance", {"p_service": sid, "p_on": True}, D[6])[1] is True, "band master can toggle")
    # 사역은 기본 켜짐 → 끄면 false, 다시 켜면 null(자동)
    mins = q("select s.id from services s where s.ministry_id is not null order by s.service_date limit 1")
    if mins:
        st, r = rpc("set_entrance", {"p_service": mins, "p_on": False}, T); check(st == 200 and r is False, "admin turns ministry entrance off")
        rpc("set_entrance", {"p_service": mins, "p_on": True}, T); check(q(f"select entrance_on is null from services where id='{mins}'") == "t", "default stored as null")

    # ================= 3. 특별순서 (RLS · Storage · 필기 · 메모)
    xp = f"extra/{sid}/{U()}.jpg"
    check(up(xp, FX + "ap1.jpg", D[2], "image/jpeg")[0] != 200, "singer cannot upload extra image")
    check(up(xp, FX + "ap1.jpg", D[1], "image/jpeg")[0] == 200, "leader uploads extra image")
    check(up(f"extra/{sid2}/{U()}.jpg", FX + "ap1.jpg", D[8], "image/jpeg")[0] != 200, "band cannot upload extra")
    st, r = rest("service_extras", D[2], {"service_id": sid, "title": "파송식", "images": [xp]}, "POST", "return=representation")
    check(st >= 400, f"singer cannot add extra {st}")
    st, r = rest("service_extras", D[1], {"service_id": sid, "title": " 파송식 ", "memo": "파송 기도 후", "key": "D", "images": [xp]}, "POST", "return=representation")
    check(st in (200, 201) and r[0]["title"] == "파송식", f"leader adds extra {st} {r}")
    xid = r[0]["id"]; G["xid"] = xid
    check(rest("service_extras", D[1], {"service_id": sid2, "title": "x", "images": [xp]}, "POST")[0] >= 400, "image path must match service")
    check(rest("service_extras", D[1], {"service_id": sid, "title": "x", "path": f"extra/{sid2}/{U()}.pdf", "pages": 1}, "POST")[0] >= 400, "pdf path must match service")
    check(len(rest(f"service_extras?service_id=eq.{sid}", D[3])[1]) == 1, "members read extras")
    ck = CID()
    st, r = rpc("ink_put", {"p_service": sid, "p_target": f"x:{xid}", "p_ver": None, "p_ops": {"add": [{"cid": ck, "page": 1, "stroke": STK()}]}}, D[8])
    check(st == 200 and r["added"] == 1, f"band writes extra ink {r}")
    check(rpc("ink_put", {"p_service": sid, "p_target": f"x:{xid}", "p_ver": None, "p_ops": {"add": [{"cid": CID(), "page": 2, "stroke": STK()}]}}, D[8])[0] >= 400, "extra page beyond images rejected")
    check(rpc("ink_put", {"p_service": sid2, "p_target": f"x:{xid}", "p_ver": None, "p_ops": {"add": [{"cid": CID(), "page": 1, "stroke": STK()}]}}, T)[0] >= 400, "extra of other service rejected")
    check(rpc("ink_put", {"p_service": sid, "p_target": f"x:{xid}", "p_ver": None, "p_ops": {"add": [{"cid": CID(), "page": 1, "stroke": STK()}]}}, D[2])[0] >= 400, "singer cannot write extra ink")
    st, r = rest("sheet_notes", D[3], {"key": f"x:{xid}", "page": 1, "strokes": [STK()]}, "POST")
    check(st in (200, 201), f"memo on extra allowed {st} {r}")
    # 사진을 바꾸면 필기 지움
    xp2 = f"extra/{sid}/{U()}.jpg"; up(xp2, FX + "ap2.jpg", D[1], "image/jpeg")
    rest(f"service_extras?id=eq.{xid}", D[1], {"images": [xp2, xp]}, "PATCH")
    check(q(f"select count(*) from ink_extra where target='x:{xid}'") == "0", "image change clears extra ink")
    rpc("ink_put", {"p_service": sid, "p_target": f"x:{xid}", "p_ver": None, "p_ops": {"add": [{"cid": CID(), "page": 2, "stroke": STK()}]}}, D[1])
    # 두 번째 특별순서 (악보 없이) → 지우면 필기도
    st, r = rest("service_extras", D[6], {"service_id": sid, "title": "광고"}, "POST", "return=representation")
    x2 = r[0]["id"]
    check(st in (200, 201), "band master adds extra without sheet")

    # ================= 4. 예배 순서
    c = rpc("conti_one", {"p_service": sid}, D[2])[1]
    check([x["id"] for x in c["extras"]] == [xid, x2], "conti_one extras")
    check(rpc("set_flow", {"p_service": sid, "p_flow": ["conti", "applied"]}, D[2])[0] >= 400, "singer cannot set flow")
    check(rpc("set_flow", {"p_service": sid, "p_flow": ["conti", "bogus"]}, D[1])[0] >= 400, "bad key rejected")
    check(rpc("set_flow", {"p_service": sid, "p_flow": ["conti", "conti"]}, D[1])[0] >= 400, "duplicate rejected")
    check(rpc("set_flow", {"p_service": sid, "p_flow": ["conti", "x:999999"]}, D[1])[0] >= 400, "foreign extra rejected")
    flow = ["conti", "applied", "blessing", f"x:{xid}", "entrance", "backup", "communion", "communion2", "offering", "benediction", f"x:{x2}"]
    st, r = rpc("set_flow", {"p_service": sid, "p_flow": flow}, D[1])
    check(st == 200 and r["flow"] == flow and r["flow_by"] == q(f"select name from members where id='{mid[1]}'"), f"leader sets flow {st} {r}")
    c = rpc("conti_one", {"p_service": sid}, D[2])[1]
    check(c["flow"] == flow and c["flow_at"] > c["setlist"]["published_at"], "flow stored, after publish")
    check(rpc("set_flow", {"p_service": sid, "p_flow": []}, D[6])[1]["flow"] is None, "band master resets to default")
    rpc("set_flow", {"p_service": sid, "p_flow": flow}, D[1])

    # ================= 5. 진행곡 지우기
    rest("worship_proc", T, {"kind": "offering", "title": "(지움)", "removed": True, "start_date": nxt}, "POST")
    c1 = rpc("conti_one", {"p_service": sid}, D[2])[1]; c2 = rpc("conti_one", {"p_service": sid2}, D[2])[1]
    check(any(x["kind"] == "offering" for x in c1["proc"]) and not any(x["kind"] == "offering" for x in c2["proc"]), "removed from that date only")
    check(rpc("ink_put", {"p_service": sid2, "p_target": f"p:{pid['offering']}", "p_ver": None, "p_ops": {"add": [{"cid": CID(), "page": 1, "stroke": STK()}]}}, D[1])[0] >= 400, "removed proc not writable")
    check(rpc("ink_put", {"p_service": sid, "p_target": f"p:{pid['offering']}", "p_ver": None, "p_ops": {"add": [{"cid": CID(), "page": 1, "stroke": STK()}]}}, D[1])[0] == 200, "earlier service still writable")
    check(rest("worship_proc", D[1], {"kind": "offering", "title": "(지움)", "removed": True, "start_date": nxt}, "POST")[0] >= 400, "only admin removes proc")

    # ================= 6. BPM · 박자 (모든 순서)
    aimg = f"applied/{sid}/{U()}.jpg"; up(aimg, FX + "ap1.jpg", D[1], "image/jpeg")
    rest("applied_songs", D[1], {"service_id": sid, "ord": 1, "title": "주의 손에", "key": "D", "images": [aimg]}, "POST")
    aid = int(q(f"select id from applied_songs where service_id='{sid}' and title='주의 손에'")); G["aid"] = aid
    check(rpc("set_item_bpm", {"p_service": sid, "p_target": f"a:{aid}", "p_bpm": 68, "p_meter": None}, D[2])[0] >= 400, "singer cannot set bpm")
    st, r = rpc("set_item_bpm", {"p_service": sid, "p_target": f"a:{aid}", "p_bpm": 68, "p_meter": None}, D[8])
    check(st == 200 and r["bpm"] == 68 and r["meter"] == "4/4", f"band sets applied bpm {r}")
    check(rpc("set_item_bpm", {"p_service": sid, "p_target": f"p:{pid['blessing']}", "p_bpm": 80, "p_meter": "3/4"}, D[1])[1]["meter"] == "3/4", "leader sets proc bpm")
    check(q(f"select bpm||meter from worship_proc where id={pid['blessing']}") == "803/4", "proc bpm stored on song")
    check(rpc("set_item_bpm", {"p_service": sid, "p_target": f"x:{xid}", "p_bpm": 100, "p_meter": "6/8"}, D[10])[0] == 200, "drum sets extra bpm")
    check(rpc("set_item_bpm", {"p_service": sid2, "p_target": f"a:{aid}", "p_bpm": 70, "p_meter": None}, D[1])[0] >= 400, "applied of other service rejected")
    check(rpc("set_item_bpm", {"p_service": sid, "p_target": f"a:{aid}", "p_bpm": 400, "p_meter": None}, D[1])[0] >= 400, "bpm range")
    # 같은 이름의 적용찬양 → 지난 BPM 자동
    aimg2 = f"applied/{sid2}/{U()}.jpg"; up(aimg2, FX + "ap1.jpg", T, "image/jpeg")
    rest("applied_songs", T, {"service_id": sid2, "ord": 1, "title": "주의손에", "images": [aimg2]}, "POST")
    check(q(f"select bpm||meter from applied_songs where service_id='{sid2}'") == "684/4", "applied bpm autofill by norm")
    # 진행곡 BPM은 다음 주에도 (그 곡을 바꾸기 전까지)
    c2 = rpc("conti_one", {"p_service": sid2}, D[2])[1]
    check(next(x for x in c2["proc"] if x["kind"] == "blessing")["bpm"] == 80, "proc bpm carries to next week")
    check(next(x for x in rpc("conti_one", {"p_service": sid}, D[2])[1]["extras"] if x["id"] == xid)["bpm"] == 100, "extra bpm in conti_one")
    # 지운 BPM
    rpc("set_item_bpm", {"p_service": sid, "p_target": f"x:{x2}", "p_bpm": 90, "p_meter": None}, D[1])
    rpc("set_item_bpm", {"p_service": sid, "p_target": f"x:{x2}", "p_bpm": None, "p_meter": None}, D[1])
    check(q(f"select coalesce(bpm::text,'-')||coalesce(meter,'-') from service_extras where id={x2}") == "--", "bpm cleared")

    # ================= 7. 백업찬양 · BPM · 실시간(Broadcast)
    bp = f"book/{U()}.pdf"; up(bp, FX + "book.pdf", T, "application/pdf")
    songs = [{"code": "g40", "title": "비 준비하시니", "key": "g", "topic": 4, "page": 3}, {"code": "g51", "title": "주의 이름 높이며", "key": "g", "topic": 5, "page": 4},
             {"code": "g54", "title": "오직 주의 사랑에 매여", "key": "g", "topic": 5, "page": 6}]
    rpc("backup_book_save", {"p_label": "Ver.2605", "p_path": bp, "p_pages": 8, "p_size": 1000, "p_topics": None, "p_songs": songs}, T)
    book = q("select id from backup_books where active")
    g = {cc: int(q(f"select id from backup_songs where book_id={book} and code='{cc}'")) for cc in ("g40", "g51", "g54")}
    G.update(g=g, book=book)
    tk = re.sub(r"[^A-Za-z0-9_-]", "", uuid.uuid4().hex + uuid.uuid4().hex)[:32]; G["tk"] = tk
    rest("share_links", T, {"token": tk, "label": "자막팀", "active": True}, "POST")
    topic = q(f"select live_topic from share_links where token='{tk}'")
    check(len(topic) == 32, f"share link has topic {topic}")
    q("delete from realtime.sent")
    rpc("backup_update", {"p": {"candidates": [g["g40"], g["g51"]]}}, D[1])
    s1 = [x for x in sent() if x["event"] == "live"]
    check(len(s1) == 1 and s1[0]["topic"] == f"share-{topic}" and s1[0]["private"] is False, f"broadcast on backup change {s1}")
    check(s1 and s1[0]["payload"]["candidates"] == [] and s1[0]["payload"]["active"] is False, f"draft not leaked {s1[0]['payload'] if s1 else None}")
    rpc("backup_confirm", {}, D[1])
    check(sent()[-1]["payload"]["candidates"] == [g["g40"], g["g51"]], "confirmed candidates broadcast")
    st, r = rpc("set_item_bpm", {"p_service": sid, "p_target": "b:g40", "p_bpm": 76, "p_meter": None}, D[8])
    check(st == 200 and q("select bpm from backup_bpm where code='g40'") == "76", f"band sets backup bpm by code {r}")
    check(rpc("set_item_bpm", {"p_service": sid2, "p_target": "b:g40", "p_bpm": 76, "p_meter": None}, D[1])[0] >= 400, "backup bpm only for backup service")
    check(len(rest("backup_bpm?select=code", D[3])[1]) == 1, "members read backup bpm")
    rpc("backup_update", {"p": {"active": True, "now": f"b:{g['g40']}", "next": f"b:{g['g51']}"}}, D[1])
    pl = sent()[-1]["payload"]
    check(pl["active"] and pl["now"] == f"b:{g['g40']}" and pl["next"] == f"b:{g['g51']}" and pl["service_id"] == sid, f"live now/next broadcast {pl}")
    # 링크를 새로 바꾸면 채널도
    newt = re.sub(r"[^A-Za-z0-9_-]", "", uuid.uuid4().hex + uuid.uuid4().hex)[:30]
    rest(f"share_links?token=eq.{tk}", T, {"token": newt}, "PATCH")
    topic2 = q(f"select live_topic from share_links where token='{newt}'")
    check(topic2 and topic2 != topic, "renew token renews topic")
    rest(f"share_links?token=eq.{newt}", T, {"token": tk}, "PATCH")
    topic = q(f"select live_topic from share_links where token='{tk}'"); G["topic"] = topic
    # 꺼진 링크엔 안 보냄
    rest("share_links", T, {"token": "OFF" + uuid.uuid4().hex, "label": "끊김", "active": False}, "POST")
    q("delete from realtime.sent")
    rpc("backup_update", {"p": {"now": f"b:{g['g51']}", "next": None}}, D[1])
    check({x["topic"] for x in sent()} == {f"share-{topic}"}, "inactive links skipped")
    q("delete from realtime.sent")
    rpc("save_setlist_sheets", {"p_service": sid, "p_data": {"items": [{"song_id": i["song_id"], "sheet_id": i["sheet_id"], "page_from": i["page_from"], "page_to": i["page_to"]} for i in rpc("conti_one", {"p_service": sid}, D[1])[1]["setlist"]["items"]]}, "p_base": None}, D[8])
    check(any(x["event"] == "reload" for x in sent()), "setlist change broadcasts reload")
    q("delete from realtime.sent")
    rpc("set_flow", {"p_service": sid, "p_flow": flow}, D[1])
    check(any(x["event"] == "reload" for x in sent()), "flow change broadcasts reload")
    rpc("backup_update", {"p": {"active": False}}, D[1])
    rpc("backup_update", {"p": {"candidates": [g["g40"], g["g51"]]}}, D[1]); rpc("backup_confirm", {}, D[1])

    # ================= 8. 공유 링크 API
    st, sh = http("/api/conti", {"action": "share", "t": tk})
    check(st == 200 and sh["rt"]["topic"] == f"share-{topic}", f"share rt topic {st}")
    f = next(s for s in sh["services"] if s["id"] == sid)
    check(f["flow"] == flow and f["entrance"] is True, f"share flow {f['flow']}")
    check([x["ref"] for x in f["setlist"]["items"]] == [["SONGref0001", 15], ["MEDLEYref01", 42], None], f"share refs (medley ref, join none) {[x['ref'] for x in f['setlist']['items']]}")
    check(f["setlist"]["items"][0]["sheet"]["base"] == f["setlist"]["items"][0]["sheet"]["id"], "sheet base for memo key")
    ex = next(x for x in f["extras"] if x["id"] == xid)
    check(ex["bpm"] == 100 and len(ex["ink"]) == 1 and ex["images"][0] in sh["urls"], f"share extra bpm/ink/url {ex}")
    check(next(x for x in f["proc"] if x["kind"] == "blessing")["bpm"] == 80 and any(x["kind"] == "entrance" for x in f["proc"]), "share proc bpm + entrance on")
    f2 = next(s for s in sh["services"] if s["id"] == sid2)
    check(not any(x["kind"] == "offering" for x in f2["proc"]) and not any(x["kind"] == "entrance" for x in f2["proc"]), "share: removed proc + entrance off next week")
    check(f["applied"][0]["bpm"] == 68 and f["applied"][0]["id"] == aid, "share applied bpm/id")
    check(sh["backup"]["service_id"] == sid and next(x for x in sh["backup"]["songs"] if x["code"] == "g40")["bpm"] == 76, "share backup service + bpm")
    v1 = http("/api/conti", {"action": "share-live", "t": tk})[1]["ver"]
    rpc("set_flow", {"p_service": sid, "p_flow": []}, D[1])
    v2 = http("/api/conti", {"action": "share-live", "t": tk})[1]["ver"]
    rest(f"service_extras?id=eq.{x2}", D[1], {"memo": "새 메모"}, "PATCH")
    v3 = http("/api/conti", {"action": "share-live", "t": tk})[1]["ver"]
    check(v1 != v2 != v3, "share-live ver follows flow/extras")
    rpc("set_flow", {"p_service": sid, "p_flow": flow}, D[1])
    # 지우면 순서에서도 빠짐
    q(f"insert into ink_extra(target, page, cid, stroke, valid_from) values ('x:{x2}', 1, '{CID()}', '{json.dumps(STK())}', '{sun}')")
    rest(f"service_extras?id=eq.{x2}", D[1], method="DELETE")
    check(q(f"select count(*) from ink_extra where target='x:{x2}'") == "0", "extra delete clears ink")
    f = next(s for s in http("/api/conti", {"action": "share", "t": tk})[1]["services"] if s["id"] == sid)
    check(f"x:{x2}" not in f["flow"] and f["flow"][-1] == "benediction", f"deleted extra dropped from flow {f['flow']}")

    G.update(flow=[k for k in flow if k != f"x:{x2}"], aid=aid, xid=xid)
    await browser_part()
    print("ok", ok, "bad", bad)

async def open_viewer(pg, sid_, at=None):
    await pg.goto(BASE + f"/me.html#worship/{sid_}"); await pg.wait_for_timeout(2200)
    if at: await pg.locator(f'#cvFlow [data-cv-at="{at}"]').click()
    else: await pg.click(".cv-pdfbar")
    await pg.wait_for_timeout(2500)

async def browser_part():
    async with async_playwright() as p:
        # ================= A. 인도자: 예배 순서 카드 · 순서 고치기 · 특별순서 더하기 · 등단송 끄기
        b, ctx = await browser(p, viewport={"width": 1194, "height": 834})
        pg = await login(ctx, "demo01@pole2.test", PW, dest=None)
        pg.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
        await pg.goto(BASE + f"/me.html#worship/{sid}"); await pg.wait_for_timeout(2500)
        rows = await pg.locator("#cvFlow .cv-prow .cv-ptag").all_text_contents()
        check(rows[:5] == ["콘티", "적용", "축복송", "특별", "등단송"], f"flow card order {rows}")
        check(await pg.locator("#cvFlow .cv-flowchg").count() == 1, "flow card shows 순서 바뀜")
        check("확정" in (await pg.locator("#cvFlow .cv-bkst").text_content()), f"backup row status {await pg.locator('#cvFlow .cv-bkst').text_content()}")
        await pg.screenshot(path=SHOT + "flow_card.png", full_page=True)
        await pg.click("[data-cv-order]"); await pg.wait_for_timeout(1500)
        keys = await pg.evaluate("[...document.querySelectorAll('[data-fo-k]')].map(r => r.dataset.foK)")
        check(keys == flow, f"order editor lists flow {keys}")
        # ↓ 버튼: 적용찬양을 아래로
        await pg.locator('[data-fo-k="applied"] [data-fo-down]').click(); await pg.wait_for_timeout(1500)
        f1 = json.loads(q(f"select array_to_json(flow) from services where id='{sid}'"))
        check(f1[1] == "blessing" and f1[2] == "applied", f"down button saves {f1[:4]}")
        # 끌어서: 특별순서(파송식)를 맨 아래로
        gr = await pg.locator(f'[data-fo-k="x:{xid}"] [data-fo-grip]').bounding_box()
        last = await pg.locator('#foList .fo-row').last.bounding_box()
        await pg.mouse.move(gr["x"] + gr["width"] / 2, gr["y"] + gr["height"] / 2); await pg.mouse.down()
        for k in range(1, 9): await pg.mouse.move(gr["x"] + gr["width"] / 2, gr["y"] + (last["y"] + last["height"] - gr["y"]) * k / 8 + 4, steps=2)
        await pg.mouse.up(); await pg.wait_for_timeout(1500)
        f2 = json.loads(q(f"select array_to_json(flow) from services where id='{sid}'"))
        check(f2[-1] == f"x:{xid}", f"drag saves {f2}")
        # 등단송 끄기
        await pg.locator("#foEnt").uncheck(); await pg.wait_for_timeout(1500)
        check(q(f"select coalesce(entrance_on::text, 'null') from services where id='{sid}'") == "null", "entrance off (= sunday default)")
        # 특별순서 더하기 (사진 2장)
        await pg.click('[data-fo="add"]'); await pg.wait_for_timeout(300)
        await pg.fill("#fxT", "세례식"); await pg.fill("#fxK", "E"); await pg.fill("#fxB", "84"); await pg.fill("#fxM", "세례 후 1절")
        await pg.set_input_files("#fxF", [FX + "ap1.jpg", FX + "ap2.jpg"])
        await pg.click('[data-fo="save"]'); await pg.wait_for_timeout(3000)
        r = q(f"select title||'|'||key||'|'||bpm||'|'||meter||'|'||cardinality(images) from service_extras where service_id='{sid}' and title='세례식'")
        check(r == "세례식|E|84|4/4|2", f"extra added via UI {r}")
        x3 = int(q(f"select id from service_extras where service_id='{sid}' and title='세례식'")); G["x3"] = x3
        keys = await pg.evaluate("[...document.querySelectorAll('[data-fo-k]')].map(r => r.dataset.foK)")
        check(keys.index(f"x:{x3}") == keys.index("benediction") - 1, f"new extra placed before benediction {keys}")
        await pg.screenshot(path=SHOT + "order_editor.png", full_page=True)
        # 특별순서 PDF로 고치기
        await pg.locator(f'[data-fx="{x3}"] [data-fxa="edit"]').click(); await pg.wait_for_timeout(300)
        await pg.set_input_files("#fxF", [FX + "proc.pdf"])
        await pg.click('[data-fo="save"]'); await pg.wait_for_timeout(3000)
        check(q(f"select (path like 'extra/{sid}/%')::text||pages||coalesce(cardinality(images),0) from service_extras where id={x3}") == "true10", "extra changed to pdf")
        await pg.click("[data-fo-close]"); await pg.wait_for_timeout(1500)
        rows = await pg.locator("#cvFlow .cv-prow .cv-ptag").all_text_contents()
        check(rows[-1] == "특별" and rows[-2] == "축도송" and rows[-3] == "특별" and await pg.locator("#cvFlow .cv-prow.dim").count() == 1, f"card follows order, entrance dim for leader {rows}")
        check(pg.errs == [], f"leader errs {pg.errs[:3]}")
        await ctx.close(); await b.close()

        # ================= B. 팀원 악보 보기: 순서대로 · 백업찬양 합치기 · 레퍼런스 · BPM
        b, ctx = await browser(p, viewport={"width": 1194, "height": 834})
        pg = await login(ctx, "demo03@pole2.test", PW, dest=None)
        await open_viewer(pg, sid)
        vs = await pg.evaluate(VS)
        want = ["c:0", "c:1", "c:2", "p:blessing", f"a:{aid}", "backup", "p:communion", "p:communion2", "p:offering", f"x:{x3}", "p:benediction", f"x:{xid}"]
        ids = vs["ids"]
        exp = []
        for w in want:
            if w == "backup": exp += [f"b:{g['g40']}", f"b:{g['g51']}"]
            elif w.startswith("p:communion") and q(f"select public.has_communion('{sid}')") != "t": continue
            else: exp.append(w)
        check(ids == exp, f"viewer order {ids} vs {exp}")
        check(await pg.locator("#cvvRef").is_visible() and "SONGref0001" in (await pg.locator("#cvvRef").get_attribute("href")) and (await pg.locator("#cvvRef").get_attribute("target")) == "_blank", "reference button song 1")
        await pg.locator('.cvv-jump [data-cvv-song="1"]').click(); await pg.wait_for_timeout(1200)
        check("MEDLEYref01?t=42" in (await pg.locator("#cvvRef").get_attribute("href")), "medley reference")
        await pg.locator(".cvv-jump button.applied").first.click(); await pg.wait_for_timeout(1200)
        check(await pg.locator("#cvvRef").is_hidden(), "no reference on applied")
        check("♩=68" in (await pg.locator("#cvvBpm").text_content()) and await pg.locator("#cvvBpm .cvv-dot").count() == 1, "applied BPM + metronome dot")
        check(await pg.locator("#cvvBpm [data-cvv=bpm]").is_disabled(), "singer cannot edit bpm")
        await pg.locator(".cvv-jump button.backup").first.click(); await pg.wait_for_timeout(1800)
        s3 = await pg.evaluate(ST)
        check(s3["target"] == "b:g40" and s3["ver"] == book, f"backup item in viewer with shared target {s3.get('target')}")
        check("♩=76" in (await pg.locator("#cvvBpm").text_content()), "backup BPM by code")
        await pg.locator(".cvv-jump button.extra").first.click(); await pg.wait_for_timeout(1500)
        check("♩=84" in (await pg.locator("#cvvBpm").text_content()) and (await pg.evaluate(ST))["key"] == f"x:{x3}", "extra item bpm + memo key")
        await pg.screenshot(path=SHOT + "viewer_extra.png")
        # 앞뒤 쪽 미리 그림
        check(await pg.evaluate("INK._RC.size") >= 2, f"render cache warmed {await pg.evaluate('INK._RC.size')}")
        # 미리 받아 둔 악보 (Cache Storage)
        keys_ = await pg.evaluate("caches.open('pole2-sheets-v1').then(c => c.keys()).then(k => k.map(r => new URL(r.url).pathname))")
        check(any(k.endswith(".pdf") and "/__sheets/sheets/" in k for k in keys_) and any("/__sheets/extra/" in k for k in keys_), f"sheets cached {len(keys_)}")
        idx = await pg.evaluate("JSON.parse(localStorage.getItem('pole2.sheets.idx') || '{}')")
        check(len(idx) >= 3 and all(v["n"] > 0 for v in idx.values()), f"cache index {len(idx)}")
        check(pg.errs == [], f"member viewer errs {pg.errs[:3]}")
        G.update(mpg=pg, mctx=ctx, mb=b)

        # ================= C. 기도회: 막대 · 따라가기 · 자유 이동 · 끝
        ib, ictx = await browser(p, viewport={"width": 1194, "height": 834})
        ipg = await login(ictx, "demo08@pole2.test", PW, dest=None)
        await open_viewer(ipg, sid)
        check(await ipg.locator("#cvvLive").is_hidden(), "no live bar before meeting")
        rpc("backup_update", {"p": {"active": True, "now": f"b:{g['g40']}", "next": f"b:{g['g51']}"}}, D[1])
        await ipg.wait_for_timeout(7500)
        check(await ipg.locator("#cvvLive .cvv-lv-go").is_visible() and "비 준비하시니" in await ipg.locator("#cvvLive").text_content(), "live bar appears with now song")
        vs0 = await ipg.evaluate(VS)
        check(vs0["item"] == "c:0" and not vs0["follow"], "not dragged along when meeting starts")
        await ipg.screenshot(path=SHOT + "live_bar.png")
        await ipg.locator("#cvvLive .cvv-lv-go").click(); await ipg.wait_for_timeout(1200)
        vs1 = await ipg.evaluate(VS)
        check(vs1["item"] == f"b:{g['g40']}" and vs1["follow"] and "따라가는 중" in await ipg.locator("#cvvLive").text_content(), f"go live jumps + follows {vs1}")
        rpc("backup_update", {"p": {"now": f"b:{g['g51']}", "next": None}}, D[1])
        await ipg.wait_for_timeout(4500)
        check((await ipg.evaluate(VS))["item"] == f"b:{g['g51']}", "follows next song")
        await ipg.keyboard.press("ArrowLeft"); await ipg.wait_for_timeout(800)
        vs2 = await ipg.evaluate(VS)
        check(not vs2["follow"] and await ipg.locator("#cvvLive .cvv-lv-go").is_visible(), "manual turn → free + bar again")
        rpc("backup_update", {"p": {"now": f"b:{g['g40']}"}}, D[1])
        await ipg.wait_for_timeout(4500)
        check((await ipg.evaluate(VS))["item"] != f"b:{g['g40']}" or vs2["item"] == f"b:{g['g40']}", "free mode not dragged")
        # 후보가 바뀌면 바로 반영
        rpc("backup_update", {"p": {"candidates": [g["g40"], g["g51"], g["g54"]]}}, D[1])
        await ipg.wait_for_timeout(4500)
        check(f"b:{g['g54']}" in (await ipg.evaluate(VS))["ids"], "candidate change rebuilds viewer")
        # 팀원 '참여' (live card) → 악보 보기 + 따라가기
        await pg.locator(".cvv-back").click(); await pg.wait_for_timeout(500)
        await pg.goto(BASE + "/me.html#worship"); await pg.reload(); await pg.wait_for_timeout(3000)
        await pg.screenshot(path=SHOT + "dbg_join.png")
        await pg.locator("[data-bk-join]").first.click(); await pg.wait_for_timeout(3000)
        vsj = await pg.evaluate(VS)
        check(vsj["follow"] and vsj["item"] == f"b:{g['g40']}", f"join opens viewer following {vsj}")
        rpc("backup_update", {"p": {"active": False}}, D[1])
        await ipg.wait_for_timeout(7000)
        check(await ipg.locator("#cvvLive").is_hidden() and not (await ipg.evaluate(VS))["follow"], "bar gone after meeting")
        check(ipg.errs == [] and pg.errs == [], f"live errs {ipg.errs[:2]} {pg.errs[:2]}")
        # 밴드: 적용찬양 BPM 고치기 (악보 보기에서)
        await ipg.locator(".cvv-jump button.applied").first.click(); await ipg.wait_for_timeout(1200)
        await ipg.locator("#cvvBpm [data-cvv=bpm]").click(); await ipg.wait_for_timeout(300)
        await ipg.fill("#bpmIn", "70"); await ipg.locator('.bpm-pop [data-m="3/4"]').click(); await ipg.locator('.bpm-pop [data-bp=save]').click(); await ipg.wait_for_timeout(1200)
        check(q(f"select bpm||meter from applied_songs where id={aid}") == "703/4" and "♩=70" in await ipg.locator("#cvvBpm").text_content(), "band edits applied bpm in viewer")
        await ictx.close(); await ib.close(); await ctx.close(); await b.close()

        # ================= D. 인도자: 확정 전 후보는 인도자에게만 · 팀원은 '확정 전'
        rpc("backup_update", {"p": {"active": True}}, D[1]); rpc("backup_update", {"p": {"active": False, "candidates": [g["g54"]]}}, D[1])
        lb, lctx = await browser(p, viewport={"width": 1194, "height": 834})
        lp = await login(lctx, "demo01@pole2.test", PW, dest=None)
        await open_viewer(lp, sid)
        lids = (await lp.evaluate(VS))["ids"]
        check(f"b:{g['g54']}" in lids and await lp.locator(".cvv-jump button.backup.draft").count() == 1, f"leader sees draft candidate {lids}")
        mb2, mctx2 = await browser(p, viewport={"width": 1194, "height": 834})
        mp = await login(mctx2, "demo03@pole2.test", PW, dest=None)
        await open_viewer(mp, sid)
        mids = (await mp.evaluate(VS))["ids"]
        check("bk:none" in mids and f"b:{g['g54']}" not in mids, f"member sees 확정 전 slot {mids}")
        await mp.locator('.cvv-jump button.backup').click(); await mp.wait_for_timeout(800)
        check("확정 전" in await mp.locator("#cvvBlank").text_content(), "확정 전 page text")
        rpc("backup_confirm", {}, D[1])
        await mp.wait_for_timeout(7500)
        check(f"b:{g['g54']}" in (await mp.evaluate(VS))["ids"], "member viewer updates after confirm")
        check(lp.errs == [] and mp.errs == [], f"draft errs {lp.errs[:2]} {mp.errs[:2]}")
        await lctx.close(); await lb.close(); await mctx2.close(); await mb2.close()
        G["p"] = p
        await share_part(p)
        await admin_part(p)

async def share_part(p):
    # ================= E. 섬김이 링크: 순서 · 레퍼런스 · BPM · 확대 · 내 메모(이 기기) · 기도회 따라가기
    rpc("backup_update", {"p": {"active": False, "candidates": [g["g40"], g["g51"]]}}, D[1]); rpc("backup_confirm", {}, D[1])
    b, ctx = await browser(p, viewport={"width": 1194, "height": 834})
    pg = await ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    url = BASE + f"/share.html?t={tk}"
    await pg.goto(url); await pg.wait_for_timeout(2500)
    tags = await pg.locator(".cv-prow .cv-ptag").all_text_contents()
    check(all(t in tags for t in ("적용", "백업", "특별", "축도송")) and "콘티" not in tags, f"share flow card {tags}")
    hrefs = await pg.locator(".cv-slist .cv-yt").evaluate_all("a => a.map(x => x.href)")
    check(len(hrefs) == 2 and "SONGref0001?t=15" in hrefs[0] and "MEDLEYref01?t=42" in hrefs[1], f"share song refs {hrefs}")
    check("♩=72" in (await pg.locator(".cv-slist .cv-bpm").first.text_content()), "share song bpm")
    await pg.screenshot(path=SHOT + "share_home.png", full_page=True)
    await pg.click(".cv-pdfbar"); await pg.wait_for_timeout(3000)
    SV = "document.querySelector('.shv-viewer')._viewer"
    ids = await pg.evaluate(f"{SV}.items.map(x => x.id)")
    check(ids[:3] == ["c:0", "c:1", "c:2"] and f"b:{g['g40']}" in ids and f"x:{xid}" in ids and ids.index(f"b:{g['g40']}") < ids.index(f"x:{xid}"), f"share viewer order {ids}")
    check(await pg.locator("#vRef").is_visible() and "SONGref0001" in await pg.locator("#vRef").get_attribute("href") and await pg.locator("#vRef").get_attribute("target") == "_blank", "share viewer reference")
    check("72" in (await pg.locator("#vBpm").text_content()), "share viewer bpm")
    await pg.locator("#vJump button.applied").first.click(); await pg.wait_for_timeout(1500)
    abpm = q(f"select bpm from applied_songs where id={aid}")
    check(await pg.locator("#vRef").is_hidden() and f"♩={abpm}" in (await pg.locator("#vBpm").text_content()), f"applied: no ref, bpm shown {await pg.locator('#vRef').is_hidden()} {await pg.locator('#vBpm').text_content()} {await pg.evaluate(SV + '.items.filter(x => x.kind == \'applied\').map(x => [x.id, x.bpm])')}")
    await pg.locator("#vJump [data-vi='0']").click(); await pg.wait_for_timeout(1500)
    # 확대 (Ctrl + 휠)
    st = await pg.locator("#vStage").bounding_box()
    k0 = (await pg.evaluate(f"{SV}.ink.state"))["k"]
    await pg.mouse.move(st["x"] + st["width"] / 2, st["y"] + st["height"] / 2)
    await pg.keyboard.down("Control"); await pg.mouse.wheel(0, -300); await pg.keyboard.up("Control"); await pg.wait_for_timeout(500)
    s1 = await pg.evaluate(f"{SV}.ink.state")
    check(s1["k"] > k0 * 1.3 and s1["zoomed"], f"share zoom {k0} -> {s1['k']}")
    await pg.dblclick("#vStage", position={"x": st["width"] / 2, "y": st["height"] / 2}); await pg.wait_for_timeout(500)
    # 내 메모 — 서버엔 안 감
    n0 = q("select count(*) from sheet_notes")
    await pg.locator(".cvv-top [data-iv=pen]").click(); await pg.wait_for_timeout(500)
    check("이 기기에만" in (await pg.locator("#vInk").text_content()), "share memo bar says device only")
    cv = await pg.locator("#vCv").bounding_box()
    await pg.mouse.move(cv["x"] + cv["width"] * 0.2, cv["y"] + cv["height"] * 0.3); await pg.mouse.down()
    for fx in (0.3, 0.45, 0.6): await pg.mouse.move(cv["x"] + cv["width"] * fx, cv["y"] + cv["height"] * 0.35, steps=5)
    await pg.mouse.up(); await pg.wait_for_timeout(300)
    check((await pg.evaluate(f"{SV}.ink.state"))["strokes"] == 1, "share memo stroke drawn")
    await pg.locator("#vInk [data-iv=done]").click(); await pg.wait_for_timeout(1200)
    check(q("select count(*) from sheet_notes") == n0, "share memo not sent to server")
    await pg.goto(url); await pg.wait_for_timeout(2500)
    await pg.click(".cv-pdfbar"); await pg.wait_for_timeout(3000)
    check((await pg.evaluate(f"{SV}.ink.state"))["strokes"] == 1, "share memo persists on this device (IndexedDB)")
    cache = await pg.evaluate("caches.keys().then(async ks => { let n = 0; for (const k of ks) n += (await (await caches.open(k)).keys()).length; return n; })")
    check(cache >= 3, f"share sheets cached by path {cache}")
    # 다른 기기(새 브라우저)엔 없음
    b2, ctx2 = await browser(p, viewport={"width": 1194, "height": 834})
    pg2 = await ctx2.new_page(); await pg2.goto(url); await pg2.wait_for_timeout(2500); await pg2.click(".cv-pdfbar"); await pg2.wait_for_timeout(3000)
    check((await pg2.evaluate(f"{SV}.ink.state"))["strokes"] == 0, "memo not on other device")
    await ctx2.close(); await b2.close()
    # 기도회: 폴링(실시간 없음)으로 막대 · 따라가기 · 직접 넘기면 자유 · 끝나면 사라짐
    rpc("backup_update", {"p": {"active": True, "now": f"b:{g['g40']}", "next": f"b:{g['g51']}"}}, D[1])
    await pg.wait_for_timeout(7500)
    check(await pg.locator("#vLive").is_visible() and "비 준비하시니" in (await pg.locator("#vLive").text_content()), f"share live bar {await pg.locator('#vLive').text_content()}")
    await pg.screenshot(path=SHOT + "share_live.png")
    await pg.locator("#vLive [data-v=golive]").click(); await pg.wait_for_timeout(1500)
    cur = await pg.evaluate(f"(() => {{ const V = {SV}; return [V.follow, V.items[V.pages[V.cur].i].id]; }})()")
    check(cur == [True, f"b:{g['g40']}"], f"golive follows {cur}")
    rpc("backup_update", {"p": {"now": f"b:{g['g51']}", "next": None}}, D[1])
    await pg.wait_for_timeout(5000)
    cur = await pg.evaluate(f"(() => {{ const V = {SV}; return [V.follow, V.items[V.pages[V.cur].i].id]; }})()")
    check(cur == [True, f"b:{g['g51']}"], f"follow moves with live (poll) {cur}")
    # Broadcast 경로 (applyLive 'rt') — 확인(폴링)은 잠깐 멈추고, 서버가 보낸 그대로 넣어 봄
    await pg.evaluate("clearTimeout(window.__share.S.timer)")
    q("delete from realtime.sent")
    rpc("backup_update", {"p": {"now": f"b:{g['g40']}", "next": None}}, D[1])
    pl = [x for x in sent() if x["event"] == "live"][-1]["payload"]
    await pg.evaluate("(pl) => window.__share.applyLive(pl, 'rt')", pl)
    await pg.wait_for_timeout(800)
    cur = await pg.evaluate(f"(() => {{ const V = {SV}; return [V.follow, V.items[V.pages[V.cur].i].id, window.__share.S.lastLive.src]; }})()")
    check(cur == [True, f"b:{g['g40']}", "rt"], f"broadcast payload moves follow {cur}")
    await pg.evaluate("window.__share.poll()")
    await pg.locator("#vStage .cvv-tap.r").click(); await pg.wait_for_timeout(800)
    check((await pg.evaluate(f"{SV}.follow")) is False and await pg.locator("#vLive [data-v=golive]").count() == 1, "manual turn -> free, golive bar back")
    rpc("backup_update", {"p": {"active": False}}, D[1])
    await pg.wait_for_timeout(5000)
    check(await pg.locator("#vLive").is_hidden(), "live bar gone after end")
    check(errs == [], f"share errs {errs[:3]}")
    await ctx.close(); await b.close()
    # 휴대폰 폭
    b, ctx = await browser(p, mobile=True)
    pg = await ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    await pg.goto(url); await pg.wait_for_timeout(2500)
    check(await pg.evaluate("document.documentElement.scrollWidth") <= 392, "share phone no h-scroll")
    await pg.screenshot(path=SHOT + "share_phone.png", full_page=True)
    rpc("backup_update", {"p": {"active": True, "now": f"b:{g['g40']}", "next": None}}, D[1])
    await pg.click(".cv-pdfbar"); await pg.wait_for_timeout(7500)
    bb = await pg.locator("#vLive").bounding_box()
    check(bb and bb["x"] >= 0 and bb["x"] + bb["width"] <= 391, f"share phone live bar fits {bb}")
    await pg.screenshot(path=SHOT + "share_phone_live.png")
    rpc("backup_update", {"p": {"active": False}}, D[1])
    check(errs == [], f"share phone errs {errs[:3]}")
    await ctx.close(); await b.close()

async def admin_part(p):
    # ================= F. 관리자: 콘티 '순서' · 진행곡 '지우기' · 휴대폰 폭 순서 편집 / 기도회 막대
    b, ctx = await browser(p)
    ad = await login(ctx, "admin@x.com", "adminpass")
    ad.on("dialog", lambda d: asyncio.ensure_future(d.accept(nxt)))
    await navclick(ad, "conti"); await ad.wait_for_timeout(2500)
    btn = ad.locator(f'tr[data-sid="{sid}"] [data-ca=order]')
    check(await btn.count() == 1 and "특별" in await btn.text_content(), f"admin order button {await btn.count()}")
    await btn.click(); await ad.wait_for_timeout(1500)
    keys = await ad.evaluate("[...document.querySelectorAll('[data-fo-k]')].map(r => r.dataset.foK)")
    cur = json.loads(q(f"select array_to_json(flow) from services where id='{sid}'"))
    check([k for k in keys if k in cur] == cur and len(keys) >= len(cur), f"admin order editor {keys} vs {cur}")
    await ad.screenshot(path=SHOT + "admin_order.png")
    await ad.keyboard.press("Escape"); await ad.goto(BASE + "/admin.html#songs"); await ad.wait_for_timeout(2500)
    n0 = q("select count(*) from worship_proc where kind='blessing' and removed")
    dl = ad.locator('#procAdmin [data-bka=proc-del][data-k=blessing]')
    check(await dl.count() == 1, "proc 지우기 button")
    await dl.click(); await ad.wait_for_timeout(1500)
    check(q(f"select count(*) from worship_proc where kind='blessing' and removed and start_date='{nxt}'") == str(int(n0) + 1), "proc removed from date")
    txt = await ad.locator("#procAdmin").text_content()
    check("지움" in txt, "admin shows scheduled removal")
    st, sh = http("/api/conti", {"action": "share", "t": tk})
    f1 = next(s for s in sh["services"] if s["id"] == sid); f2 = next(s for s in sh["services"] if s["id"] == sid2)
    check(any(x["kind"] == "blessing" for x in f1["proc"]) and not any(x["kind"] == "blessing" for x in f2["proc"]), "removal applies from that date only")
    check(ad.errs == [], f"admin errs {ad.errs[:3]}")
    await ctx.close(); await b.close()
    b, ctx = await browser(p, mobile=True)
    pg = await login(ctx, "demo01@pole2.test", PW, dest=None)
    await pg.goto(BASE + f"/me.html#worship/{sid}"); await pg.wait_for_timeout(2500)
    await pg.click("[data-cv-order]"); await pg.wait_for_timeout(1500)
    check(await pg.evaluate("document.documentElement.scrollWidth") <= 392 and await pg.locator("[data-fo-k]").count() >= 8, "phone order editor fits")
    await pg.screenshot(path=SHOT + "phone_order.png", full_page=True)
    await pg.goto(BASE + f"/me.html#worship/{sid}"); await pg.wait_for_timeout(2000)
    rpc("backup_update", {"p": {"active": True, "now": f"b:{g['g40']}", "next": None}}, D[1])
    await pg.click(".cv-pdfbar"); await pg.wait_for_timeout(5000)
    bb = await pg.locator("#cvvLive").bounding_box()
    check(bb and bb["x"] >= 0 and bb["x"] + bb["width"] <= 391, f"phone member live bar fits {bb}")
    await pg.screenshot(path=SHOT + "phone_live.png")
    rpc("backup_update", {"p": {"active": False}}, D[1])
    check(pg.errs == [], f"phone errs {pg.errs[:3]}")
    await ctx.close(); await b.close()

if __name__ == "__main__":
    asyncio.run(main())
