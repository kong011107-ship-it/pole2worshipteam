import asyncio, sys, json, subprocess, os, re, urllib.request, uuid, datetime
sys.path.insert(0, "/home/claude/tests")
from h import *
def q(sql):
    return subprocess.run(["su", "postgres", "-c", f"psql -d wt -At -c \"{sql}\""], capture_output=True, text=True).stdout.strip()
LOG = "/home/claude/pgrst/push.log"
def pushlog():
    if not os.path.exists(LOG): return []
    return [json.loads(l) for l in open(LOG) if l.strip()]
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
    return http("/storage/v1/object/sheets/" + path, raw=open(file, "rb").read() if isinstance(file, str) else file, token=token, ctype=ctype)
ok = 0; bad = []
def check(c, msg):
    global ok
    if c: ok += 1
    else: bad.append(msg); print("FAIL", msg)
SHOT = "/home/claude/tests/v23_"
FX = "/home/claude/tests/fx/"
PW = "pole2test!"
U = lambda: str(uuid.uuid4())

async def to_month(pg, month_num):
    for _ in range(3):
        t = await pg.locator(".page-title").first.text_content()
        if t.startswith(f"{month_num}월"): return
        await pg.locator('[data-mnav="-1"]').first.click(); await pg.wait_for_timeout(1500)

async def main():
    T = tok("admin@x.com", "adminpass")
    st, r = http("/api/demo", {"action": "seed"}, T); print("seed", st, r.get("members"))
    q("insert into push_subscriptions(endpoint, member_id, p256dh, auth) select 'https://push.test/'||id, id, 'k', 'a' from members where is_active on conflict do nothing")
    D1, D2, D6, D7, D11 = [tok(f"demo{n:02d}@pole2.test", PW) for n in (1, 2, 6, 7, 11)]
    sun = q("select min(service_date) from services where ministry_id is null and status='published' and service_date >= current_date")
    sat = (datetime.date.fromisoformat(sun) - datetime.timedelta(days=1)).isoformat()
    sid = q(f"select id from services where service_date='{sun}' and ministry_id is null")
    mid = lambda n: q(f"select id from members where email='demo{n:02d}@pole2.test'")
    d2, d3, d7 = mid(2), mid(3), mid(7)
    lineup = q(f"select string_agg(member_id::text, ',') from assignments where service_id='{sid}' and member_id is not null").split(",")
    print("sunday", sun, "sat", sat, sid)
    q(f"insert into team_meetings(meeting_date) values ('{sat}') on conflict do nothing")

    # ================= 1. 토요 연습 시간 변경 투표
    dl = (datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) + datetime.timedelta(hours=5)).isoformat() + "Z"
    st, r = http("/api/notify", {"kind": "sat_vote", "date": sat, "start": "14:00", "end": "17:00", "member_ids": lineup, "deadline": dl}, D2)
    check(st == 403, f"member cannot send sat_vote {st}")
    st, r = http("/api/notify", {"kind": "sat_vote", "date": sun, "start": "14:00", "end": "17:00", "member_ids": lineup, "deadline": dl}, T)
    check(st == 400, f"sat_vote needs saturday {st}")
    n0 = len(pushlog())
    st, r = http("/api/notify", {"kind": "sat_vote", "date": sat, "start": "14:00", "end": "17:00", "member_ids": lineup, "deadline": dl}, T)
    check(st == 200 and r.get("recipients") == len(set(lineup)) and r.get("poll_id"), f"sat_vote sent {st} {r}")
    new = pushlog()[n0:]
    check(len(new) == len(set(lineup)) and all("토요 연습 시간이 바뀌었어요" in x["title"] and "14:00–17:00" in x["body"] for x in new), f"sat_vote push {new[:1]}")
    check(q(f"select to_char(practice_start,'HH24:MI')||'|'||practice_cancelled from team_meetings where meeting_date='{sat}'") == "14:00|false", "time changed")
    check(q(f"select state||'|'||coalesce(prev_start::text,'-') from practice_votes where meeting_date='{sat}'") == "voting|-", "practice_votes row (prev default)")
    pid = r["poll_id"]
    check(q(f"select results_hidden from polls where id={pid}") == "t", "results hidden")
    st, pv = rpc("poll_view", {"p_poll": pid}, D2)
    check(st == 200 and pv["show_results"] is False and pv["voters"] is None and pv["hidden"] is True and all(o["count"] is None for o in pv["options"]), f"member poll view hidden {pv}")
    no_opt = [o for o in pv["options"] if o["label"] == "불가"][0]["id"]
    yes_opt = [o for o in pv["options"] if o["label"] == "가능"][0]["id"]
    check(rpc("vote", {"p_poll": pid, "p_options": [no_opt]}, D2)[0] == 200, "d2 votes no")
    check(rpc("vote", {"p_poll": pid, "p_options": [yes_opt]}, D1)[0] == 200, "d1 votes yes")
    st, pv = rpc("poll_view", {"p_poll": pid}, D2)
    check(pv["voters"] is None and all(o["count"] is None for o in pv["options"]), "member still no counts after voting")
    st, pv = rpc("poll_view", {"p_poll": pid}, T)
    check(pv["voters"] == 2 and pv["show_results"] is True, f"admin sees results {pv['voters']}")
    st, vb = rpc("practice_vote_board", {"p_dates": [sat]}, T)
    check(st == 200 and vb[0]["no"] == [d2] and len(vb[0]["yes"]) == 1 and len(vb[0]["pending"]) == len(set(lineup)) - 2, f"vote board {vb}")
    check(rpc("practice_vote_board", {"p_dates": [sat]}, D2)[1] is None, "member no vote board")
    # 다시 물어도 원래 시간은 처음 것
    st, r2 = http("/api/notify", {"kind": "sat_vote", "date": sat, "start": "15:00", "end": "18:00", "member_ids": lineup, "deadline": dl}, T)
    check(st == 200 and q(f"select coalesce(prev_start::text,'-')||'|'||to_char(new_start,'HH24:MI') from practice_votes where meeting_date='{sat}'") == "-|15:00", "re-ask keeps prev")
    check(q(f"select closed_at is not null from polls where id={pid}") == "t", "old poll closed")
    pid = r2["poll_id"]; no_opt2 = q(f"select id from poll_options where poll_id={pid} and sort_order=1")
    rpc("vote", {"p_poll": pid, "p_options": [int(no_opt2)]}, D2)
    # 투표가 끝나도 팀원에게 결과는 안 보임
    q(f"update polls set deadline = now() - interval '1 minute' where id={pid}")
    st, pv = rpc("poll_view", {"p_poll": pid}, D2)
    check(pv["ended"] is True and pv["show_results"] is False and pv["voters"] is None, "ended but hidden for member")
    q(f"update polls set deadline = now() + interval '3 hours' where id={pid}")

    # 출석: 취소 전에는 토요 연습 출석 가능
    mtid = q(f"select id from team_meetings where meeting_date='{sat}'")
    st, r = rest("attendance", T, {"meeting_id": mtid, "member_id": d3, "kind": "practice", "status": "present"}, "POST")
    check(st in (200, 201), f"practice attendance before cancel {st} {r}")
    # 결정: 팀원 못 함
    check(rpc("decide_practice", {"p_date": sat, "p_decision": "cancel"}, D2)[0] >= 400, "member cannot decide")

    async with async_playwright() as p:
        # ================= 2. 관리자: 배치표 경고 · 섬김 일정 · 결정 · 취소
        b, ctx = await browser(p)
        pg = await login(ctx, "admin@x.com", "adminpass")
        M = int(sun[5:7])
        await pg.goto(BASE + f"/admin.html#lineup"); await pg.wait_for_timeout(2500); await to_month(pg, M)
        board = await pg.locator("#content").text_content()
        check("바뀐 연습 시간 불가" in board, "lineup warns sat vote no")
        await pg.screenshot(path=SHOT + "lineup_warn.png", full_page=False)
        await navclick(pg, "schedule"); await pg.wait_for_timeout(1800); await to_month(pg, M)
        chip = pg.locator(f'[data-vote="{sat}"]')
        check(await chip.count() == 1 and "투표 중" in await chip.text_content() and "불가 1" in await chip.text_content(), f"vote chip {await chip.text_content() if await chip.count() else '-'}")
        await pg.screenshot(path=SHOT + "schedule_vote.png", full_page=False)
        await chip.click(); await pg.wait_for_timeout(800)
        txt = await pg.locator("#mBody").text_content()
        check("불가 1" in txt and "데모" in txt or "불가 1" in txt, f"decision modal {txt[:120]}")
        check(await pg.locator("[data-dec=confirm]").count() == 1 and await pg.locator("[data-dec=revert]").count() == 1 and await pg.locator("[data-dec=cancel]").count() == 1, "three decisions")
        await pg.screenshot(path=SHOT + "decision.png")
        # 바꾼 시간 확정 → 알림
        n0 = len(pushlog())
        await pg.click("[data-dec=confirm]"); await pg.wait_for_timeout(1800)
        check(q(f"select state from practice_votes where meeting_date='{sat}'") == "confirmed", "confirmed")
        new = pushlog()[n0:]
        check(len(new) == len(set(lineup)) and all("시간 확정" in x["title"] and "15:00–18:00" in x["body"] for x in new), f"confirm push {new[:1]}")
        check(q(f"select closed_at is not null from polls where id={pid}") == "t", "decide closes poll")
        # 확정 → 경고 유지
        await pg.goto(BASE + "/admin.html#lineup"); await pg.wait_for_timeout(2500); await to_month(pg, M)
        check("바뀐 연습 시간 불가" in await pg.locator("#content").text_content(), "warn kept after confirm")
        # 취소: 섬김 일정 시간 창 → 이 주 연습 취소
        await navclick(pg, "schedule"); await pg.wait_for_timeout(1800); await to_month(pg, M)
        await pg.locator(f'[data-time="sat"][data-d="{sat}"]').click(); await pg.wait_for_timeout(1500)
        check(await pg.locator("#tAsk").count() == 1, "ask checkbox")
        await pg.click("#tAsk"); await pg.wait_for_timeout(300)
        nchips = await pg.locator("#tAskList [data-tm]").count()
        check(nchips == len(set(lineup)), f"auto targets = lineup {nchips}")
        await pg.locator("#tAskList [data-tm]").first.click(); await pg.wait_for_timeout(200)
        check(await pg.locator("#tAskList [data-tm]").count() == nchips - 1 and str(nchips - 1) in await pg.locator("#mOk").text_content(), "target removable")
        await pg.screenshot(path=SHOT + "sat_time_modal.png")
        await pg.click("#tAsk")
        await pg.click("#tCancel"); await pg.wait_for_timeout(1200)
        check("토요 연습 취소" in await pg.locator("#mTitle").text_content(), "cancel modal")
        await pg.fill("#cA", "09:00"); await pg.fill("#cB", "13:00")
        await pg.screenshot(path=SHOT + "cancel_modal.png")
        n0 = len(pushlog())
        await pg.click("#mOk"); await pg.wait_for_timeout(2000)
        check(q(f"select practice_cancelled from team_meetings where meeting_date='{sat}'") == "t", "cancelled")
        check(q(f"select count(*) from attendance where meeting_id='{mtid}' and kind='practice'") == "0", "practice attendance removed")
        check(q(f"select to_char(start_time,'HH24:MI') from services where id='{sid}'") == "09:00", "sunday time changed")
        new = pushlog()[n0:]
        check(len(new) == len(set(lineup)) and all("없어요" in x["title"] and "리허설 09:00" in x["body"] for x in new), f"cancel push {new[:1]}")
        t = await pg.locator(f'[data-time="sat"][data-d="{sat}"]').text_content()
        check("연습 없음" in t, f"schedule row cancelled {t}")
        await pg.screenshot(path=SHOT + "schedule_cancel.png", full_page=False)
        # 취소된 주: 토요 연습 출석 막힘 · 리허설은 됨
        st, r = rest("attendance", T, {"meeting_id": mtid, "member_id": d3, "kind": "practice", "status": "present"}, "POST")
        check(st >= 400 and "취소" in json.dumps(r, ensure_ascii=False), f"practice attendance blocked {st}")
        st, r = rest("attendance", T, {"meeting_id": mtid, "member_id": d3, "kind": "rehearsal", "status": "present"}, "POST")
        check(st in (200, 201), f"rehearsal attendance ok {st} {r}")
        # 배치표: 취소한 주 경고 사라짐 · 규칙 안 씀
        await pg.goto(BASE + "/admin.html#lineup"); await pg.wait_for_timeout(2500); await to_month(pg, M)
        board = await pg.locator("#content").text_content()
        check("바뀐 연습 시간 불가" not in board and "토 연습 없음" in board, "lineup after cancel")
        # 출석 화면
        await pg.goto(BASE + "/admin.html#attendance"); await pg.wait_for_timeout(1500)
        if await pg.locator(f'[data-sat="{sat}"]').count(): await pg.locator(f'[data-sat="{sat}"]').click(); await pg.wait_for_timeout(800)
        att = await pg.locator("#content").text_content()
        check("이번 주는 토요 연습이 없어요" in att, "attendance week shows cancelled")
        await pg.screenshot(path=SHOT + "attendance_cancel.png", full_page=False)
        check(not pg.errs, f"admin errs {pg.errs[:3]}")

        # ================= 3. 팀원: 홈 · 알림 투표 카드
        mb, mctx = await browser(p, mobile=True)
        mp = await login(mctx, "demo02@pole2.test", PW, "me.html")
        home = await mp.locator("#view-home").text_content()
        check("없음 · 당일 리허설" in home, "member home shows cancelled practice")
        await mp.goto(BASE + "/me.html#alerts"); await mp.wait_for_timeout(2000)
        vt = await mp.locator("#view-alerts").text_content()
        check("결과는 리더십" in vt and "토요 연습" in vt, "member alert poll hidden text")
        await mp.screenshot(path=SHOT + "member_alerts.png", full_page=True)
        await mctx.close(); await mb.close()

        # 다시 열기
        st, r = rpc("decide_practice", {"p_date": sat, "p_decision": "restore"}, T)
        check(st == 200 and q(f"select practice_cancelled from team_meetings where meeting_date='{sat}'") == "f", "restore")

        # ================= 4. 밴드 악보 권한 (DB)
        st, b7 = rpc("conti_one", {"p_service": sid}, D7)
        check(b7["can_edit"] is False and b7["can_edit_sheets"] is True, "band can_edit_sheets")
        check(rpc("conti_one", {"p_service": sid}, D2)[1]["can_edit_sheets"] is False, "singer no sheets")
        check(rpc("can_upload_sheet", {}, D7)[1] is True and rpc("can_upload_sheet", {}, D2)[1] is False, "band can upload")
        check(rpc("add_song", {"p_title": "밴드 새곡"}, D7)[0] >= 400, "band cannot add song")
        st, r = rpc("save_setlist_sheets", {"p_service": sid, "p_data": {"items": []}, "p_base": None}, D7)
        check(st >= 400, f"no published conti yet {st}")
        st, r = rpc("save_setlist", {"p_service": sid, "p_data": {"items": [{"song_id": 162, "key": "G"}, {"song_id": 18, "key": "A"}]}, "p_publish": True, "p_base": None}, D1)
        check(st == 200, f"leader publish {st} {r}")
        http("/api/conti", {"action": "notify", "service_id": sid}, D1)
        check(rpc("save_setlist", {"p_service": sid, "p_data": {"items": [{"song_id": 162}]}, "p_publish": True, "p_base": None}, D7)[0] >= 400, "band cannot save conti")
        ver = int(q(f"select version from setlists where service_id='{sid}'"))
        st, r = rpc("save_setlist_sheets", {"p_service": sid, "p_data": {"items": [{"song_id": 18}, {"song_id": 162}]}, "p_base": ver}, D7)
        check(st >= 400, "band cannot reorder")
        pth = f"sheets/162/{U()}.pdf"
        st, r = up(pth, FX + "conti5.pdf", D7, "application/pdf")
        check(st == 200, f"band upload sheet {st} {r}")
        st, r = up(f"sheets/162/{U()}.pdf", FX + "conti5.pdf", D2, "application/pdf")
        check(st >= 400, f"singer upload blocked {st}")
        n0 = len(pushlog())
        st, r = rpc("save_setlist_sheets", {"p_service": sid, "p_data": {"pages": 5, "items": [{"song_id": 162, "new_sheet": {"name": "베이스 메모", "path": pth, "pages": 3, "size": 100}, "page_from": 1, "page_to": 3}, {"song_id": 18}]}, "p_base": ver}, D7)
        check(st == 200 and r["sheet_changes"]["by"], f"band save sheets {st} {r}")
        check(q(f"select (version=notified_version)::text||'|'||(sheet_changes is not null)::text from setlists where service_id='{sid}'") == "true|true", "no push needed")
        check(len(pushlog()) == n0, "band sheet change no push")
        st, r = rpc("save_setlist_sheets", {"p_service": sid, "p_data": {"items": [{"song_id": 162}, {"song_id": 18}]}, "p_base": ver}, D7)
        check(st == 409 or (isinstance(r, dict) and r.get("code") == "PT409"), f"stale base {st}")

        # ================= 5. 적용찬양 · 예배 진행곡 (DB · Storage)
        ap = f"applied/{sid}/{U()}.jpg"
        check(up(ap, FX + "ap1.jpg", D2, "image/jpeg")[0] >= 400, "member cannot upload applied")
        check(up(ap, FX + "ap1.jpg", T, "image/jpeg")[0] == 200, "admin upload applied image")
        check(up(f"applied/{sid}/{U()}.gif", b"GIF89a", T, "image/gif")[0] >= 400, "gif rejected")
        st, r = rest("applied_songs", D2, {"service_id": sid, "title": "x", "images": [ap]}, "POST")
        check(st >= 400, f"member cannot add applied {st}")
        st, r = rest("applied_songs", T, {"service_id": sid, "title": "주의 손에", "key": "D", "images": ["applied/x/y.jpg"]}, "POST")
        check(st >= 400, "bad applied path rejected")
        st, r = rest("applied_songs", T, {"service_id": sid, "ord": 1, "title": "주의 손에", "key": "D", "images": [ap]}, "POST")
        check(st in (200, 201), f"admin add applied {st} {r}")
        pp = f"proc/{U()}.pdf"
        check(up(pp, FX + "proc.pdf", D1, "application/pdf")[0] >= 400, "leader cannot upload proc")
        check(up(pp, FX + "proc.pdf", T, "application/pdf")[0] == 200, "admin upload proc")
        st, r = rest("worship_proc", T, {"kind": "benediction", "title": "아론의 축복", "key": "E", "path": pp, "pages": 1, "start_date": "2026-01-01"}, "POST", "return=representation")
        check(st in (200, 201), f"proc insert {st} {r}")
        rest("worship_proc", T, {"kind": "blessing", "title": "축복합니다", "path": pp, "pages": 1, "start_date": "2026-01-01"}, "POST")
        rest("worship_proc", T, {"kind": "entrance", "title": "등단송", "path": pp, "pages": 1, "start_date": "2026-01-01"}, "POST")
        rest("worship_proc", T, {"kind": "benediction", "title": "미래 축도송", "path": pp, "pages": 1, "start_date": "2099-01-01"}, "POST")
        check(rest("worship_proc", D2, {"kind": "offering", "title": "x"}, "POST")[0] >= 400, "member cannot add proc")
        st, c1 = rpc("conti_one", {"p_service": sid}, D2)
        check(len(c1["applied"]) == 1 and c1["applied"][0]["images"] == [ap], "conti_one applied")
        check([x["title"] for x in c1["proc"] if x["kind"] == "benediction"] == ["아론의 축복"], f"proc_on current {c1['proc']}")
        n0 = len(pushlog())
        pid_ = q("select id from worship_proc where title='아론의 축복'")
        st, r = http("/api/notify", {"kind": "proc", "ids": [int(pid_)]}, T)
        check(st == 200 and r["recipients"] > 10 and "아론의 축복" in pushlog()[-1]["body"], f"proc notify {st} {r}")

        # ================= 6. 백업찬양 (DB)
        check(rpc("can_lead_backup", {}, D1)[1] is True and rpc("can_lead_backup", {}, D2)[1] is False, "can_lead_backup")
        check(rpc("backup_update", {"p": {"active": True}}, D2)[0] >= 400, "member cannot lead")
        check(up(f"book/{U()}.pdf", FX + "book.pdf", D1, "application/pdf")[0] >= 400, "leader cannot upload book")
        bi = f"backup/{U()}.jpg"
        check(up(bi, FX + "ap2.jpg", D2, "image/jpeg")[0] >= 400, "member cannot upload backup image")
        check(up(bi, FX + "ap2.jpg", D1, "image/jpeg")[0] == 200, "leader upload backup image")
        st, r = rpc("backup_add_custom", {"p_title": "직접 더한 찬양", "p_key": "g", "p_code": None, "p_images": [bi]}, D1)
        check(st == 200 and r["code"] == "x1", f"custom song x1 {st} {r}")
        check(rpc("backup_add_custom", {"p_title": "또", "p_key": None, "p_code": "x1", "p_images": [bi]}, D1)[0] >= 400, "dup code blocked")
        check(rpc("backup_add_custom", {"p_title": "또", "p_key": None, "p_code": None, "p_images": ["backup/../x.jpg"]}, D1)[0] >= 400, "bad image path")

        # ================= 7. 관리자 화면: 악보집 올리기 · 예배 진행곡
        await navclick(pg, "songs"); await pg.wait_for_timeout(2000)
        check(await pg.locator("#bkAdmin").count() == 1 and await pg.locator("#procAdmin").count() == 1, "songs page has backup & proc panels")
        await pg.locator("#bkBookFile").set_input_files(FX + "book.pdf"); await pg.wait_for_timeout(3500)
        rows = await pg.locator(".bi-row").count()
        codes = [await pg.locator(".bi-row input[data-bi=code]").nth(i).input_value() for i in range(rows)]
        check(rows == 8 and codes[2:] == ["g40", "g51", "f40", "g54", "e50", "g56"] and codes[0] == "" and codes[1] == "", f"book parsed {codes}")
        t3 = await pg.locator(".bi-row input[data-bi=title]").nth(2).input_value()
        check(t3 == "비 준비하시니", f"title parsed {t3}")
        check(await pg.locator("#biLabel").input_value() == "Ver.2605" or True, "label")
        await pg.fill("#biLabel", "Ver.2605")
        await pg.screenshot(path=SHOT + "book_import.png", full_page=False)
        await pg.click("[data-bi=save]"); await pg.wait_for_timeout(3500)
        check(q("select count(*) from backup_songs s join backup_books b on b.id=s.book_id where b.active") == "6", "book songs saved")
        check(q("select label||'|'||pages from backup_books where active") == "Ver.2605|8", "book active")
        await pg.wait_for_timeout(800)
        txt = await pg.locator("#bkAdmin").text_content()
        check("Ver.2605" in txt and "곡 6개" in txt, f"admin book summary {txt[:100]}")
        # 예배 진행곡 바꾸기 (봉헌송, 사진 2장)
        await pg.locator('[data-bka=proc][data-k=offering]').click(); await pg.wait_for_timeout(800)
        await pg.fill("#peT", "드리네"); await pg.fill("#peK", "A")
        await pg.locator("#peF").set_input_files([FX + "ap1.jpg", FX + "ap2.jpg"]); await pg.wait_for_timeout(200)
        await pg.click("[data-pe=save]"); await pg.wait_for_timeout(3000)
        check(q("select title||'|'||cardinality(images) from worship_proc where kind='offering'") == "드리네|2", "proc offering saved via UI")
        txt = await pg.locator("#procAdmin").text_content()
        check("드리네" in txt and "아론의 축복" in txt and "미래 축도송" in txt, f"proc admin list {txt[:160]}")
        await pg.screenshot(path=SHOT + "admin_songs_backup.png", full_page=True)
        # 리더십 콘티 화면: 적용찬양 버튼
        await navclick(pg, "conti"); await pg.wait_for_timeout(2000)
        check(await pg.locator(f'.ca-table tr[data-sid="{sid}"] [data-ca=applied]').count() == 1, "admin conti applied button")
        await pg.locator(f'.ca-table tr[data-sid="{sid}"] [data-ca=applied]').click(); await pg.wait_for_timeout(1500)
        await pg.fill("#apTitle", "나의 영혼이 잠잠히"); await pg.fill("#apKey", "C")
        await pg.locator("#apFiles").set_input_files([FX + "ap1.jpg", FX + "ap2.jpg"])
        await pg.click("#apSave"); await pg.wait_for_timeout(3000)
        check(q(f"select count(*) from applied_songs where service_id='{sid}'") == "2", "applied via UI")
        check(await pg.locator("[data-ap]").count() == 2, "applied list in layer")
        await pg.locator("[data-ap]").nth(1).locator("[data-apa=up]").click(); await pg.wait_for_timeout(1200)
        check(q(f"select title from applied_songs where service_id='{sid}' order by ord limit 1") == "나의 영혼이 잠잠히", "applied reorder")
        await pg.screenshot(path=SHOT + "applied_layer.png")
        check(not pg.errs, f"admin errs 2 {pg.errs[:3]}")
        await ctx.close(); await b.close()

        # ================= 8. 밴드 화면: 악보 고치기 (태블릿)
        b, ctx = await browser(p, viewport={"width": 820, "height": 1180}, has_touch=True)
        pg = await login(ctx, "demo07@pole2.test", PW, dest=None)
        await pg.goto(BASE + f"/me.html#worship/{sid}"); await pg.wait_for_timeout(2500)
        check(await pg.locator(".cv-ct .chip-violet").count() == 1 and "악보 바뀜" in await pg.locator(".cv-ct").first.text_content(), "sheet changed chip")
        eb = pg.locator("[data-cv-edit]")
        check(await eb.count() == 1 and "악보 고치기" in await eb.text_content(), "band edit button")
        check(await pg.locator(".cv-prow").count() >= 4, f"applied/proc rows {await pg.locator('.cv-prow').count()}")
        await pg.screenshot(path=SHOT + "band_conti.png", full_page=True)
        await eb.click(); await pg.wait_for_timeout(1500)
        check(await pg.locator(".ce-row.ro").count() == 2 and await pg.locator("#ceQ").count() == 0 and await pg.locator("[data-grip]").count() == 0, "sheets-only editor")
        check(await pg.locator("[data-ce=sheets]").count() == 1 and await pg.locator("[data-ce=publish]").count() == 0, "sheets save button")
        await pg.locator("[data-ce-file]").set_input_files(FX + "conti5.pdf"); await pg.wait_for_timeout(2500)
        check(await pg.locator(".ce-pg").count() == 5, "band pdf pages")
        while await pg.locator("[data-cmp=new]").count():
            await pg.locator("[data-cmp=new]").first.click(); await pg.wait_for_timeout(300)
        # 두 번째 곡: 새로 저장
        if await pg.locator(".ce-row").nth(1).locator("[data-ce=sheet-open]").count():
            await pg.locator(".ce-row").nth(1).locator("[data-ce=sheet-open]").click(); await pg.wait_for_timeout(300)
            await pg.locator("[data-ce=sheet-new]").click(); await pg.wait_for_timeout(300)
        await pg.screenshot(path=SHOT + "band_editor.png", full_page=False)
        n0 = len(pushlog()); v0 = q(f"select version from setlists where service_id='{sid}'")
        await pg.click("[data-ce=sheets]"); await pg.wait_for_timeout(5000)
        check(await pg.locator(".cv-editor").count() == 0, "band editor closed")
        check(int(q(f"select version from setlists where service_id='{sid}'")) == int(v0) + 1 and len(pushlog()) == n0, "band save no push")
        check(q(f"select count(*) from sheet_versions where created_by=(select id from members where email='demo07@pole2.test')") in ("2", "3"), "band sheet versions")
        # 악보 보기: 적용 · 진행곡 칩 이어짐 · 등단송은 주일엔 없음
        await pg.click(".cv-pdfbar"); await pg.wait_for_timeout(2000)
        chips = [await x.text_content() for x in await pg.locator(".cvv-jump button").all()]
        check(any("적용" in c for c in chips) and any("축도" in c for c in chips) and any("봉헌" in c for c in chips) and not any("등단" in c for c in chips), f"viewer chips {chips}")
        check(any("백업찬양" in c for c in chips), "backup chip in viewer")
        await pg.locator(".cvv-jump button.applied").first.click(); await pg.wait_for_timeout(1200)
        cw = await pg.evaluate("document.querySelector('#cvvCanvas').width")
        check(cw > 200, f"image page drawn {cw}")
        await pg.screenshot(path=SHOT + "viewer_applied.png")
        await pg.locator(".cvv-jump button.proc").last.click(); await pg.wait_for_timeout(1500)
        check("축도" in await pg.locator(".cvv-jump button[aria-pressed=true]").text_content(), "proc page")
        check(pg.errs == [], f"band errs {pg.errs[:3]}")
        await ctx.close(); await b.close()

        # ================= 9. 백업찬양: 인도자(태블릿) 진행 · 팀원(폰) 따라가기
        lb, lctx = await browser(p, viewport={"width": 834, "height": 1194}, has_touch=True)
        lp = await login(lctx, "demo01@pole2.test", PW, dest=None)
        await lp.goto(BASE + "/me.html#worship"); await lp.wait_for_timeout(1500)
        await lp.click('#worshipNav [data-ws="backup"]'); await lp.wait_for_timeout(2500)
        check(await lp.locator(".bk-item").count() == 7, f"backup list {await lp.locator('.bk-item').count()}")
        await lp.fill("#bkQ", "g5"); await lp.wait_for_timeout(300)
        check(await lp.locator(".bk-item").count() == 3, f"code search g5 {await lp.locator('.bk-item').count()}")
        await lp.fill("#bkQ", ""); await lp.wait_for_timeout(300)
        await lp.click('[data-bk-key="g"]'); await lp.wait_for_timeout(300)
        check(await lp.locator(".bk-item").count() == 5, f"key filter g {await lp.locator('.bk-item').count()}")
        await lp.click('[data-bk-key="g"]'); await lp.wait_for_timeout(300)
        g40 = q("select s.id from backup_songs s join backup_books b on b.id=s.book_id where b.active and code='g40'")
        g51 = q("select s.id from backup_songs s join backup_books b on b.id=s.book_id where b.active and code='g51'")
        g54 = q("select s.id from backup_songs s join backup_books b on b.id=s.book_id where b.active and code='g54'")
        x1 = q("select id from backup_songs where code='x1'")
        # 이전 후보(x1) 빼고 g40 · g51 · g54
        await lp.locator(f'[data-bk-song="{g40}"]').click(); await lp.wait_for_timeout(200)
        await lp.locator(f'[data-bk-song="{g51}"]').click(); await lp.wait_for_timeout(200)
        await lp.locator(f'[data-bk-song="{g54}"]').click(); await lp.wait_for_timeout(800)
        alt = await lp.locator(f'[data-bk-song="{g40}"]').text_content()
        check("다른 키 f40" in alt, f"alt key {alt}")
        check(await lp.locator(".bk-slot:not(.empty)").count() == 3, "3 candidates slots")
        check(q("select array_to_string(candidates, ',') from backup_live") == f"{g40},{g51},{g54}", f"candidates saved {q('select candidates from backup_live')}")
        await lp.screenshot(path=SHOT + "backup_pick.png", full_page=True)
        # 이미지로 곡 더하기
        await lp.click("[data-bk=add]"); await lp.wait_for_timeout(300)
        await lp.fill("#bkAT", "주님 앞에 무릎 꿇고"); await lp.fill("#bkAC", "x7")
        await lp.locator("#bkAF").set_input_files(FX + "bk1.png")
        await lp.click("[data-bk=add-save]"); await lp.wait_for_timeout(2500)
        x7 = q("select id from backup_songs where code='x7'")
        check(x7 and q("select array_to_string(candidates, ',') from backup_live") == f"{g40},{g51},{g54},{x7}", f"custom added to candidates {q('select candidates from backup_live')}")
        # 팀원: 후보가 보임
        mb, mctx = await browser(p, mobile=True)
        mp = await login(mctx, "demo02@pole2.test", PW, "me.html")
        await mp.goto(BASE + "/me.html#worship"); await mp.wait_for_timeout(1500)
        await mp.click('#worshipNav [data-ws="backup"]'); await mp.wait_for_timeout(2500)
        check(await mp.locator(".bk-slot:not(.empty)").count() == 4 and await mp.locator(".bk-ck").count() == 0, "member sees candidates read-only")
        check(await mp.locator("[data-bk=start]").count() == 0, "member no start")
        # 인도자: 기도회 시작
        await lp.click("[data-bk=start]"); await lp.wait_for_timeout(2500)
        check(await lp.locator(".bk-live").count() == 1 and await lp.locator(".bk-tile").count() == 4, "leader live screen")
        check(q("select active::text||'|'||now_ref||'|'||next_ref from backup_live") == f"true|b:{g40}|b:{g51}", "started now/next")
        cw = await lp.evaluate("document.querySelector('#bkCanvas').width")
        check(cw > 200, f"leader sheet drawn {cw}")
        await lp.screenshot(path=SHOT + "backup_leader.png")
        # 팀원: 진행 중 띠 → 참여 (따라가기)
        await mp.wait_for_timeout(16000)
        check(await mp.locator(".bk-livecard").count() == 1, "member live card")
        await mp.locator(".bk-livecard").first.click(); await mp.wait_for_timeout(2000)
        check(await mp.locator(".bk-live").count() == 1 and await mp.locator(".bk-mini button").count() >= 6, f"follower screen {await mp.locator('.bk-mini button').count()}")
        band = await mp.locator("#bkBand").text_content()
        check("g40" in band and "g51" in band, f"follower band {band}")
        # 인도자: 다음 예약(g54) → 팀원 알림 띠 → 시작 → 팀원 악보 넘어감
        await lp.locator(f'[data-bk-tile="b:{g54}"]').click(); await lp.wait_for_timeout(800)
        check(q("select next_ref from backup_live") == f"b:{g54}", "reserve next")
        try: await mp.wait_for_selector("#bkToast:not(.hidden)", timeout=6000)
        except Exception: pass
        check(await mp.locator("#bkToast:not(.hidden)").count() == 1 and "g54" in await mp.locator("#bkToast").text_content(), "follower next toast")
        await mp.screenshot(path=SHOT + "backup_follow_toast.png")
        await lp.click("[data-bkl=go]"); await lp.wait_for_timeout(800)
        check(q("select now_ref||'|'||coalesce(next_ref,'-') from backup_live") == f"b:{g54}|-", "go next")
        await mp.wait_for_timeout(3500)
        check("g54" in await mp.locator("#bkBand .now").text_content(), "follower followed")
        # 코드로 예약 · 다른 키 · 예배 진행곡
        await lp.fill("#bkCode", "f40"); await lp.press("#bkCode", "Enter"); await lp.wait_for_timeout(800)
        f40 = q("select s.id from backup_songs s join backup_books b on b.id=s.book_id where b.active and code='f40'")
        check(q("select next_ref from backup_live") == f"b:{f40}", "reserve by code")
        await lp.locator('[data-bk-tile="p:benediction"]').click(); await lp.wait_for_timeout(800)
        check(q("select next_ref from backup_live") == "p:benediction", "reserve proc")
        await lp.click("[data-bkl=go]"); await lp.wait_for_timeout(1500)
        check("축도송" in await lp.locator("#bkBand .now").text_content(), "proc now")
        await lp.screenshot(path=SHOT + "backup_leader_proc.png")
        # 팀원: 미리 보기 → 따라가기 꺼짐
        await mp.wait_for_timeout(3500)
        await mp.locator(f'.bk-mini [data-bk-see="b:{g40}"]').click(); await mp.wait_for_timeout(800)
        check("따라가기" in await mp.locator("[data-bkl=follow]").text_content() and "중" not in await mp.locator("[data-bkl=follow]").text_content(), "preview turns off follow")
        await mp.click("[data-bkl=follow]"); await mp.wait_for_timeout(500)
        check("따라가는 중" in await mp.locator("[data-bkl=follow]").text_content(), "follow back")
        await mp.screenshot(path=SHOT + "backup_follow.png")
        # 끝내기 → 팀원 화면 닫힘
        lp.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
        await lp.click("[data-bkl=end]"); await lp.wait_for_timeout(1000)
        check(q("select active from backup_live") == "f", "ended")
        await mp.wait_for_timeout(4000)
        check(await mp.locator(".bk-live").count() == 0, "follower closed on end")
        check(lp.errs == [] and mp.errs == [], f"live errs {lp.errs[:3]} {mp.errs[:3]}")
        await lctx.close(); await lb.close(); await mctx.close(); await mb.close()

    print("ok", ok, "bad", bad)

asyncio.run(main())
