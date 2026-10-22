import asyncio, sys, json, subprocess, os, re, urllib.request, uuid, datetime
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
SHOT = "/home/claude/tests/v24_"
FX = "/home/claude/tests/fx/"
PW = "pole2test!"
U = lambda: str(uuid.uuid4())
ST = "document.querySelector('.cv-viewer')._viewer.ink.state"

async def draw(pg, box, pts, steps=6):
    x0, y0 = box["x"] + box["width"] * pts[0][0], box["y"] + box["height"] * pts[0][1]
    await pg.mouse.move(x0, y0); await pg.mouse.down()
    for (fx, fy) in pts[1:]:
        await pg.mouse.move(box["x"] + box["width"] * fx, box["y"] + box["height"] * fy, steps=steps)
    await pg.mouse.up(); await pg.wait_for_timeout(150)

async def main():
    T = tok("admin@x.com", "adminpass")
    st, r = http("/api/demo", {"action": "seed"}, T); print("seed", st, r.get("members"))
    D1, D2, D7 = [tok(f"demo{n:02d}@pole2.test", PW) for n in (1, 2, 7)]
    mid = lambda n: q(f"select id from members where email='demo{n:02d}@pole2.test'")
    d1, d2 = mid(1), mid(2)
    sun = q("select min(service_date) from services where ministry_id is null and status='published' and service_date >= current_date")
    sid = q(f"select id from services where service_date='{sun}' and ministry_id is null")
    sd = datetime.date.fromisoformat(sun)
    first = next(sd + datetime.timedelta(days=7 * i) for i in range(0, 6) if (sd + datetime.timedelta(days=7 * i)).day <= 7)
    q(f"insert into services(service_date, status) values ('{first}', 'published') on conflict do nothing")
    fid = q(f"select id from services where service_date='{first}' and ministry_id is null")
    q(f"update services set status='published' where id='{fid}'")
    print("sunday", sun, "first", first)
    check(sd.day > 7, f"test assumes {sun} is not first sunday")

    # ================= 1. 성찬 찬양 (DB)
    pp = f"proc/{U()}.pdf"; check(up(pp, FX + "proc.pdf", T, "application/pdf")[0] == 200, "upload proc")
    for kind, title in [("blessing", "축복합니다"), ("communion", "주의 몸 나의 몸"), ("communion2", "보혈을 지나"), ("offering", "드리네"), ("benediction", "아론의 축복")]:
        st, r = rest("worship_proc", T, {"kind": kind, "title": title, "path": pp, "pages": 1, "start_date": "2026-01-01"}, "POST")
        check(st in (200, 201), f"proc {kind} {st} {r}")
    check(rest("worship_proc", T, {"kind": "communion3", "title": "x", "start_date": "2026-01-01"}, "POST")[0] >= 400, "bad kind rejected")
    st, c = rpc("conti_one", {"p_service": sid}, D2)
    check(c["communion"] is False and [x["kind"] for x in c["proc"]] == ["blessing", "offering", "benediction"] and c["target_sec"] == 1500, f"normal sunday no communion {c['communion']} {[x['kind'] for x in c['proc']]} {c['target_sec']}")
    st, c = rpc("conti_one", {"p_service": fid}, D2)
    check(c["communion"] is True and [x["kind"] for x in c["proc"]] == ["blessing", "communion", "communion2", "offering", "benediction"] and c["target_sec"] == 1200, f"first sunday communion {[x['kind'] for x in c['proc']]} {c['target_sec']}")
    check(rpc("set_communion", {"p_service": sid, "p_on": True}, D2)[0] >= 400, "member cannot set communion")
    check(rpc("set_communion", {"p_service": sid, "p_on": True}, D1)[0] >= 400, "leader(non-admin) cannot set communion")
    st, r = rpc("set_communion", {"p_service": fid, "p_on": False}, T)
    check(st == 200 and r is False and q(f"select communion from services where id='{fid}'") == "f", f"turn off first sunday {st} {r}")
    st, c = rpc("conti_one", {"p_service": fid}, D2)
    check(c["communion"] is False and "communion" not in [x["kind"] for x in c["proc"]] and c["target_sec"] == 1500, "first sunday off")
    st, r = rpc("set_communion", {"p_service": fid, "p_on": True}, T)
    check(st == 200 and r is True and q(f"select coalesce(communion::text,'auto') from services where id='{fid}'") == "auto", "back to auto")
    po = lambda d: [x["kind"] for x in rpc("proc_on", {"p_date": str(d)}, D2)[1]]
    check("communion2" in po(first) and "communion2" in po(first - datetime.timedelta(days=3)) and "communion" not in po(sun), f"proc_on follows week {po(first)} {po(sun)}")
    mi = q("select id from services where ministry_id is not null limit 1")
    if mi: check(rpc("set_communion", {"p_service": mi, "p_on": True}, T)[0] >= 400, "ministry no communion")
    # 백업찬양 ref
    check(q("update backup_live set next_ref='p:communion2' where id=1 returning next_ref").startswith("p:communion2"), "backup ref communion2 ok")
    q("update backup_live set next_ref=null where id=1")

    # ================= 2. 내 메모 (DB · 권한)
    st, r = rest("sheet_notes", D2, {"member_id": d2, "key": "s:1", "page": 1, "strokes": [{"t": "p", "c": "#1F5C99", "w": 30, "p": [100, 200, 300, 400]}]}, "POST")
    check(st in (200, 201), f"own note insert {st} {r}")
    check(rest("sheet_notes", D2, {"member_id": d1, "key": "s:1", "page": 2, "strokes": []}, "POST")[0] >= 400, "cannot write other's note")
    check(rest("sheet_notes", D2, {"member_id": d2, "key": "zz", "page": 1, "strokes": []}, "POST")[0] >= 400, "bad key rejected")
    check(rest("sheet_notes", D2, {"member_id": d2, "key": "b:g40", "page": 1, "strokes": {"x": 1}}, "POST")[0] >= 400, "strokes must be array")
    check(rest("sheet_notes?select=key", D1)[1] == [], "notes are private")
    check(len(rest("sheet_notes?select=key", D2)[1]) == 1, "own notes visible")
    q("delete from sheet_notes")

    # 콘티 올리기 (인도자): 곡 2개 · 새 악보
    p1, p2 = f"sheets/162/{U()}.pdf", f"sheets/18/{U()}.pdf"
    check(up(p1, FX + "conti5.pdf", D1, "application/pdf")[0] == 200 and up(p2, FX + "conti5.pdf", D1, "application/pdf")[0] == 200, "leader uploads")
    st, r = rpc("save_setlist", {"p_service": sid, "p_data": {"pages": 5, "items": [
        {"song_id": 162, "key": "G", "new_sheet": {"name": "공준혁 G", "path": p1, "pages": 3, "size": 100}, "page_from": 1, "page_to": 3},
        {"song_id": 18, "key": "A", "new_sheet": {"name": "공준혁 A", "path": p2, "pages": 2, "size": 100}, "page_from": 4, "page_to": 5}]}, "p_publish": True, "p_base": None}, D1)
    check(st == 200, f"publish {st} {r}")
    sv1 = q("select sheet_id from setlist_items i join setlists s on s.id=i.setlist_id where s.service_id='" + sid + "' and i.song_id=162")
    ap = f"applied/{sid}/{U()}.jpg"; up(ap, FX + "ap1.jpg", T, "image/jpeg")
    rest("applied_songs", T, {"service_id": sid, "ord": 1, "title": "주의 손에", "key": "D", "images": [ap]}, "POST")

    async with async_playwright() as p:
        # ================= 3. 찬양 탭 가운데 (태블릿) · 성찬 칩
        st, r = rpc("set_communion", {"p_service": sid, "p_on": True}, T)
        b, ctx = await browser(p, viewport={"width": 1194, "height": 834}, has_touch=True)
        pg = await login(ctx, "demo02@pole2.test", PW, dest=None)
        await pg.goto(BASE + "/me.html#worship"); await pg.wait_for_timeout(2200)
        seg = await pg.locator("#worshipNav").bounding_box()
        check(abs((seg["x"] + seg["width"] / 2) - 1194 / 2) < 3, f"segbar centered {seg}")
        await pg.screenshot(path=SHOT + "tablet_tabs.png")
        await pg.goto(BASE + f"/me.html#worship/{sid}"); await pg.wait_for_timeout(2200)
        rows = [x.strip() for x in await pg.locator(".cv-prow .cv-ptag").all_text_contents()]
        check(rows[-5:] == ["축복송", "성찬 찬양 1", "성찬 찬양 2", "봉헌송", "축도송"], f"proc card order {rows}")
        check("성찬식 주일" in await pg.locator(".card-title:has-text('예배 진행곡')").text_content(), "proc card communion label")
        await pg.screenshot(path=SHOT + "conti_communion.png", full_page=True)
        await ctx.close(); await b.close()

        # ================= 4. 리더십: 콘티 현황 성찬 켜고 끄기
        b, ctx = await browser(p)
        ap_ = await login(ctx, "admin@x.com", "adminpass")
        await navclick(ap_, "conti"); await ap_.wait_for_timeout(2000)
        row = ap_.locator(f'.ca-table tr[data-sid="{sid}"]')
        check("성찬식" in await row.text_content() and "성찬식 빼기" in await row.locator("[data-ca=communion]").text_content(), "admin row shows communion")
        await row.locator("[data-ca=communion]").click(); await ap_.wait_for_timeout(1500)
        check(q(f"select coalesce(communion::text,'auto') from services where id='{sid}'") == "auto", "toggle off -> auto (not first week)")
        row = ap_.locator(f'.ca-table tr[data-sid="{sid}"]')
        check("성찬식 넣기" in await row.locator("[data-ca=communion]").text_content(), "button flips")
        frow = ap_.locator(f'.ca-table tr[data-sid="{fid}"]')
        if await frow.count(): check("성찬식" in await frow.locator("td").first.text_content(), "first sunday chip")
        check("성찬식 주일" in await ap_.locator("#caSet").text_content(), "settings label")
        await ap_.screenshot(path=SHOT + "admin_conti.png", full_page=True)
        await row.locator("[data-ca=communion]").click(); await ap_.wait_for_timeout(1500)
        check(q(f"select communion from services where id='{sid}'") == "t", "toggle on again")
        # 예배 진행곡 관리: 6줄
        await navclick(ap_, "songs"); await ap_.wait_for_timeout(2000)
        txt = await ap_.locator("#procAdmin").text_content()
        check("성찬 찬양 1" in txt and "성찬 찬양 2" in txt and "성찬식 주일에만" in txt, "proc admin communion rows")
        await ap_.locator("#procAdmin").screenshot(path=SHOT + "proc_admin.png")
        check(not ap_.errs, f"admin errs {ap_.errs[:3]}")
        await ctx.close(); await b.close()

        # ================= 5. 내 메모 (태블릿 · 펜 대신 마우스)
        b, ctx = await browser(p, viewport={"width": 820, "height": 1180})
        pg = await login(ctx, "demo02@pole2.test", PW, dest=None)
        await pg.goto(BASE + f"/me.html#worship/{sid}"); await pg.wait_for_timeout(2000)
        await pg.click(".cv-pdfbar"); await pg.wait_for_timeout(2500)
        chips = [x.strip() for x in await pg.locator(".cvv-jump button").all_text_contents()]
        tags = [c.split()[0] for c in chips]
        check(any("성찬 1" in c for c in chips) and any("성찬 2" in c for c in chips), f"viewer communion chips {chips}")
        order = [i for i, c in enumerate(chips) for t in ("축복", "성찬 1", "성찬 2", "봉헌", "축도") if c.startswith(t)]
        check(order == sorted(order) and len(order) == 5, f"viewer chip order {chips}")
        pen = pg.locator("[data-iv=pen]")
        check(await pen.count() == 1 and not await pen.is_disabled(), "pen button")
        s0 = await pg.evaluate(ST)
        check(s0["key"] == f"s:{sv1}" and s0["page"] == 1 and s0["strokes"] == 0, f"ink key {s0}")
        await pen.click(); await pg.wait_for_timeout(300)
        check(await pg.locator("#cvvInk .iv-bar").count() == 1 and await pg.locator(".cvv-stage.iv-pen").count() == 1, "toolbar shown")
        check(await pg.locator(".iv-bar .iv-c").count() == 8 and await pg.locator(".iv-bar .iv-sz").count() == 3, "8 colors 3 sizes")
        box = await pg.locator("#cvvCanvas").bounding_box()
        await draw(pg, box, [(0.2, 0.2), (0.5, 0.25), (0.7, 0.2)])
        await pg.locator('.iv-bar [data-iv-c="1"]').click(); await pg.locator('.iv-bar [data-iv-sz="2"]').click()
        await draw(pg, box, [(0.2, 0.5), (0.6, 0.55)])
        await pg.locator('.iv-bar [data-iv-tool="hl"]').click(); await pg.wait_for_timeout(100)
        check(await pg.locator(".iv-bar .iv-c").count() == 4, "4 highlighter colors")
        await draw(pg, box, [(0.15, 0.7), (0.8, 0.7)])
        check((await pg.evaluate(ST))["strokes"] == 3, "3 strokes")
        await pg.screenshot(path=SHOT + "ink_tools.png")
        await pg.wait_for_timeout(1600)
        rowj = q(f"select strokes::text from sheet_notes where member_id='{d2}' and key='s:{sv1}' and page=1")
        check(rowj and len(json.loads(rowj)) == 3, f"saved 3 strokes {rowj[:80] if rowj else rowj}")
        S = json.loads(rowj)
        check(S[1]["c"] == "#D93025" and S[1]["w"] == 56 and S[2]["t"] == "h", f"stroke props {[ (x['t'], x['c'], x['w']) for x in S]}")
        # 지우개 · 되돌리기
        await pg.locator('.iv-bar [data-iv-tool="eraser"]').click()
        await draw(pg, box, [(0.5, 0.15), (0.5, 0.3)])
        check((await pg.evaluate(ST))["strokes"] == 2, "eraser removed one stroke")
        await pg.locator('.iv-bar [data-iv="undo"]').click(); await pg.wait_for_timeout(100)
        check((await pg.evaluate(ST))["strokes"] == 3, "undo restores")
        # 필기 중 화면 끝 탭 → 안 넘어감
        pg0 = await pg.locator("#cvvPg").text_content()
        await pg.locator('.iv-bar [data-iv-tool="pen"]').click()
        await pg.locator(".cvv-tap.r").click(force=True); await pg.wait_for_timeout(500)
        check(await pg.locator("#cvvPg").text_content() == pg0, "no page turn while writing")
        if (await pg.evaluate(ST))["strokes"] == 4: await pg.locator('.iv-bar [data-iv="undo"]').click(); await pg.wait_for_timeout(100)
        check((await pg.evaluate(ST))["strokes"] == 3, "tap dot undone")
        # 완료 → 넘기기 됨
        await pg.locator('.iv-bar [data-iv="done"]').click(); await pg.wait_for_timeout(400)
        check(await pg.locator("#cvvInk .iv-bar").count() == 0, "done hides toolbar")
        await pg.wait_for_timeout(1300)
        check(len(json.loads(q(f"select strokes::text from sheet_notes where member_id='{d2}' and key='s:{sv1}' and page=1"))) == 3, "saved after done")
        # 확대: ctrl + 휠 → 끝 탭으로 안 넘어감 · 두 번 클릭 → 맞춤
        stage = await pg.locator("#cvvStage").bounding_box()
        await pg.mouse.move(stage["x"] + stage["width"] / 2, stage["y"] + stage["height"] / 2)
        await pg.keyboard.down("Control"); await pg.mouse.wheel(0, -400); await pg.keyboard.up("Control"); await pg.wait_for_timeout(500)
        s1 = await pg.evaluate(ST)
        check(s1["zoomed"] and s1["k"] > s1["kPage"] * 1.5, f"zoomed {s1}")
        await pg.screenshot(path=SHOT + "zoomed.png")
        await pg.mouse.click(stage["x"] + stage["width"] - 30, stage["y"] + stage["height"] / 2); await pg.wait_for_timeout(500)
        check(await pg.locator("#cvvPg").text_content() == pg0, "no edge turn while zoomed")
        await pg.mouse.dblclick(stage["x"] + stage["width"] / 2, stage["y"] + stage["height"] / 2); await pg.wait_for_timeout(400)
        check(not (await pg.evaluate(ST))["zoomed"], "double click fits")
        await pg.locator(".cvv-tap.r").click(); await pg.wait_for_timeout(1200)
        check(await pg.locator("#cvvPg").text_content() != pg0, "edge tap turns when not zoomed")
        await pg.keyboard.press("ArrowLeft"); await pg.wait_for_timeout(1200)
        # 여백 필기: 필기 중 축소 → 여백 종이 → 왼쪽 여백에 쓰기
        await pen.click(); await pg.wait_for_timeout(300)
        stage = await pg.locator("#cvvStage").bounding_box()
        await pg.mouse.move(stage["x"] + stage["width"] / 2, stage["y"] + stage["height"] / 2)
        await pg.keyboard.down("Control"); await pg.mouse.wheel(0, 500); await pg.keyboard.up("Control"); await pg.wait_for_timeout(500)
        s2 = await pg.evaluate(ST)
        check(s2["k"] < s2["kPage"] * 0.9 and await pg.locator(".iv-paper:not(.hidden)").count() == 1, f"zoom out shows margin paper {s2}")
        box = await pg.locator("#cvvCanvas").bounding_box()
        await draw(pg, box, [(-0.25, 0.3), (-0.1, 0.35), (-0.2, 0.45)])
        await pg.screenshot(path=SHOT + "margin_write.png")
        await pg.locator('.iv-bar [data-iv="done"]').click(); await pg.wait_for_timeout(1600)
        rowj = json.loads(q(f"select strokes::text from sheet_notes where member_id='{d2}' and key='s:{sv1}' and page=1"))
        check(len(rowj) == 4 and min(rowj[3]["p"][0::2]) < 0, f"margin stroke saved {rowj[-1]['p'][:4] if rowj else None}")
        s3 = await pg.evaluate(ST)
        check(s3["k"] < s3["kPage"] * 0.97 and await pg.locator(".iv-paper:not(.hidden)").count() == 1, f"auto-fit shows margin memo {s3}")
        await pg.screenshot(path=SHOT + "margin_fit.png")
        # 메모 숨기기 → 여백도 숨김
        hb = pg.locator(".cvv-top [data-iv=hide]")
        check(await hb.is_visible() and "숨기기" in await hb.text_content(), "hide button visible with memos")
        await hb.click(); await pg.wait_for_timeout(400)
        s4 = await pg.evaluate(ST)
        check(s4["strokes"] == 4 and abs(s4["k"] - s4["kPage"]) < 1 and await pg.locator(".iv-paper:not(.hidden)").count() == 0, f"hidden memos: page fit, no margin {s4}")
        check("메모 숨김" in await pen.text_content(), "pen button shows hidden")
        await pen.click(); await pg.wait_for_timeout(300)
        s5 = await pg.evaluate(ST)
        check(s5["pen"] and await pg.locator(".iv-bar .iv-c[aria-pressed=true]").count() == 1, "pen mode re-shows; remembers color")
        check(await pg.evaluate("JSON.parse(localStorage.getItem('pole2.ink.pref')).hide") is False, "pen mode unhides")
        await pg.locator('.iv-bar [data-iv="finger"]').click(); await pg.wait_for_timeout(100)
        check(await pg.evaluate("JSON.parse(localStorage.getItem('pole2.ink.pref')).finger") is True, "finger toggle saved")
        await pg.locator('.iv-bar [data-iv="finger"]').click()
        # 오프라인: 이 기기에 먼저 → 연결되면 올림
        await ctx.set_offline(True)
        box = await pg.locator("#cvvCanvas").bounding_box()
        await draw(pg, box, [(0.3, 0.85), (0.6, 0.88)])
        await pg.wait_for_timeout(1800)
        s6 = await pg.evaluate(ST)
        check(s6["pending"] >= 1 and len(json.loads(q(f"select strokes::text from sheet_notes where member_id='{d2}' and key='s:{sv1}' and page=1"))) == 4, f"offline pending {s6['pending']}")
        await ctx.set_offline(False); await pg.evaluate("window.dispatchEvent(new Event('online'))"); await pg.wait_for_timeout(2000)
        check((await pg.evaluate(ST))["pending"] == 0 and len(json.loads(q(f"select strokes::text from sheet_notes where member_id='{d2}' and key='s:{sv1}' and page=1"))) == 5, "synced after online")
        await pg.locator('.iv-bar [data-iv="done"]').click()
        # 적용찬양 쪽: 메모 안 씀
        await pg.locator(".cvv-jump button.applied").first.click(); await pg.wait_for_timeout(1500)
        check(not await pen.is_disabled() and ((await pg.evaluate(ST))["key"] or "").startswith("a:"), "applied: memo (v25)")
        # 예배 진행곡 쪽: 메모 됨 (p:id)
        await pg.locator(".cvv-jump button.proc").first.click(); await pg.wait_for_timeout(1500)
        check(((await pg.evaluate(ST))["key"] or "").startswith("p:") and not await pen.is_disabled(), "proc page memo key")
        check(pg.errs == [], f"member errs {pg.errs[:3]}")
        await ctx.close(); await b.close()

        # 다른 사람은 내 메모를 못 봄
        b, ctx = await browser(p, viewport={"width": 820, "height": 1180})
        lp = await login(ctx, "demo01@pole2.test", PW, dest=None)
        await lp.goto(BASE + f"/me.html#worship/{sid}"); await lp.wait_for_timeout(2000)
        await lp.click(".cv-pdfbar"); await lp.wait_for_timeout(2500)
        check((await lp.evaluate(ST))["strokes"] == 0, "leader sees none of member memos")
        await ctx.close(); await b.close()

        # ================= 6. 새 악보로 저장된 경우 → '이 곡 지난 메모 보기'
        ver = int(q(f"select version from setlists where service_id='{sid}'"))
        p3 = f"sheets/162/{U()}.pdf"; up(p3, FX + "conti5b.pdf", D1, "application/pdf")
        st, r = rpc("save_setlist", {"p_service": sid, "p_data": {"pages": 5, "items": [
            {"song_id": 162, "key": "G", "new_sheet": {"name": "공준혁 G 새판", "path": p3, "pages": 3, "size": 100}, "page_from": 1, "page_to": 3},
            {"song_id": 18, "key": "A", "sheet_id": int(q("select sheet_id from setlist_items i join setlists s on s.id=i.setlist_id where s.service_id='" + sid + "' and i.song_id=18"))}]}, "p_publish": True, "p_base": ver}, D1)
        check(st == 200, f"republish new sheet {st} {r}")
        b, ctx = await browser(p, viewport={"width": 1194, "height": 834})
        pg = await login(ctx, "demo02@pole2.test", PW, dest=None)
        await pg.goto(BASE + f"/me.html#worship/{sid}"); await pg.wait_for_timeout(2000)
        await pg.click(".cv-pdfbar"); await pg.wait_for_timeout(3000)
        s7 = await pg.evaluate(ST)
        check(s7["strokes"] == 0 and s7["hist"] == 1 and await pg.locator(".iv-hint:not(.hidden) [data-iv=hist]").count() == 1, f"history hint {s7}")
        await pg.click("[data-iv=hist]"); await pg.wait_for_timeout(2500)
        check(await pg.locator(".iv-ref").count() == 1 and "공준혁 G" in await pg.locator(".iv-ref-sel").text_content(), "history panel")
        cw = await pg.evaluate("document.querySelector('.iv-ref canvas').width")
        check(cw > 100, f"history canvas drawn {cw}")
        await pg.screenshot(path=SHOT + "history_memo.png")
        await pg.click("[data-ref=close]"); await pg.wait_for_timeout(200)
        check(await pg.locator(".iv-ref").count() == 0, "history panel closes")
        check(pg.errs == [], f"errs hist {pg.errs[:3]}")
        await ctx.close(); await b.close()

        # ================= 7. 백업찬양: 따라가며 메모 · 이전 판 메모
        b, ctx = await browser(p)
        ap_ = await login(ctx, "admin@x.com", "adminpass")
        await navclick(ap_, "songs"); await ap_.wait_for_timeout(2000)
        await ap_.locator("#bkBookFile").set_input_files(FX + "book.pdf"); await ap_.wait_for_timeout(3500)
        await ap_.fill("#biLabel", "Ver.2605"); await ap_.click("[data-bi=save]"); await ap_.wait_for_timeout(3500)
        await ctx.close(); await b.close()
        book = q("select id from backup_books where active")
        g = {c: q(f"select s.id from backup_songs s where s.book_id={book} and code='{c}'") for c in ("g40", "g51", "g54")}
        st, r = rpc("backup_update", {"p": {"candidates": [int(g["g40"]), int(g["g51"]), int(g["g54"])], "active": True, "now": f"b:{g['g40']}", "next": f"b:{g['g51']}"}}, D1)
        check(st == 200, f"leader starts live {st} {r}")
        mb, mctx = await browser(p, viewport={"width": 820, "height": 1180})
        mp = await login(mctx, "demo02@pole2.test", PW, dest=None)
        await mp.goto(BASE + "/me.html#worship"); await mp.wait_for_timeout(1500)
        await mp.click('#worshipNav [data-ws="backup"]'); await mp.wait_for_timeout(2500)
        await mp.locator(".bk-livecard").first.click(); await mp.wait_for_timeout(2500)
        BS = "document.querySelector('.bk-live')._iv.state"
        sb0 = await mp.evaluate(BS)
        check(sb0["key"] == "b:g40" and sb0["page"] == 1, f"backup ink key {sb0}")
        await mp.locator("#bkBar [data-iv=pen]").click(); await mp.wait_for_timeout(300)
        check(await mp.locator("#bkInk .iv-bar").count() == 1, "backup toolbar")
        box = await mp.locator("#bkCanvas").bounding_box()
        await draw(mp, box, [(0.3, 0.3), (0.6, 0.32)])
        # 인도자가 넘김 → 따라 넘어가고 메모는 저장 · 필기 모드 유지
        rpc("backup_update", {"p": {"now": f"b:{g['g51']}", "next": None}}, D1)
        await mp.wait_for_timeout(4500)
        sb1 = await mp.evaluate(BS)
        check(sb1["key"] == "b:g51" and sb1["pen"] and await mp.locator("#bkInk .iv-bar").count() == 1, f"followed while writing {sb1}")
        await mp.wait_for_timeout(1200)
        rw = q(f"select ver||'|'||jsonb_array_length(strokes) from sheet_notes where member_id='{d2}' and key='b:g40'")
        check(rw == f"{book}|1", f"backup memo saved with book ver {rw}")
        await mp.screenshot(path=SHOT + "backup_pen.png")
        # 예배 진행곡(성찬)도 진행 화면 칩에
        await mp.locator("#bkInk [data-iv=done]").click()
        mini = await mp.locator("#bkMini").text_content()
        check(("성찬 찬양 1" in mini) == (q("select communion_on(current_date)") == "t"), f"communion chips follow week {mini}")
        check(mp.errs == [], f"backup errs {mp.errs[:3]}")
        rpc("backup_update", {"p": {"active": False}}, D1)
        await mp.wait_for_timeout(4000)
        # 악보집 판이 바뀐 경우 → '이전 판 메모'
        q(f"update sheet_notes set ver='old' where key='b:g40'")
        await mp.goto(BASE + "/me.html#worship"); await mp.wait_for_timeout(1000); await mp.reload(); await mp.wait_for_timeout(2000)
        await mp.click('#worshipNav [data-ws="backup"]'); await mp.wait_for_timeout(2500)
        await mp.locator(f'[data-bk-song="{g["g40"]}"]').first.click(); await mp.wait_for_timeout(2500)
        sv = await mp.evaluate(ST)
        check(sv["key"] == "b:g40" and sv["strokes"] == 1 and sv["oldVer"], f"old version memo {sv}")
        check(await mp.locator(".iv-hint:not(.hidden) .iv-oldtag").count() == 1, "old version tag on page")
        await mp.locator("[data-iv=pen]").click(); await mp.wait_for_timeout(300)
        check("이전 판 메모" in await mp.locator("#cvvInk").text_content(), "old version chip")
        await mp.screenshot(path=SHOT + "backup_oldver.png")
        await mctx.close(); await mb.close()

        # ================= 8. 폰: 도구 막대 가로 넘침 없음
        b, ctx = await browser(p, mobile=True)
        pg = await login(ctx, "demo02@pole2.test", PW, dest=None)
        await pg.goto(BASE + f"/me.html#worship/{sid}"); await pg.wait_for_timeout(2000)
        await pg.click(".cv-pdfbar"); await pg.wait_for_timeout(2500)
        await pg.locator("[data-iv=pen]").click(); await pg.wait_for_timeout(300)
        sw = await pg.evaluate("document.documentElement.scrollWidth")
        check(sw <= 392, f"phone no h-scroll {sw}")
        # 손가락: 펜 모드에서도 기본은 확대 · 이동만 (안 그려짐) → '손가락으로 쓰기' 켜면 그려짐 · 두 손가락은 확대
        cdp = await ctx.new_cdp_session(pg)
        stb = await pg.locator("#cvvStage").bounding_box()
        cx, cy = stb["x"] + stb["width"] / 2, stb["y"] + stb["height"] / 2
        async def touch(kind, pts):
            await cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)]})
        async def swipe1(x0, y0, x1, y1):
            await touch("touchStart", [(x0, y0)])
            for t in range(1, 7): await touch("touchMove", [(x0 + (x1 - x0) * t / 6, y0 + (y1 - y0) * t / 6)])
            await touch("touchEnd", []); await pg.wait_for_timeout(200)
        n0 = (await pg.evaluate(ST))["strokes"]
        await swipe1(cx - 60, cy, cx + 40, cy + 30)
        check((await pg.evaluate(ST))["strokes"] == n0, "finger does not draw by default")
        await pg.locator('.iv-bar [data-iv="finger"]').click()
        await swipe1(cx - 60, cy, cx + 40, cy + 30)
        check((await pg.evaluate(ST))["strokes"] == n0 + 1, "finger draws when on")
        await pg.locator('.iv-bar [data-iv="finger"]').click()
        await pg.locator('.iv-bar [data-iv="done"]').click(); await pg.wait_for_timeout(300)
        k0 = (await pg.evaluate(ST))["k"]
        await touch("touchStart", [(cx - 30, cy), (cx + 30, cy)])
        for t in range(1, 8): await touch("touchMove", [(cx - 30 - t * 15, cy), (cx + 30 + t * 15, cy)])
        await touch("touchEnd", []); await pg.wait_for_timeout(300)
        s8 = await pg.evaluate(ST)
        check(s8["k"] > k0 * 1.8 and s8["zoomed"], f"pinch zoom {k0} -> {s8['k']}")
        pgA = await pg.locator("#cvvPg").text_content()
        await swipe1(cx + 100, cy, cx - 100, cy)
        check(await pg.locator("#cvvPg").text_content() == pgA, "swipe pans (no turn) while zoomed")
        for _ in range(2):
            await touch("touchStart", [(cx, cy)]); await touch("touchEnd", []); await pg.wait_for_timeout(80)
        await pg.wait_for_timeout(300)
        check(not (await pg.evaluate(ST))["zoomed"], "double tap fits")
        await swipe1(cx + 120, cy, cx - 120, cy); await pg.wait_for_timeout(1200)
        check(await pg.locator("#cvvPg").text_content() != pgA, "swipe turns page at fit")
        await pg.screenshot(path=SHOT + "phone_pen.png")
        check(pg.errs == [], f"phone errs {pg.errs[:3]}")
        await ctx.close(); await b.close()

    print("ok", ok, "bad", bad)

asyncio.run(main())
