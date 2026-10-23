import asyncio, sys, json, subprocess, os, re, urllib.request, uuid, datetime
sys.path.insert(0, "/home/claude/tests")
from h import *
def q(sql):
    return subprocess.run(["su", "postgres", "-c", f"psql -d wt -At -c \"{sql}\""], capture_output=True, text=True).stdout.strip()
def http(path, body=None, token=None, headers=None, method=None, raw=None, ctype="application/json"):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request((BASE + path) if path.startswith("/") else path, data=data, method=method or ("POST" if data is not None else "GET"))
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
SHOT = "/home/claude/tests/v26_"
FX = "/home/claude/tests/fx/"
PW = "pole2test!"
U = lambda: str(uuid.uuid4())

async def main():
    T = tok("admin@x.com", "adminpass"); L2 = tok("lead2@x.com", "lead2pass")
    st, r = http("/api/demo", {"action": "seed"}, T); print("seed", st, r.get("members"))
    D1, D2, D7 = [tok(f"demo{n:02d}@pole2.test", PW) for n in (1, 2, 7)]
    sun = q("select min(service_date) from services where ministry_id is null and status='published' and service_date >= current_date")
    sid = q(f"select id from services where service_date='{sun}' and ministry_id is null")
    item = lambda o, f: q(f"select {f} from setlist_items i join setlists s on s.id=i.setlist_id where s.service_id='{sid}' and i.ord={o}")
    ver = lambda: int(q(f"select version from setlists where service_id='{sid}'") or 0)
    print("upcoming", sun)

    # ================= 1. 박자 1/4
    st, r = rpc("save_setlist", {"p_service": sid, "p_data": {"items": [{"song_id": 162, "key": "G", "bpm": 70, "meter": "1/4"}, {"song_id": 18, "key": "A"}]}, "p_publish": False, "p_base": None}, D1)
    check(st == 200 and item(1, "meter") == "1/4" and q("select team_meter from songs where id=162") == "1/4", f"1/4 meter saved {st} {r}")
    st, r = rpc("set_bpm", {"p_service": sid, "p_ord": 2, "p_bpm": 80, "p_meter": "1/4"}, D1)
    check(st == 200 and r["meter"] == "1/4", f"set_bpm 1/4 {r}")
    check(rpc("set_bpm", {"p_service": sid, "p_ord": 2, "p_bpm": 80, "p_meter": "2/4"}, D1)[0] >= 400, "2/4 rejected")

    # ================= 2. 음원과 키 다름 · 앞 곡에 이어서 (그냥 이어 붙인 묶음)
    q("update songs set team_sec=240 where id=162"); q("update songs set team_sec=200 where id=18"); q("update songs set team_sec=300 where id=169")
    items = [{"song_id": 336, "key": "Eb", "refs": [["fnhK0lZBtIw", 33, ""]], "duration_sec": 280, "duration_src": "team"},
             {"song_id": 162, "key": "G", "diff_key": True, "duration_sec": 420, "duration_src": "manual", "refs": [["jb2mbx8Ia40", 0, ""]]},
             {"song_id": 18, "key": "A", "join_prev": True, "duration_sec": 200, "duration_src": "team"},
             {"song_id": 169, "key": "Bb", "join_prev": False, "duration_sec": 300}]
    st, r = rpc("save_setlist", {"p_service": sid, "p_data": {"items": items}, "p_publish": True, "p_base": ver()}, D1)
    check(st == 200, f"publish with join {st} {r}")
    check(item(2, "diff_key") == "t" and item(2, "medley") == "t" and item(3, "join_prev") == "t" and item(3, "medley") == "t" and item(1, "medley") == "f" and item(4, "medley") == "f", "flags: diff · join · medley computed")
    check(item(3, "duration_sec||'|'||duration_src") == "0|medley" and item(3, "refs::text") == "[]" or item(3, "duration_sec||'|'||duration_src") == "0|medley", f"follower time 0 medley {item(3, 'duration_sec')}")
    check(q("select team_sec from songs where id=162") == "240", "ad-hoc group head manual time does not overwrite song team_sec")
    st, c = rpc("conti_one", {"p_service": sid}, D2)
    it = c["setlist"]["items"]
    check(it[1]["diff_key"] is True and it[2]["join_prev"] is True and it[2]["medley_id"] is None, f"conti_one fields {it[1].get('diff_key')} {it[2].get('join_prev')}")
    check(sum(x["duration_sec"] or 0 for x in it) == 280 + 420 + 0 + 300, "RT = group head time (not sum)")
    st, r = rpc("save_setlist", {"p_service": sid, "p_data": {"items": [dict(items[0]), dict(items[1], diff_key=False), dict(items[2]), dict(items[3])]}, "p_publish": True, "p_base": ver()}, D1)
    check(st == 200 and r["changes"]["text"] == ["음원과 키 다름 표시"], f"diff-only change text {r.get('changes')}")
    st, r = rpc("save_setlist", {"p_service": sid, "p_data": {"items": [dict(items[0]), dict(items[1], duration_src="team"), dict(items[2], join_prev=False), dict(items[3])]}, "p_publish": True, "p_base": ver()}, D1)
    check(st == 200 and "메들리 변경" in r["changes"]["text"], f"join change text {r.get('changes')}")
    st, r = rpc("save_setlist", {"p_service": sid, "p_data": {"items": [dict(items[0], join_prev=True), dict(items[1]), dict(items[2]), dict(items[3])]}, "p_publish": False, "p_base": ver()}, D1)
    check(item(1, "join_prev") == "f", "first item never joins")
    rpc("save_setlist", {"p_service": sid, "p_data": {"items": items}, "p_publish": True, "p_base": ver()}, D1)

    # ================= 3. 메들리 저장 (콘티에서) · 메들리 악보
    p1 = f"sheets/162/{U()}.pdf"; up(p1, FX + "conti5.pdf", D1, "application/pdf")
    its = [dict(x) for x in items]; its[1]["new_sheet"] = {"name": "정사랑 합본", "path": p1, "pages": 3, "size": 100}; its[1]["page_from"] = 1; its[1]["page_to"] = 3
    st, r = rpc("save_setlist", {"p_service": sid, "p_data": {"pages": 5, "items": its}, "p_publish": True, "p_base": ver()}, D1)
    S1 = int(item(2, "sheet_id"))
    check(rpc("save_medley", {"p_id": None, "p_service": sid, "p_data": {"title": "x", "songs": [{"song_id": 162}]}}, D1)[0] >= 400, "medley needs 2+ songs")
    check(rpc("save_medley", {"p_id": None, "p_service": sid, "p_data": {"songs": [{"song_id": 162}, {"song_id": 18}]}}, D2)[0] >= 400, "singer cannot create medley")
    st, m = rpc("save_medley", {"p_id": None, "p_service": sid, "p_data": {"title": "", "songs": [{"song_id": 162, "key": "G"}, {"song_id": 18, "key": "A"}], "ref_yt": "jb2mbx8Ia40", "ref_start": 5, "team_sec": 420, "sheet_id": S1}}, D1)
    check(st == 200 and m["title"] == q("select title from songs where id=162") + " + " + q("select title from songs where id=18"), f"leader saves medley (default title) {st} {m}")
    MID = m["id"]
    check(q(f"select medley_id from sheet_versions where id={S1}") == str(MID), "sheet made in this conti → medley sheet")
    check(rpc("save_medley", {"p_id": None, "p_service": sid, "p_data": {"title": m["title"], "songs": [{"song_id": 162}, {"song_id": 18}]}}, D1)[0] >= 400, "dup medley title blocked")
    st, sh = rpc("song_sheets", {"p_songs": [162]}, D2)
    check(not any(x["id"] == S1 for x in sh), "song_sheets excludes medley sheet")
    st, ms = rpc("medley_sheets", {"p_ids": [MID]}, D2)
    check(len(ms) == 1 and ms[0]["id"] == S1, f"medley_sheets {ms}")
    # 메들리로 넣은 콘티: 첫 곡 시간 직접 → 메들리 팀 기준 · 레퍼런스 구간 → 메들리
    its = [dict(x) for x in items]; its[1].update(medley_id=MID, sheet_id=S1, duration_sec=450, duration_src="manual", ref_range={"yt": "jb2mbx8Ia40", "start": 7, "end": 400}); its[2].update(medley_id=MID)
    st, r = rpc("save_setlist", {"p_service": sid, "p_data": {"pages": 5, "items": its}, "p_publish": True, "p_base": ver()}, D1)
    check(st == 200 and item(2, "medley_id") == str(MID) and item(3, "medley_id") == str(MID), f"medley ids kept {r}")
    check(q(f"select team_sec||'|'||ref_start||'|'||ref_end from medleys where id={MID}") == "450|7|400", "medley head manual time + ref range → medley")
    check(q("select team_sec from songs where id=162") == "240", "song team_sec untouched")
    its2 = [dict(x) for x in its]; its2[3] = dict(its2[3], medley_id=MID)
    rpc("save_setlist", {"p_service": sid, "p_data": {"pages": 5, "items": its2}, "p_publish": False, "p_base": ver()}, D1)
    check(item(4, "medley_id") == "", "medley id on non-group item dropped")
    rpc("save_setlist", {"p_service": sid, "p_data": {"pages": 5, "items": its}, "p_publish": True, "p_base": ver()}, D1)
    st, c = rpc("conti_one", {"p_service": sid}, D2)
    check(c["setlist"]["items"][1]["medley_title"] == m["title"], "conti_one medley_title")
    st, ml = rpc("medley_list", {}, D2)
    check(len(ml) == 1 and ml[0]["used"] == 1 and ml[0]["sheets"] == 1 and [x["key"] for x in ml[0]["songs"]] == ["G", "A"], f"medley_list {ml}")
    st, hb = rpc("history_bundle", {}, D2)
    check(any(x["id"] == MID for x in hb["medleys"]), "history_bundle medleys")
    # 밴드 악보 고치기: 메들리 첫 곡에 새로 저장하면 메들리 악보
    p2 = f"sheets/162/{U()}.pdf"; up(p2, FX + "conti5b.pdf", D7, "application/pdf")
    st, r = rpc("save_setlist_sheets", {"p_service": sid, "p_data": {"items": [{"song_id": 336}, {"song_id": 162, "new_sheet": {"name": "밴드 합본", "path": p2, "pages": 3}}, {"song_id": 18}, {"song_id": 169}]}, "p_base": ver()}, D7)
    check(st == 200 and q("select medley_id from sheet_versions where name='밴드 합본'") == str(MID), f"band new sheet on medley head → medley sheet {st} {r}")
    st, f = rpc("sheet_fork", {"p_service": sid, "p_ord": 2, "p_name": "밴드 합본 2"}, D7)
    check(st == 200 and q(f"select medley_id from sheet_versions where id={f['sheet_id']}") == str(MID), "fork keeps medley_id")

    # ================= 4. 카톡 복사용 섬김이 팀 링크
    TK1, TK2 = "Tok" + uuid.uuid4().hex, "Tok" + uuid.uuid4().hex
    rest("share_links", T, {"label": "자막팀", "token": TK1}, "POST"); rest("share_links", T, {"label": "방송팀", "token": TK2}, "POST")
    st, L = rpc("conti_share_links", {"p_service": sid}, D1)
    check(st == 200 and [x["label"] for x in L] == ["자막팀", "방송팀"], f"leader gets links {L}")
    check(rpc("conti_share_links", {"p_service": sid}, D2)[1] is None, "singer gets null")
    st, S = http("/api/conti", {"action": "share", "t": TK1})
    sv = [x for x in S["services"] if x["id"] == sid][0]
    check(sv["setlist"]["items"][1]["diff_key"] is True and sv["setlist"]["items"][2]["join_prev"] is True, "share api diff/join")

    # ================= 5. '+' 곡 → 메들리로 정리
    st, r = rest("songs", T, {"title": "마음의 예배 + 내 삶의 이유라", "main_key": "G-A", "team_sec": 480}, "POST", "return=representation")
    PS = r[0]["id"]
    q(f"insert into song_refs(song_id, youtube_id, start_sec) values ({PS}, 'abcdefghijk', 12)")
    pp = f"sheets/{PS}/{U()}.pdf"; up(pp, FX + "conti5.pdf", T, "application/pdf")
    q(f"insert into sheet_versions(song_id, kind, name, pages, path) values ({PS}, 'sheet', '합본 G-A', 2, '{pp}')")
    q("insert into songs(title) values ('내 삶의 이유라')")
    imp = q("select id from setlists where service_date='2026-10-04'")
    n_before = q(f"select count(*) from setlist_items where setlist_id={imp}")
    q(f"insert into setlist_items(setlist_id, ord, song_id, key, refs, duration_sec) values ({imp}, 6, {PS}, 'G-A', '[[\\\"abcdefghijk\\\", 3, \\\"\\\"]]', 480)")
    imp2 = q("select id from setlists where service_date='2026-10-11'")
    q(f"update setlist_items set ord = ord + 20 where setlist_id={imp2} and ord >= 2"); q(f"update setlist_items set ord = ord - 19 where setlist_id={imp2} and ord >= 20")
    q(f"insert into setlist_items(setlist_id, ord, song_id, key) values ({imp2}, 2, {PS}, 'E')")
    check(rpc("plus_song_candidates", {}, D2)[1] is None, "member no candidates")
    st, pc = rpc("plus_song_candidates", {}, T)
    cand = [x for x in pc if x["id"] == PS]
    check(st == 200 and cand and [p["title"] for p in cand[0]["parts"]] == ["마음의 예배", "내 삶의 이유라"] and cand[0]["parts"][1]["match"] and cand[0]["parts"][0]["match"] is None and cand[0]["used"] == 2 and cand[0]["sheets"] == 1, f"candidates {cand}")
    q("insert into songs(title) values ('마음의 예배')")
    check(rpc("convert_plus_song", {"p_song": PS, "p_parts": [{"title": "마음의 예배"}]}, T)[0] >= 400, "needs 2 parts")
    check(rpc("convert_plus_song", {"p_song": PS, "p_parts": [{"title": "마음의 예배"}, {"title": "내 삶의 이유라"}]}, D1)[0] >= 400, "leader(non-admin) cannot convert")
    st, cv = rpc("convert_plus_song", {"p_song": PS, "p_parts": [{"title": "마음의 예배"}, {"title": "내 삶의 이유라 "}]}, T)
    check(st == 200 and cv["contis"] == 2, f"convert {st} {cv}")
    M2 = cv["medley_id"]; a = q("select id from songs where title='마음의 예배'"); b = q("select id from songs where title='내 삶의 이유라'")
    check(q(f"select count(*) from songs where id={PS}") == "0", "plus song deleted")
    check(q(f"select string_agg(song_id||':'||coalesce(key,''), ',' order by ord) from medley_songs where medley_id={M2}") == f"{a}:G,{b}:A", "medley songs + keys split from G-A")
    check(q(f"select team_sec||'|'||ref_yt||'|'||ref_start from medleys where id={M2}") == "480|abcdefghijk|12", "time + ref moved")
    check(q(f"select song_id||'|'||coalesce(medley_id::text,'') from sheet_versions where path='{pp}'") == f"{a}|{M2}", "sheet moved to medley")
    rows = q(f"select string_agg(ord||':'||song_id||':'||coalesce(key,'')||':'||join_prev||':'||medley||':'||coalesce(duration_sec::text,'-')||':'||jsonb_array_length(refs), ',' order by ord) from setlist_items where setlist_id={imp} and ord>=6")
    check(rows == f"6:{a}:G:false:true:480:1,7:{b}:A:true:true:0:0", f"history row split {rows}")
    rows2 = q(f"select string_agg(ord||':'||song_id||':'||coalesce(key,''), ',' order by ord) from setlist_items where setlist_id={imp2} and ord between 1 and 4")
    check(rows2.split(",")[1:3] == [f"2:{a}:E", f"3:{b}:E"] and q(f"select count(*) from setlist_items where setlist_id={imp2}") == "7", f"middle insert renumbered {rows2}")
    st, hb = rpc("history_bundle", {}, D2)
    pl = [x for s in hb["setlists"] for x in s["items"] if x[1] in (int(a), int(b))]
    check(len(pl) == 4, f"history counts each song {len(pl)}")

    # ================= 6. 백업 상태 · 비밀값 메모
    q("insert into backup_log(kind, ok, size_bytes, counts, files, artifact) values ('backup', true, 123456, '{\\\"members\\\": 15, \\\"songs\\\": 390}', 3, 'pole2-backup-test')")
    st, B = rpc("backup_status", {}, T)
    check(st == 200 and B["backups"][0]["artifact"] == "pole2-backup-test" and B["now"]["members"] >= 1, f"backup_status {str(B)[:120]}")
    check(rpc("backup_status", {}, D2)[1] is None, "member no backup_status")
    check(rpc("backup_counts", {}, T)[0] >= 400, "backup_counts not for authenticated")
    check(rpc("ops_secret_set", {"p_name": "CRON_SECRET", "p_value": "abc", "p_note": None}, L2)[0] >= 400, "non-owner cannot set secret")
    st, r = rpc("ops_secret_set", {"p_name": "CRON_SECRET", "p_value": "cron-xyz", "p_note": None}, T)
    check(st == 200 and rpc("ops_secret_list", {}, T)[1][0]["value"] == "cron-xyz", "owner sets/reads secret")
    check(rpc("ops_secret_list", {}, L2)[1] is None, "non-owner list null")
    check(rest("ops_secrets?select=*", T)[1] == [] or rest("ops_secrets?select=*", T)[0] >= 400, "no direct table read")

    async with async_playwright() as p:
        # ================= 7. 인도자: 초성 검색 · 이어서 · 키 다름 · 메들리 넣기 · 메들리로 저장 · 카톡 복사
        b, ctx = await browser(p, viewport={"width": 1194, "height": 834})
        lp = await login(ctx, "demo01@pole2.test", PW, dest=None)
        await lp.goto(BASE + f"/me.html#worship/{sid}"); await lp.wait_for_timeout(2500)
        rows = await lp.locator(".cv-slist .cv-srow .cv-sn").all_text_contents()
        check([x.strip() for x in rows] == ["1", "2", "+", "3"], f"conti numbering {rows}")
        keys = [x.strip() for x in await lp.locator(".cv-slist .cv-key").all_text_contents()]
        check(keys[1] == "G*" and await lp.locator(".cv-dk").count() == 1, f"diff key star {keys}")
        check("메들리" in await lp.locator(".cv-srow").nth(1).text_content(), "head shows medley")
        # 카톡 복사
        await lp.click("[data-cv-copy]"); await lp.wait_for_timeout(800)
        txt = await lp.locator("#cpText").input_value()
        y = sun[2:].replace("-", "")
        t336, t162, t18, t169 = [q(f"select title from songs where id={i}") for i in (336, 162, 18, 169)]
        exp_head = f"{y} 찬양콘티\n\n1. {t336} Eb\nhttps://youtu.be/fnhK0lZBtIw?t=33\n\n2. {t162} G*\n+ {t18} A\nhttps://youtu.be/jb2mbx8Ia40\n\n3. {t169} Bb"
        check(txt.startswith(exp_head), f"copy text format\n{txt}\n---\n{exp_head}")
        check("자막팀: http" in txt and "방송팀: http" in txt, "links included by default")
        await lp.locator('[data-cp-link]', has_text="방송팀").click(); await lp.wait_for_timeout(200)
        txt2 = await lp.locator("#cpText").input_value()
        check("자막팀: http" in txt2 and "방송팀" not in txt2 and txt2.endswith(f"share.html?t={TK1}"), f"deselect team {txt2[-80:]}")
        await lp.screenshot(path=SHOT + "copy_modal.png")
        await lp.click("[data-cp=close]"); await lp.wait_for_timeout(300)
        await lp.reload(); await lp.wait_for_timeout(2500)
        await lp.click("[data-cv-copy]"); await lp.wait_for_timeout(800)
        check("방송팀" not in await lp.locator("#cpText").input_value(), "team choice remembered")
        await lp.click("[data-cp=close]")
        # 악보 보기: '+' 칩 · 키 *
        await lp.click(".cv-pdfbar"); await lp.wait_for_timeout(2500)
        chips = [x.strip() for x in await lp.locator(".cvv-jump button").all_text_contents()]
        check(any(" + " in c and "G*" in c for c in chips), f"viewer merges follower without sheet into head chip {chips}")
        await lp.go_back(); await lp.wait_for_timeout(600)
        # 콘티 쓰기
        await lp.click("[data-cv-edit]"); await lp.wait_for_timeout(2500)
        sn = [x.strip() for x in await lp.locator(".ce-row .cv-sn").all_text_contents()]
        check(sn == ["1", "2", "+", "3"], f"editor numbering {sn}")
        check("앞 곡 시간에 포함" in await lp.locator(".ce-row").nth(2).text_content(), "follower time cell")
        await lp.fill("#ceQ", "ㄴㄹㅇㅅ"); await lp.wait_for_timeout(400)
        hits = await lp.locator("#ceDrop [data-add] b").all_text_contents()
        check(any("놀라우신" in h for h in hits), f"chosung search {hits}")
        await lp.fill("#ceQ", "마ㅇㅇ ㅇㅂ"); await lp.wait_for_timeout(400)
        mh = await lp.locator("#ceDrop [data-addm]").count()
        check(mh >= 1, "medley found by chosung of member song")
        await lp.locator("#ceDrop [data-addm]").first.click(); await lp.wait_for_timeout(1500)
        sn = [x.strip() for x in await lp.locator(".ce-row .cv-sn").all_text_contents()]
        check(sn == ["1", "2", "+", "3", "4", "+"], f"medley added under one number {sn}")
        check("메들리 기준" in await lp.locator(".ce-row").nth(4).text_content() and "8:00" in await lp.locator(".ce-row").nth(4).locator("[data-f=dur]").input_value(), "medley head time from medley")
        # 키 다름 · 이어서 끄기/켜기
        await lp.locator(".ce-row").nth(3).locator("[data-ce=more]").click(); await lp.wait_for_timeout(300)
        await lp.locator(".ce-row").nth(3).locator("[data-f=diff]").check(); await lp.wait_for_timeout(300)
        check("키 다름" in await lp.locator(".ce-row").nth(3).text_content(), "diff toggled")
        await lp.locator(".ce-row").nth(3).locator("[data-f=join]").check(); await lp.wait_for_timeout(400)
        sn = [x.strip() for x in await lp.locator(".ce-row .cv-sn").all_text_contents()]
        check(sn == ["1", "2", "+", "+", "3", "+"], f"join 4th to group {sn}")
        rt1 = await lp.locator("#ceRt b").first.text_content()
        await lp.screenshot(path=SHOT + "editor_medley.png")
        # 그냥 묶음 → 메들리로 저장 (2번 묶음은 이미 메들리 MID라, 3곡이 되어 묶음이 섞이면 이어 붙인 묶음으로 바뀜)
        await lp.locator(".ce-row").nth(1).locator("[data-ce=more]").click(); await lp.wait_for_timeout(300)
        sv_btn = lp.locator(".ce-row").nth(1).locator("[data-ce=save-medley]")
        check(await sv_btn.count() == 1, "save as medley offered for mixed group")
        lp.once("dialog", lambda d: asyncio.ensure_future(d.accept("테스트 3곡 메들리")))
        await sv_btn.click(); await lp.wait_for_timeout(2500)
        M3 = q("select id from medleys where title='테스트 3곡 메들리'")
        check(M3 and q(f"select count(*) from medley_songs where medley_id={M3}") == "3", "3-song medley saved from editor")
        await lp.click("[data-ce=publish]"); await lp.wait_for_timeout(4000)
        check(item(2, "medley_id") == M3 and item(4, "medley_id") == M3 and item(4, "join_prev") == "t" and item(4, "diff_key") == "t" and item(6, "join_prev") == "t", "publish keeps groups")
        check(item(4, "duration_sec") == "0", "joined follower time 0")
        check(lp.errs == [], f"leader errs {lp.errs[:3]}")
        await ctx.close(); await b.close()

        # ================= 8. 메트로놈 1/4 · 박 쪼개기 (팀원 · 태블릿)
        b, ctx = await browser(p, viewport={"width": 820, "height": 1180}, has_touch=True)
        mp = await login(ctx, "demo02@pole2.test", PW, dest=None)
        q(f"update setlist_items set bpm=90, meter='1/4' where ord=1 and setlist_id=(select id from setlists where service_id='{sid}')")
        await mp.goto(BASE + f"/me.html#worship/{sid}"); await mp.wait_for_timeout(2500)
        await mp.click(".cv-pdfbar"); await mp.wait_for_timeout(2500)
        await mp.click("#cvvBpm .cvv-dot"); await mp.wait_for_timeout(300)
        check(await mp.locator("#cvvBpm .cvv-sub.hidden").count() == 1, "sub hidden in blink mode")
        await mp.click("#cvvBpm .cvv-dot"); await mp.wait_for_timeout(1500)
        m1 = await mp.evaluate("CONTI.METRO.state")
        check(m1["flat"] is True and m1["beats"] == 1 and m1["sub"] == 1 and m1["clicks"] >= 2 and m1["subClicks"] == 0, f"1/4 flat metronome {m1}")
        check(await mp.locator("#cvvBpm .cvv-sub:not(.hidden)").count() == 1, "sub button in sound mode")
        await mp.click("#cvvBpm .cvv-sub"); await mp.wait_for_timeout(1500)
        m2 = await mp.evaluate("CONTI.METRO.state")
        check(m2["sub"] == 2 and m2["subClicks"] >= 2 and "♪♪" in await mp.locator("#cvvBpm .cvv-sub").text_content(), f"8th subdivision {m2}")
        await mp.click("#cvvBpm .cvv-sub"); await mp.wait_for_timeout(1200)
        m3 = await mp.evaluate("CONTI.METRO.state")
        check(m3["sub"] == 4 and m3["subClicks"] > m2["subClicks"], f"16th {m3}")
        check(await mp.evaluate("JSON.parse(localStorage.getItem('pole2.metro')).sub") == 4, "sub saved on device")
        await mp.screenshot(path=SHOT + "metro_sub.png")
        await mp.click("#cvvBpm .cvv-sub"); await mp.wait_for_timeout(200)
        check((await mp.evaluate("CONTI.METRO.state"))["sub"] == 1, "back to quarter")
        chips = [x.strip() for x in await mp.locator(".cvv-jump button").all_text_contents()]
        check(any(c.startswith("+") for c in chips) or any(" + " in c for c in chips), f"viewer medley chips {chips}")
        await mp.go_back(); await mp.wait_for_timeout(500)
        check(await mp.locator("[data-cv-copy]").count() == 0, "singer: no copy button")
        # 기록: 초성
        await mp.click('#worshipNav [data-ws="history"]'); await mp.wait_for_timeout(3000)
        await mp.click('#wsHist [data-hx="lib"]'); await mp.wait_for_timeout(600)
        await mp.locator('#wsHist [data-page="lib"] .hx-search').fill("ㅈㄱㄲㅈ ㅈㄴㅇ"); await mp.wait_for_timeout(600)
        tt = await mp.locator('#wsHist [data-page="lib"] .hx-sch .t').all_text_contents()
        check(tt and all("지금까지" in t for t in tt), f"history lib chosung {tt[:3]}")
        check(mp.errs == [], f"member errs {mp.errs[:3]}")
        await ctx.close(); await b.close()

        # ================= 9. 관리자: 곡 · 메들리 · '+' 정리 · 초성 · 백업 화면 · 안내서 · 비밀값
        st, r = rest("songs", T, {"title": "주님 큰 영광 + 은혜", "team_sec": 400}, "POST", "return=representation")
        PS2 = r[0]["id"]
        b, ctx = await browser(p)
        ap = await login(ctx, "admin@x.com", "adminpass")
        await navclick(ap, "songs"); await ap.wait_for_timeout(2500)
        await ap.fill("#songQ", "ㅈㄴ ㅋ ㅇㄱ"); await ap.wait_for_timeout(400)
        names = await ap.locator("#songBody .song-name").all_text_contents()
        check(any("주님 큰 영광" in n for n in names), f"songs chosung {names[:3]}")
        await ap.fill("#songQ", ""); await ap.wait_for_timeout(200)
        check(await ap.locator("#plusCard [data-plus]").count() == 1, "plus card lists remaining '+' song")
        prow = ap.locator(f'#plusCard [data-plus="{PS2}"]')
        hints = await prow.locator(".ph").all_text_contents()
        check("새 곡" in hints[0] and "있는 곡" in hints[1], f"part hints {hints}")
        await prow.locator("[data-pp='1']").fill("은혜 새곡"); await ap.wait_for_timeout(200)
        check("새 곡" in await prow.locator(".ph").nth(1).text_content(), "hint flips to new song")
        await prow.locator("[data-plus-go]").click(); await ap.wait_for_timeout(500)
        await ap.screenshot(path=SHOT + "plus_confirm.png")
        await ap.click("#mOk"); await ap.wait_for_timeout(2500)
        check(q(f"select count(*) from songs where id={PS2}") == "0" and q("select count(*) from songs where title='은혜 새곡'") == "1" and q("select count(*) from medleys where title='주님 큰 영광 + 은혜'") == "1", "convert via UI")
        check(await ap.locator("#plusCard").count() == 0, "plus card gone")
        txt = await ap.locator("#medleyCard").text_content()
        check("주님 큰 영광 + 은혜" in txt and "테스트 3곡 메들리" in txt, "medley list")
        await ap.fill("#mdQ", "ㅌㅅㅌ"); await ap.wait_for_timeout(300)
        check(await ap.locator("#medleyCard tbody tr").count() == 1, "medley chosung filter")
        await ap.fill("#mdQ", "")
        await ap.screenshot(path=SHOT + "admin_medleys.png", full_page=True)
        # 메들리 만들기 (모달)
        await ap.click('[data-md="new"]'); await ap.wait_for_timeout(400)
        await ap.locator('.md-srow [data-mf="title"]').nth(0).fill(t336); await ap.locator('.md-srow [data-mf="key"]').nth(0).fill("Eb")
        await ap.locator('.md-srow [data-mf="title"]').nth(1).fill("없는 곡 이름"); await ap.click("#mOk"); await ap.wait_for_timeout(600)
        check("없어요" in await ap.locator("#mdErr").text_content(), "unknown song blocked")
        await ap.locator('.md-srow [data-mf="title"]').nth(1).fill(t169); await ap.fill("#mdSec", "7:30"); await ap.fill("#mdRef", "https://youtu.be/fnhK0lZBtIw?t=5"); await ap.click("#mOk"); await ap.wait_for_timeout(1500)
        check(q(f"select team_sec||'|'||ref_yt||'|'||ref_start from medleys where title='{t336} + {t169}'") == "450|fnhK0lZBtIw|5", "medley created via modal")
        await ap.locator("#medleyCard tr", has_text=f"{t336} + {t169}").locator('[data-md="detail"]').click(); await ap.wait_for_timeout(1500)
        check(await ap.locator(".cv-sheetpage .cvs-head h2").text_content() == f"{t336} + {t169}" and await ap.locator("#mdOrig").count() == 1, "medley detail")
        await ap.locator("[data-md-song]").first.click(); await ap.wait_for_timeout(1500)
        check("메들리" in await ap.locator(".cv-sheetpage").text_content() and await ap.locator("[data-sd-md]").count() >= 1, "song detail lists medley")
        await ap.locator("[data-sd=close]").click(); await ap.wait_for_timeout(500)
        # 멤버 · 배치 후보 초성
        await navclick(ap, "members"); await ap.wait_for_timeout(1500)
        await ap.fill("#mSearch", "ㅈㅅㄹ"); await ap.wait_for_timeout(800)
        mt = await ap.locator("#content .mtable").text_content()
        check("정사랑" in mt and "윤기쁨" not in mt, "members chosung")
        await ap.goto(BASE + "/admin.html#lineup"); await ap.wait_for_timeout(2500)
        if await ap.locator("#luQ").count():
            nm = await ap.locator("#luPool .lu-cand[data-nm]").first.get_attribute("data-nm")
            CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
            cq = "".join(CHO[(ord(c) - 0xAC00) // 588] for c in nm[:3] if 0xAC00 <= ord(c) <= 0xD7A3)
            await ap.fill("#luQ", cq); await ap.wait_for_timeout(300)
            vis = await ap.locator("#luPool .lu-cand[data-nm]:not([hidden])").evaluate_all("e => e.map(x => x.dataset.nm)")
            total = await ap.locator("#luPool .lu-cand[data-nm]").count()
            check(nm in vis and len(vis) < total, f"lineup chosung filter {cq} {vis} / {total}")
        else: check(False, "lineup search box")
        # 백업 · 안내서 · 비밀값
        await navclick(ap, "settings"); await ap.wait_for_timeout(2000)
        check("최근 4개" in await ap.locator("#safeCard").text_content(), "settings safe card text")
        await ap.click('#safeCard a[href="#backup"]'); await ap.wait_for_timeout(2000)
        bt = await ap.locator("#content").text_content()
        check("pole2-backup-test" in bt and "결과 확인 표" in bt and "팀원" in bt, "backup page")
        check(await ap.locator("#secCard .sec-row").count() >= 8 and "•" in await ap.locator('#secCard [data-sec="CRON_SECRET"]').text_content(), "owner secret card masked")
        await ap.locator('#secCard [data-sec="CRON_SECRET"] [data-sec-a="show"]').click(); await ap.wait_for_timeout(300)
        check("cron-xyz" in await ap.locator('#secCard [data-sec="CRON_SECRET"]').text_content(), "show secret")
        await ap.locator('#secCard [data-sec="VAPID_PUBLIC_KEY"] [data-sec-a="edit"]').click(); await ap.wait_for_timeout(300)
        await ap.fill("#secV", "BPUBKEY"); await ap.click("#mOk"); await ap.wait_for_timeout(1200)
        check(q("select value from ops_secrets where name='VAPID_PUBLIC_KEY'") == "BPUBKEY", "owner saves secret via UI")
        await ap.screenshot(path=SHOT + "backup_page.png", full_page=True)
        await ap.click('a[href="#backup-guide"]'); await ap.wait_for_timeout(1200)
        gt = await ap.locator(".guide").text_content()
        check("사고 대응" in gt and "Transfer project" in gt and "RESTORE" in gt and await ap.locator(".guide h2").count() >= 5, "guide page")
        await ap.screenshot(path=SHOT + "guide.png", full_page=False)
        check(not ap.errs, f"admin errs {ap.errs[:3]}")
        await ctx.close(); await b.close()
        # 리더십(최상위 아님): 비밀값 카드 없음
        b, ctx = await browser(p)
        lp2 = await login(ctx, "lead2@x.com", "lead2pass")
        await lp2.goto(BASE + "/admin.html#backup"); await lp2.wait_for_timeout(2000)
        check("결과 확인 표" in await lp2.locator("#content").text_content() and await lp2.locator("#secCard").count() == 0, "non-owner: backup page without secrets")
        # 관리자 콘티 표: 카톡 복사
        await navclick(lp2, "conti"); await lp2.wait_for_timeout(2000)
        await lp2.locator(f'.ca-table tr[data-sid="{sid}"] [data-ca=copy]').click(); await lp2.wait_for_timeout(800)
        check((await lp2.locator("#cpText").input_value()).startswith(f"{y} 찬양콘티"), "admin conti table copy")
        await ctx.close(); await b.close()

        # ================= 10. 섬김이 팀 화면: + · *
        b, ctx = await browser(p, mobile=True)
        sp = await ctx.new_page(); errs = []
        sp.on("pageerror", lambda e: errs.append(str(e)))
        await sp.goto(BASE + f"/share.html?t={TK1}"); await sp.wait_for_timeout(3000)
        sn = [x.strip() for x in await sp.locator(".cv-slist .cv-sn").all_text_contents()]
        ks = [x.strip() for x in await sp.locator(".cv-slist .cv-key").all_text_contents()]
        check(sn[:4] == ["1", "2", "+", "+"] and "G*" in ks, f"share numbering {sn} {ks}")
        check(errs == [], f"share errs {errs}")
        # 폰: 복사 창 가로 넘침
        lp = await login(ctx, "demo01@pole2.test", PW, dest=None)
        await lp.goto(BASE + f"/me.html#worship/{sid}"); await lp.wait_for_timeout(2500)
        await lp.click("[data-cv-copy]"); await lp.wait_for_timeout(800)
        sw = await lp.evaluate("document.documentElement.scrollWidth")
        check(sw <= 392, f"phone copy modal no h-scroll {sw}")
        await lp.screenshot(path=SHOT + "phone_copy.png")
        await ctx.close(); await b.close()

    print("ok", ok, "bad", bad)

asyncio.run(main())
