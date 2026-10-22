import asyncio, sys, json, subprocess, os, re, urllib.request
sys.path.insert(0, "/home/claude/tests")
from h import *
def q(sql):
    return subprocess.run(["su","postgres","-c",f"psql -d wt -At -c \"{sql}\""],capture_output=True,text=True).stdout.strip()
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
ok=0; bad=[]
def check(c, msg):
    global ok
    if c: ok+=1
    else: bad.append(msg); print("FAIL", msg)
SHOT = "/home/claude/tests/v22_"
FX = "/home/claude/tests/fx/"
PW = "pole2test!"

async def main():
    T = tok("admin@x.com", "adminpass")
    st, r = http("/api/demo", {"action": "seed"}, T); print("seed", st, r.get("members"))
    q("insert into push_subscriptions(endpoint, member_id, p256dh, auth) select 'https://push.test/'||id, id, 'k', 'a' from members where is_active on conflict do nothing")
    D1, D2, D6 = tok("demo01@pole2.test", PW), tok("demo02@pole2.test", PW), tok("demo06@pole2.test", PW)
    sun = q("select min(service_date) from services where ministry_id is null and status='published' and service_date >= current_date")
    sid = q(f"select id from services where service_date='{sun}' and ministry_id is null")
    d1 = q("select id from members where email='demo01@pole2.test'")
    print("sunday", sun, sid)
    # 3주 뒤 주일 (큰 PDF · 마감 알림 확인용)
    import datetime
    sd = datetime.date.fromisoformat(sun) + datetime.timedelta(days=14)
    q(f"insert into services(service_date, status) values ('{sd}', 'published') on conflict do nothing")
    sid2 = q(f"select id from services where service_date='{sd}' and ministry_id is null")
    q(f"update services set status='published' where id='{sid2}'")
    q(f"insert into assignments(service_id, position_code, slot, member_id) values ('{sid2}', 'leader', 1, (select id from members where email='demo01@pole2.test')), ('{sid2}', 'singer', 1, (select id from members where email='demo04@pole2.test'))")

    # ---------------- 읽기 · 권한
    st, b = rpc("conti_one", {"p_service": sid}, D2)
    check(st == 200 and b["can_edit"] is False and b["setlist"] is None and b["deadline"] and b["target_sec"] in (1200, 1500), f"conti_one member {st} {str(b)[:120]}")
    st, b = rpc("conti_one", {"p_service": sid}, D1)
    check(b["can_edit"] is True, "leader can edit")
    check(rpc("conti_one", {"p_service": sid}, D6)[1]["can_edit"] is True, "band master can edit")
    st, b = rpc("conti_week", {"p_from": sun, "p_to": sun}, None)
    check(st in (401, 403) or not b, f"anon conti_week {st}")
    check(rpc("can_upload_sheet", {}, D1)[1] is True and rpc("can_upload_sheet", {}, D2)[1] is False, "can_upload_sheet")
    dl = rpc("conti_deadline", {"p_service": sid}, D2)[1]
    check("22:00:00" in dl.replace("T", " ") or dl.endswith("13:00:00+00:00"), f"deadline wed 22 {dl}")

    # 일반 팀원은 못 씀
    st, r = rpc("save_setlist", {"p_service": sid, "p_data": {"items": [{"song_id": 162}]}, "p_publish": False, "p_base": None}, D2)
    check(st >= 400, f"member save blocked {st}")
    # 임시 저장 (팀원에게 안 보임)
    st, r = rpc("save_setlist", {"p_service": sid, "p_data": {"items": [{"song_id": 162, "key": "G"}, {"song_id": 18, "key": "A"}]}, "p_publish": False, "p_base": None}, D1)
    check(st == 200 and r["status"] == "draft", f"draft save {st} {r}")
    base = r["version"]
    check(rpc("conti_one", {"p_service": sid}, D2)[1]["setlist"] is None, "draft hidden from member")
    st, rows = http(f"/rest/v1/setlists?service_id=eq.{sid}", None, D2)
    check(st == 200 and rows == [], f"draft hidden via REST {rows}")
    check(len(rpc("conti_one", {"p_service": sid}, D6)[1]["setlist"]["items"]) == 2, "bm sees draft")
    # 동시에 고친 경우
    st, r = rpc("save_setlist", {"p_service": sid, "p_data": {"items": [{"song_id": 162}]}, "p_publish": False, "p_base": base + 5}, D1)
    check(st == 409 or (isinstance(r, dict) and r.get("code") == "PT409"), f"stale base 409 {st} {r}")

    # 악보 파일: 팀원은 못 올림
    pdf = open(FX + "conti5.pdf", "rb").read()
    st, r = http("/storage/v1/object/sheets/sheets/162/11111111-1111-4111-8111-111111111111.pdf", raw=pdf, token=D2, ctype="application/pdf")
    check(st in (400, 401, 403), f"member upload blocked {st}")
    st, r = http("/storage/v1/object/sheets/sheets/162/11111111-1111-4111-8111-111111111111.pdf", raw=b"hello", token=D1, ctype="text/plain")
    check(st >= 400, f"non-pdf blocked {st}")
    # 잘못된 경로로 새 악보 저장은 막음
    st, r = rpc("save_setlist", {"p_service": sid, "p_data": {"items": [{"song_id": 162, "new_sheet": {"name": "x", "path": "sheets/18/11111111-1111-4111-8111-111111111111.pdf", "pages": 1}}]}, "p_publish": True, "p_base": base}, D1)
    check(st >= 400, f"bad sheet path blocked {st}")
    check(q("select count(*) from sheet_versions") == "0", "no sheet saved")

    # 곡 더하기 (같은 이름이면 그 곡)
    st, sidA = rpc("add_song", {"p_title": "놀라우신  은혜"}, D1)
    check(st == 200 and sidA == 18, f"add_song existing {sidA}")
    check(rpc("add_song", {"p_title": "x"}, D2)[0] >= 400, "member add_song blocked")

    # ---------------- 화면: 인도자 콘티 쓰기 (태블릿)
    async with async_playwright() as p:
        b, ctx = await browser(p, viewport={"width": 820, "height": 1180}, has_touch=True)
        pg = await login(ctx, "demo01@pole2.test", PW, dest=None)
        if "me.html" not in pg.url: await pg.goto(BASE + "/me.html")
        await pg.goto(BASE + "/me.html#worship"); await pg.wait_for_timeout(1800)
        check(await pg.locator("#worshipNav").is_visible(), "worship subnav")
        check(await pg.locator(".cv-hero .big").count() == 1, "conti hero")
        hero = await pg.locator(".cv-hero").text_content()
        check("나도 섬겨요" in hero and "인도" in hero, f"hero mine {hero[:80]}")
        check(await pg.locator(".cv-wait").count() == 1, "waiting card (draft only)")
        await pg.screenshot(path=SHOT + "me_conti_draft.png", full_page=True)
        await pg.click("[data-cv-edit]"); await pg.wait_for_timeout(1500)
        check(await pg.locator(".cv-editor").count() == 1, "editor open")
        check(await pg.locator(".ce-row").count() == 2, "draft rows loaded")
        check(await pg.locator("#ceRt").count() == 1 and "목표" in await pg.locator("#ceRt").text_content(), "RT card")
        # 곡 추가: 검색 → 넣으면 칩
        await pg.fill("#ceQ", "주님의 선하"); await pg.wait_for_timeout(300)
        check(await pg.locator("#ceDrop [data-add]").count() >= 1, "search hits")
        await pg.locator("#ceDrop [data-add]").first.click(); await pg.wait_for_timeout(800)
        check(await pg.locator(".ce-row").count() == 3, "song added")
        # 새 곡
        await pg.fill("#ceQ", "테스트 새 찬양"); await pg.wait_for_timeout(300)
        await pg.click("[data-ce=newsong]"); await pg.wait_for_timeout(800)
        check(await pg.locator(".ce-row").count() == 4 and q("select count(*) from songs where title='테스트 새 찬양'") == "1", "new song added")
        # 키 · 시간
        k0 = pg.locator(".ce-row").nth(0).locator("[data-f=key]")
        await k0.fill("A"); await k0.dispatch_event("input")
        t3 = pg.locator(".ce-row").nth(3).locator("[data-f=dur]")
        await t3.fill("4:30"); await t3.dispatch_event("change"); await pg.wait_for_timeout(400)
        check("직접" in await pg.locator(".ce-row").nth(3).locator(".ce-src").text_content(), "manual duration tag")
        rt = await pg.locator("#ceRt b").first.text_content()
        check(rt.strip() != "0:00", f"RT counted {rt}")
        # 메모 · 메들리
        await pg.locator(".ce-row").nth(1).locator("[data-ce=more]").click(); await pg.wait_for_timeout(200)
        m = pg.locator(".ce-row").nth(1).locator("[data-f=memo]"); await m.fill("A → Bb로 올림"); await m.dispatch_event("input")
        # 끌어서 순서: 4번째 곡을 맨 위로
        await pg.evaluate("document.querySelector('#ceList').scrollIntoView({block:'start'})"); await pg.wait_for_timeout(200)
        g = pg.locator(".ce-row").nth(3).locator("[data-grip]"); gb = await g.bounding_box()
        top = await pg.locator(".ce-row").nth(0).bounding_box()
        await pg.mouse.move(gb["x"] + 10, gb["y"] + 10); await pg.mouse.down()
        await pg.mouse.move(gb["x"] + 10, top["y"] + 5, steps=8); await pg.mouse.up(); await pg.wait_for_timeout(400)
        first = await pg.locator(".ce-row").nth(0).locator(".ce-t b").text_content()
        check(first == "테스트 새 찬양", f"drag reorder {first}")
        # 이 기기에 남김
        check(await pg.evaluate(f"!!localStorage.getItem('pole2.conti.draft.{sid}')"), "local draft kept")
        # 악보: 곡마다 저장된 악보가 없으니 '새로 저장'
        check(await pg.locator(".ce-new input[data-f=sheetname]").count() == 4, "all rows new sheet")
        nm = await pg.locator(".ce-new input[data-f=sheetname]").first.input_value()
        check(nm.startswith("demo") or len(nm) > 0, f"default sheet name {nm}")
        # 초안 PDF
        async with pg.expect_download() as dl_info:
            await pg.click("[data-ce=draft]")
        dlf = await dl_info.value; path = await dlf.path()
        import pypdf
        check(len(pypdf.PdfReader(path).pages) == 4, "draft pdf 4 blank pages")
        # 통합본 올리기
        await pg.locator("[data-ce-file]").set_input_files(FX + "conti5.pdf"); await pg.wait_for_timeout(2500)
        check(await pg.locator(".ce-pg").count() == 5, "5 page thumbs")
        tags = await pg.locator(".ce-pg .tag").all_text_contents()
        check(tags[0].startswith("1") and tags[-1].startswith("4"), f"auto tags {tags}")
        check("압축 없이" in await pg.locator(".ce-upl").text_content(), "small pdf no compression")
        # 쪽 고치기: 2쪽을 1번 곡으로
        await pg.locator(".ce-pg").nth(1).click(); await pg.wait_for_timeout(200)
        await pg.locator(".ce-pgpick [data-pgset='0']").click(); await pg.wait_for_timeout(500)
        tags = await pg.locator(".ce-pg .tag").all_text_contents()
        check(tags[0][0] == "1" and tags[1][0] == "1", f"retag {tags}")
        check(await pg.locator(".ce-sum-r.new").count() >= 3, "summary new rows")
        await pg.screenshot(path=SHOT + "editor.png", full_page=False)
        await pg.locator(".ce-pdf").screenshot(path=SHOT + "editor_pdf.png")
        n0 = len(pushlog())
        await pg.click("[data-ce=publish]")
        await pg.wait_for_selector(".cv-editor", state="detached", timeout=15000)
        tt = await pg.locator(".toast").all_text_contents()
        check(any("올렸어요" in t for t in tt), f"publish toast {tt}")
        check(await pg.locator(".cv-editor").count() == 0, "editor closed")
        check(q(f"select status||'|'||version||'|'||notified_version from setlists where service_id='{sid}'") == "published|2|2" or q(f"select status from setlists where service_id='{sid}'") == "published", "published row " + q(f"select status||'|'||version||'|'||notified_version from setlists where service_id='{sid}'"))
        nsv = q("select count(*) from sheet_versions where kind='sheet'")
        check(nsv in ("3", "4"), f"sheet versions saved {nsv}")
        files = sum(len(f) for _, _, f in os.walk("/home/claude/pgrst/storage/sheets"))
        check(files == int(nsv), f"storage files {files}")
        check(q(f"select count(*) from songs where team_sec=270") == "1", "manual duration -> team_sec")
        new = pushlog()[n0:]
        ppl = q(f"select count(distinct member_id) from assignments where service_id='{sid}' and member_id is not null and member_id<>'{d1}'")
        check(len(new) == int(ppl) and all("콘티가 올라왔어요" in x.get("title", "") for x in new), f"conti_up push {len(new)} vs {ppl} {new[:1]}")
        check(not await pg.evaluate(f"!!localStorage.getItem('pole2.conti.draft.{sid}')"), "local draft cleared")
        # 다시 알림 요청 → 건너뜀
        st, r = http("/api/conti", {"action": "notify", "service_id": sid}, D1)
        check(st == 200 and r.get("skipped"), f"notify once {r}")
        st, r = http("/api/conti", {"action": "notify", "service_id": sid}, D2)
        check(st == 403, f"member notify blocked {st}")
        await pg.wait_for_timeout(800)
        check(await pg.locator(".cv-pdfbar").count() == 1, "pdf bar after publish")
        check(await pg.locator(".cv-srow").count() == 4, "song list")
        await pg.screenshot(path=SHOT + "me_conti_tablet.png", full_page=True)

        # 수정 올리기: 키 바꿈
        await pg.click("[data-cv-edit]"); await pg.wait_for_timeout(1500)
        check("수정 올리기" in await pg.locator("[data-ce=publish]").text_content() and await pg.locator("[data-ce=save]").count() == 0, "republish only")
        check(await pg.locator(".ce-shsel").count() == 4, "saved sheets selected")
        k = pg.locator(".ce-row").nth(1).locator("[data-f=key]"); await k.fill("Bb"); await k.dispatch_event("input")
        # 악보 고르기 · 미리보기
        await pg.locator(".ce-row").nth(1).locator("[data-ce=sheet-open]").click(); await pg.wait_for_timeout(300)
        check(await pg.locator(".ce-shlist .ce-opt").count() >= 3, "sheet list options")
        await pg.locator(".ce-shlist [data-ce=sheet-pv]").first.click(); await pg.wait_for_timeout(300)
        check(await pg.locator(".ce-prev").count() == 1 and await pg.locator(".ce-prev img").count() == 1, "preview with thumb")
        await pg.locator(".ce-prev [data-ce=sheet-use]").click(); await pg.wait_for_timeout(300)
        # 다른 통합본을 올리면 → 달라 보임 확인
        await pg.locator("[data-ce-file]").set_input_files(FX + "conti5b.pdf"); await pg.wait_for_timeout(2500)
        asks = await pg.locator(".ce-sum-r.ask").count()
        check(asks >= 1, f"different-looking asks {asks}")
        await pg.click("[data-ce=publish]"); await pg.wait_for_timeout(600)
        check(any("먼저 골라" in t for t in await pg.locator(".toast").all_text_contents()), "publish blocked until decided")
        await pg.locator(".ce-sum").screenshot(path=SHOT + "editor_compare.png")
        while await pg.locator("[data-cmp=keep]").count():
            await pg.locator("[data-cmp=keep]").first.click(); await pg.wait_for_timeout(300)
        n0 = len(pushlog())
        await pg.click("[data-ce=publish]"); await pg.wait_for_timeout(4000)
        new = pushlog()[n0:]
        check(len(new) == int(ppl) and all("수정됐어요" in x["title"] and "키" in x.get("body", "") for x in new), f"conti_edit push {new[:1]}")
        check(q("select count(*) from sheet_versions where kind='sheet'") == nsv, "keep -> no new sheets")
        check(q(f"select count(*) from setlist_versions v join setlists s on s.id=v.setlist_id where s.service_id='{sid}'") == "1", "snapshot kept")
        await ctx.close(); await b.close()

        # ---------------- 화면: 팀원 보기 (휴대폰)
        b, ctx = await browser(p, mobile=True)
        pg = await login(ctx, "demo02@pole2.test", PW, dest=None)
        await pg.goto(BASE + f"/me.html#worship/{sid}"); await pg.wait_for_timeout(2000)
        check(await pg.locator("#view-worship").is_visible() and await pg.locator(".cv-pdfbar").count() == 1, "deep link to conti")
        chip = await pg.locator(".cv-ct .chip-mid").all_text_contents()
        check(any("수정됨" in c and "키" in c for c in chip), f"edited chip {chip}")
        check(await pg.locator(".cv-key.chg").count() == 1, "changed key highlighted")
        check(await pg.locator(".cv-memo").count() == 1, "memo shown")
        check(await pg.locator("[data-cv-edit]").count() == 0, "member no edit")
        await pg.screenshot(path=SHOT + "me_conti_phone.png", full_page=True)
        await pg.click(".cv-pdfbar"); await pg.wait_for_timeout(2500)
        check(await pg.locator(".cv-viewer").count() == 1, "viewer open")
        cw = await pg.evaluate("document.querySelector('#cvvCanvas').width")
        check(cw > 300, f"page rendered {cw}")
        pg1 = await pg.locator("#cvvPg").text_content()
        await pg.keyboard.press("ArrowRight"); await pg.wait_for_timeout(1000)
        pg2 = await pg.locator("#cvvPg").text_content()
        check(pg1.startswith("1 /") and pg2.startswith("2 /"), f"next page {pg1} {pg2}")
        await pg.screenshot(path=SHOT + "viewer_phone.png")
        await pg.locator("[data-cvv-song='3']").click(); await pg.wait_for_timeout(800)
        check("4 /" not in pg2 and await pg.locator("[data-cvv-song='3'][aria-pressed=true]").count() == 1, "jump to song 4")
        # 뒤로가기 = 보기 닫기 (찬양 화면 그대로)
        await pg.go_back(); await pg.wait_for_timeout(600)
        check(await pg.locator(".cv-viewer").count() == 0 and "#worship" in pg.url, f"back closes viewer {pg.url}")
        # 이 기기에 저장됨 → 오프라인에서도 열림
        await ctx.set_offline(True)
        await pg.click(".cv-pdfbar"); await pg.wait_for_timeout(1500)
        cw2 = await pg.evaluate("document.querySelector('#cvvCanvas') && document.querySelector('#cvvCanvas').width")
        check(cw2 and cw2 > 300, "offline viewer from cache")
        await pg.go_back(); await ctx.set_offline(False); await pg.wait_for_timeout(300)
        # 곡 상세
        await pg.locator(".cv-st").first.click(); await pg.wait_for_timeout(1500)
        check(await pg.locator(".cv-sheetpage").count() == 1 and await pg.locator(".cv-sheetpage .cv-sheet").count() >= 1, "song detail sheets")
        check(await pg.locator("#sdOrig").count() == 0, "member no original upload")
        await pg.screenshot(path=SHOT + "song_detail.png")
        await pg.go_back(); await pg.wait_for_timeout(400)
        # 기록 탭
        await pg.click('#worshipNav [data-ws="history"]'); await pg.wait_for_timeout(2500)
        check(await pg.locator("#wsHist .hx-tabs button").count() == 5, "history tab still works")
        check(pg.errs == [], f"member errors {pg.errs}")
        await ctx.close(); await b.close()

        # ---------------- 화면: 리더십
        b, ctx = await browser(p)
        pg = await login(ctx, "admin@x.com", "adminpass")
        await navclick(pg, "conti"); await pg.wait_for_timeout(2000)
        check(await pg.locator(".ca-table tbody tr[data-sid]").count() >= 2, "admin conti list")
        st_txt = await pg.locator(f'.ca-table tr[data-sid="{sid}"]').text_content()
        check("수정됨" in st_txt, f"status edited {st_txt[:80]}")
        await pg.screenshot(path=SHOT + "admin_conti.png", full_page=True)
        # 마감 · 목표 바꾸기 (prompt 두 번)
        answers = [f"{sun} 09:00", "18"]
        pg.on("dialog", lambda d: asyncio.ensure_future(d.accept(answers.pop(0) if answers else "")))
        await pg.locator(f'.ca-table tr[data-sid="{sid}"] [data-ca=meta]').click(); await pg.wait_for_timeout(1500)
        check(q(f"select target_sec from setlists where service_id='{sid}'") == "1080", "target set 18m")
        check(q(f"select to_char(deadline at time zone 'Asia/Seoul','HH24:MI') from setlists where service_id='{sid}'") == "09:00", "deadline set")
        # 기본값 저장
        await pg.fill("#caFirst", "22"); await pg.click("#caSave"); await pg.wait_for_timeout(800)
        check(q("select conti->>'rt_first' from team_settings") == "1320", "settings saved")
        # 리더십도 콘티 열기
        await pg.locator(f'.ca-table tr[data-sid="{sid}"] [data-ca=edit]').click(); await pg.wait_for_timeout(1500)
        check(await pg.locator(".cv-editor .ce-row").count() == 4, "admin editor")
        await pg.click("[data-ce=close]"); await pg.wait_for_timeout(600)
        check(await pg.locator(".cv-editor").count() == 0 and "#conti" in pg.url, f"admin editor closed {pg.url}")
        # 알림 설정
        await navclick(pg, "notify"); await pg.wait_for_timeout(800)
        await pg.click('[data-ntab="settings"]'); await pg.wait_for_timeout(800)
        check(await pg.locator('[data-nk="conti_open"]').count() == 1 and await pg.locator('[data-nk="conti_edit"]').count() == 1, "conti notify kinds")
        await pg.click('[data-nk="conti_remind"]'); await pg.wait_for_timeout(500)
        check(await pg.locator("[data-sc-days='0']").count() == 1, "remind schedule editor")
        await pg.click('[data-nk="conti_open"]'); await pg.wait_for_timeout(500)
        check(await pg.locator("#scBd").count() == 1, "open schedule editor")
        await pg.select_option("#scBd", "5"); await pg.wait_for_timeout(300); await pg.click("#nsSave"); await pg.wait_for_timeout(600)
        check(q("select schedule->>'days' from notify_settings where kind='conti_open'") == "5", "conti_open schedule saved")
        await pg.click("#nsTest"); await pg.wait_for_timeout(800)
        check(q("select count(*) from notifications where kind='conti' and target_label like '테스트%'") == "1", "test conti notify")
        await pg.screenshot(path=SHOT + "admin_notify.png")
        # 곡
        await navclick(pg, "songs"); await pg.wait_for_timeout(1500)
        check(await pg.locator("#songYt").count() == 1, "yt fill button")
        await pg.fill("#songQ", "테스트 새"); await pg.wait_for_timeout(300)
        row = await pg.locator("#songBody tr").first.text_content()
        check("4:30" in row, f"team_sec column {row}")
        await pg.click("#songYt"); await pg.wait_for_timeout(800)
        check(any("YOUTUBE_API_KEY" in t for t in await pg.locator(".toast").all_text_contents()), "yt fill needs key")
        await pg.locator("#songBody .song-name").first.click(); await pg.wait_for_timeout(1500)
        check(await pg.locator(".cv-sheetpage #sdOrig").count() == 1, "admin can upload original")
        answers.append("G")
        await pg.locator("#sdOrig").set_input_files(FX + "conti5.pdf"); await pg.wait_for_timeout(3000)
        check(q("select count(*) from sheet_versions where kind='original'") == "1", "original uploaded")
        await pg.go_back(); await pg.wait_for_timeout(400)
        # 큰 PDF: 5MB 넘으면 줄여서
        await navclick(pg, "conti"); await pg.wait_for_timeout(1500)
        await pg.locator(f'.ca-table tr[data-sid="{sid2}"] [data-ca=edit]').click(); await pg.wait_for_timeout(1500)
        await pg.fill("#ceQ", "We Praise"); await pg.wait_for_timeout(300); await pg.locator("#ceDrop [data-add]").first.click(); await pg.wait_for_timeout(800)
        await pg.locator("[data-ce-file]").set_input_files(FX + "big.pdf"); await pg.wait_for_timeout(4000)
        check("줄여서" in await pg.locator(".ce-upl").text_content(), "big pdf notice")
        # 새로 저장으로 (저장된 악보가 있으면 그걸 고르니까)
        if await pg.locator(".ce-row [data-ce=sheet-open]").count():
            await pg.locator(".ce-row [data-ce=sheet-open]").first.click(); await pg.wait_for_timeout(300)
            await pg.locator("[data-ce=sheet-new]").click(); await pg.wait_for_timeout(300)
        await pg.click("[data-ce=publish]"); await pg.wait_for_timeout(9000)
        sz = q("select max(size_bytes) from sheet_versions where kind='sheet' and song_id=162")
        check(sz and int(sz) < 5 * 1024 * 1024, f"compressed size {sz}")
        check(pg.errs == [], f"admin errors {pg.errs}")
        await ctx.close(); await b.close()

    # ---------------- 마감 알림 (cron)
    q(f"delete from setlists where service_id='{sid2}'")
    q("update notify_settings set schedule=jsonb_build_object('days',7,'hour',18) where kind='conti_open'")
    def cron(day, hour):
        utc = datetime.datetime(day.year, day.month, day.day, hour) - datetime.timedelta(hours=9)
        return http(f"/api/cron?key=cron-test&now={utc.isoformat()}Z")
    n0 = len(pushlog())
    st, r = cron(sd - datetime.timedelta(days=7), 18)
    sent = [x for x in r.get("sent", []) if x["kind"] == "conti_open"]
    check(st == 200 and len(sent) == 1, f"cron conti_open {r}")
    cron(sd - datetime.timedelta(days=7), 18)
    check(len([x for x in pushlog()[n0:] if "준비해 주세요" in x["title"]]) == 1, "conti_open once")
    wed = sd - datetime.timedelta(days=4)   # 주일 → 수요일 마감
    st, r = cron(wed - datetime.timedelta(days=1), 18)
    check(any(x["kind"] == "conti_remind" for x in r.get("sent", [])), f"remind day before {r}")
    st, r = cron(wed, 18)
    check(any(x["kind"] == "conti_remind" for x in r.get("sent", [])), f"remind same day {r}")
    st, r = cron(wed, 23)
    check(not r.get("sent"), "no remind after deadline")
    rm = [x for x in pushlog()[n0:] if "마감]" in x["title"]]
    check(len(rm) == 2 and "내일" in rm[0]["title"], f"remind titles {[x['title'] for x in rm]}")
    check(r.get("errors") is None, f"cron errors {r.get('errors')}")
    # 기록: 올라온 주일 콘티가 쌓임
    st, hb = rpc("history_bundle", {}, D2)
    check(not any(s.get("d") == sun for s in hb["setlists"]), "history excludes upcoming conti")
    q(f"update setlists set service_date = current_date - 1 where service_id='{sid}'")
    st, hb = rpc("history_bundle", {}, D2)
    check(any(s.get("d") == hb["setlists"][-1]["d"] and len(s["items"]) == 4 for s in hb["setlists"][-1:]), "history includes held conti")
    print("ok", ok, "bad", bad)

asyncio.run(main())
