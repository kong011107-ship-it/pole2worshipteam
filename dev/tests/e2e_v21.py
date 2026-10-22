import asyncio, sys, json, subprocess, os, re, urllib.request, urllib.parse
sys.path.insert(0, "/home/claude/tests")
from h import *
def q(sql):
    return subprocess.run(["su","postgres","-c",f"psql -d wt -At -c \"{sql}\""],capture_output=True,text=True).stdout.strip()
LOG = "/home/claude/pgrst/push.log"
def pushlog():
    if not os.path.exists(LOG): return []
    return [json.loads(l) for l in open(LOG) if l.strip()]
def http(path, body=None, token=None, headers=None, method=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, method=method or ("POST" if body is not None else "GET"))
    req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", "Bearer " + token)
    for k, v in (headers or {}).items(): req.add_header(k, v)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read(); return r.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read(); return e.code, json.loads(raw) if raw else {}
def tok(email, pw): return http("/auth/v1/token?grant_type=password", {"email": email, "password": pw})[1]["access_token"]
def rest(path, token, body=None, method=None, prefer=None):
    return http("/rest/v1/" + path, body, token, {"Prefer": prefer} if prefer else None, method)
ok=0; bad=[]
def check(c, msg):
    global ok
    if c: ok+=1
    else: bad.append(msg); print("FAIL", msg)
SHOT = "/home/claude/tests/v21_"

async def main():
    T = tok("admin@x.com", "adminpass"); L2 = tok("lead2@x.com", "lead2pass")
    st, r = http("/api/demo", {"action": "seed"}, T); print("seed", st, r.get("members"))
    q("insert into push_subscriptions(endpoint, member_id, p256dh, auth) select 'https://push.test/'||id, id, 'k', 'a' from members where is_active on conflict do nothing")
    D2 = tok("demo02@pole2.test", "pole2test!")

    # ---------------- DB · API
    st, b = http("/rest/v1/rpc/history_bundle", {}, D2)
    check(st == 200 and len(b["songs"]) == 387 and len(b["setlists"]) == 237 and len(b["lineup"]) == 2100, f"history_bundle member {st}")
    st, b = http("/rest/v1/rpc/history_bundle", {}, None)
    check(st in (401, 403) or b in (None, {}), f"history_bundle anon {st} {str(b)[:60]}")

    # 예배MC 등록: 최상위 리더십만
    st, r = http("/api/members-bulk", {"action": "add", "rows": [{"name": "MC테스트", "email": "mc1@pole2.test", "status": "mc"}], "password": "pole2mc!234"}, L2)
    check(st == 403, f"non-owner add mc {st} {r}")
    st, r = http("/api/members-bulk", {"action": "add", "rows": [{"name": "박예배", "email": "mc1@pole2.test", "status": "mc"}, {"name": "김목사", "email": "pastor1@pole2.test", "status": "pastor"}], "password": "pole2mc!234"}, T)
    check(st == 200 and all(x["ok"] for x in r["results"]), f"owner add mc/pastor {st} {r}")
    row = q("select status||'|'||role||'|'||coalesce(main_position,'-') from members where email='mc1@pole2.test'")
    check(row == "mc|admin|-", f"mc row {row}")
    mc = q("select id from members where email='mc1@pole2.test'"); pastor = q("select id from members where email='pastor1@pole2.test'")
    d3 = q("select id from members where email='demo03@pole2.test'")
    # 리더십(최상위 아님)은 구분을 못 바꿈
    st, r = rest(f"members?id=eq.{d3}", L2, {"status": "pastor"}, "PATCH")
    check(st >= 400 and "최상위" in json.dumps(r, ensure_ascii=False), f"lead2 status->pastor {st} {r}")
    check(q(f"select status from members where id='{d3}'") == "active", "d3 still active")

    # 배치: 예배MC는 어느 자리든 · 어쿠스틱 1자리
    sun = q("select min(service_date) from services where ministry_id is null and service_date > current_date + 20")
    if not sun:
        sun = q("select (date_trunc('week', current_date + 35) + interval '6 day')::date")
    sid = q(f"select id from services where service_date='{sun}' and ministry_id is null") or json.loads(json.dumps(rest("services", T, {"service_date": sun}, "POST", "return=representation")[1]))[0]["id"]
    q(f"delete from assignments where service_id='{sid}'")
    st, r = rest("assignments", T, {"service_id": sid, "position_code": "drum", "slot": 1, "member_id": mc}, "POST")
    check(st in (200, 201), f"mc on drum {st} {r}")
    st, r = rest("assignments", T, {"service_id": sid, "position_code": "acoustic", "slot": 1, "member_id": pastor}, "POST")
    check(st in (200, 201), f"pastor on acoustic {st} {r}")
    st, r = rest("assignments", T, {"service_id": sid, "position_code": "acoustic", "slot": 2, "member_id": d3}, "POST")
    check(st >= 400, f"acoustic slot2 rejected {st}")
    st, r = rest("assignments", T, {"service_id": sid, "position_code": "acoustic", "slot": 1, "member_id": d3}, "POST")
    check(st >= 400, f"active w/o acoustic position rejected {st}")
    check(q("select base_count||'/'||max_count from positions where code='acoustic'") == "0/1", "acoustic base0 max1")

    # 곡: 팀원은 못 고침 · 리더십은 고침 · 같은 이름 막음
    sid1 = q("select id from songs order by id limit 1"); t1 = q(f"select title from songs where id={sid1}")
    rest(f"songs?id=eq.{sid1}", D2, {"memo": "해킹"}, "PATCH")
    check(q(f"select coalesce(memo,'') from songs where id={sid1}") == "", "member cannot edit song")
    st, r = rest("songs", T, {"title": t1.replace(" ", "") + " "}, "POST")
    check(st == 409 or (isinstance(r, dict) and r.get("code") == "23505"), f"dup song blocked {st} {r}")

    # 배치표 공개 알림: 예배MC · 교역자도 받음
    q(f"update services set status='published', published_at=now() where id='{sid}'")
    open(LOG, "w").close()
    st, r = http("/api/notify", {"kind": "lineup", "service_ids": [sid], "month": sun[:8] + "01"}, T)
    got = {x.get("member_id") for x in pushlog()} if pushlog() else set()
    rcpt = q(f"select count(*) from notification_inbox i join notifications n on n.id=i.notification_id where n.kind='lineup' and i.member_id in ('{mc}','{pastor}')")
    check(st == 200 and int(rcpt or 0) == 2, f"lineup notify incl observers {st} {r} inbox={rcpt}")
    # 섬김 응답 열림은 안 받음
    mo = sun[:8] + "01"
    q(f"insert into availability_months(month, is_open) values ('{mo}', true) on conflict (month) do update set is_open=true")
    st, r = http("/api/notify", {"kind": "open", "month": mo}, T)
    rc2 = q(f"select count(*) from notification_inbox i join notifications n on n.id=i.notification_id where n.kind='open' and i.member_id in ('{mc}','{pastor}')")
    check(st == 200 and rc2 == "0", f"open notify excludes observers {st} {rc2}")

    async with async_playwright() as p:
        # ---------------- 관리자
        b, ctx = await browser(p)
        pg = await login(ctx, "admin@x.com", "adminpass")
        groups = await pg.eval_on_selector_all(".side nav .nav-group", "e => e.map(x => x.textContent.trim())")
        check(groups[:4] == ["사람", "섬김", "찬양", "소통"], f"nav groups {groups}")
        await navclick(pg, "schedule"); await pg.wait_for_timeout(1500)
        check(await pg.locator("#content > .page-tabs").count() == 1, "schedule page tabs")
        await pg.click('[data-ptab="respond"]'); await pg.wait_for_timeout(1500)
        check(pg.url.endswith("#respond"), f"tab -> respond {pg.url}")
        check(await pg.locator('.side nav a.on').get_attribute("data-nav") == "schedule", "respond highlights schedule nav")
        check(await pg.locator('#content > .page-tabs [aria-selected=true]').text_content() == "섬김 응답", "respond tab selected")
        await pg.screenshot(path=SHOT + "respond_tabs.png")
        # 다른 메뉴로 가면 탭 사라짐
        await navclick(pg, "members"); await pg.wait_for_timeout(1500)
        check(await pg.locator("#content > .page-tabs").count() == 0, "no tabs on members")
        # 멤버: 예배MC · 교역자
        await pg.click('#mFilter [data-f="obs"]'); await pg.wait_for_timeout(800)
        txt = await pg.locator("#content .mtable").text_content()
        check("박예배" in txt and "김목사" in txt and "예배MC" in txt and "교역자" in txt, "obs filter list")
        await pg.click('#mFilter [data-f="all"]'); await pg.wait_for_timeout(800)
        check("예배MC · 교역자 · 2명" in await pg.locator("#content").text_content(), "obs group label")
        await pg.goto(BASE + f"/admin.html#member/{mc}"); await pg.wait_for_timeout(1800)
        check(await pg.locator('[data-act="kind"]').count() == 1, "kind button for owner")
        await pg.click('[data-act="edit"]'); await pg.wait_for_timeout(600)
        check(await pg.locator("#eMain").count() == 0 and await pg.locator("#eTitle").count() == 0, "obs edit hides positions")
        await pg.fill("#ePhone", "010-1234-5678"); await pg.click("#mOk"); await pg.wait_for_timeout(1500)
        check(q(f"select phone from members where id='{mc}'") == "010-1234-5678", "obs edit saved")
        # 구분 바꾸기: 정식으로 (주 포지션 필요) → 다시 예배MC
        await pg.click('[data-act="kind"]'); await pg.wait_for_timeout(500)
        await pg.click('#kSeg [data-v="active"]'); await pg.wait_for_timeout(200)
        check(await pg.locator("#kPos:not(.hidden)").count() == 1, "main pos required when -> active")
        await pg.select_option("#kMain", "singer"); await pg.click("#mOk"); await pg.wait_for_timeout(1500)
        check(q(f"select status||'|'||role||'|'||main_position from members where id='{mc}'") == "active|member|singer", "mc -> active")
        await pg.click('[data-act="kind"]'); await pg.wait_for_timeout(500)
        await pg.click('#kSeg [data-v="mc"]'); await pg.click("#mOk"); await pg.wait_for_timeout(1500)
        check(q(f"select status||'|'||role from members where id='{mc}'") == "mc|admin", "active -> mc")
        # 개별 등록 창: 최상위 리더십에게 예배MC · 교역자 버튼
        await pg.goto(BASE + "/admin.html#members"); await pg.wait_for_timeout(1500)
        await pg.click("#mAddOne"); await pg.wait_for_timeout(500)
        check(await pg.locator('#aStatus [data-v="pastor"]').count() == 1, "add form pastor option")
        await pg.click('#aStatus [data-v="pastor"]'); await pg.wait_for_timeout(200)
        check(await pg.locator("#aObsNote:not(.hidden)").count() == 1, "obs note shown")
        await pg.click("#mCancel"); await pg.wait_for_timeout(500)
        # 배치표: 후보에 예배MC · 교역자, 어쿠스틱은 추가 자리
        await pg.goto(BASE + "/admin.html#lineup"); await pg.wait_for_timeout(2500)
        pool = await pg.locator("#luPool").text_content()
        check("예배MC · 교역자" in pool and "김목사" in pool, "pool has observers")
        await pg.screenshot(path=SHOT + "lineup.png", full_page=True)
        # 설정: 기본 인원 0 선택지
        await pg.goto(BASE + "/admin.html#settings"); await pg.wait_for_timeout(2000)
        check(await pg.locator("#pB_acoustic").input_value() == "0", "acoustic base select 0")
        check("선택 포지션" in await pg.locator('#posCard tr[data-pos="acoustic"]').text_content(), "acoustic txt")
        # 기록
        await pg.goto(BASE + "/admin.html#history"); await pg.wait_for_timeout(3000)
        hero = await pg.locator(".hx-hero .big").first.text_content()
        check("237" in hero and "387" in hero, f"history hero {hero}")
        await pg.screenshot(path=SHOT + "history_ov.png", full_page=True)
        await pg.click('[data-hx="lib"]'); await pg.wait_for_timeout(800)
        n0 = await pg.locator('[data-page="lib"] .hx-sc').count()
        check(n0 == 40, f"lib first page {n0}")
        await pg.fill('[data-page="lib"] .hx-search', "주님"); await pg.wait_for_timeout(500)
        titles = await pg.locator('[data-page="lib"] .hx-sch .t').all_text_contents()
        check(titles and all("주님" in t.replace(" ", "") for t in titles), f"lib search {titles[:3]}")
        await pg.screenshot(path=SHOT + "history_lib.png", full_page=False)
        await pg.click('[data-hx="his"]'); await pg.wait_for_timeout(800)
        s1 = await pg.locator('[data-page="his"] .hx-fsum').text_content()
        check("주일 237번" in s1, f"his sum {s1}")
        await pg.click('[data-page="his"] .hx-seg button[data-v="2024"]'); await pg.wait_for_timeout(500)
        s2 = await pg.locator('[data-page="his"] .hx-fsum').text_content()
        check("2024년" in s2 and "주일 237번" not in s2, f"his year filter {s2}")
        await pg.screenshot(path=SHOT + "history_his.png", full_page=False)
        await pg.click('[data-hx="lin"]'); await pg.wait_for_timeout(800)
        npl = await pg.locator('[data-page="lin"] .hx-person').count()
        check(npl > 30, f"lin people {npl}")
        await pg.click('[data-page="lin"] .hx-seg button[data-v="어쿠스틱"]'); await pg.wait_for_timeout(400)
        await pg.screenshot(path=SHOT + "history_lin.png", full_page=False)
        # 곡
        await pg.goto(BASE + "/admin.html#songs"); await pg.wait_for_timeout(2500)
        check(await pg.locator("#songBody tr").count() == 60, "songs first page 60")
        check("387곡" in await pg.locator("#songSum").text_content(), "songs sum")
        first = await pg.locator("#songBody tr").first.locator("td .song-name, td b").first.text_content()
        await pg.locator("#songBody [data-edit]").first.click(); await pg.wait_for_timeout(500)
        await pg.fill("#sgKey", "G"); await pg.fill("#sgMemo", "후렴 두 번"); await pg.click("#mOk"); await pg.wait_for_timeout(2000)
        check(q(f"select main_key||'|'||memo from songs where title='{first}'") == "G|후렴 두 번", f"song edit {first}")
        check(q("select count(*) from audit_log where tbl='songs'") != "0", "song audit")
        await pg.click("#songAdd"); await pg.wait_for_timeout(400)
        await pg.fill("#sgTitle", first); await pg.click("#mOk"); await pg.wait_for_timeout(1000)
        check("이미 있어요" in await pg.locator("#sgErr").text_content(), "song dup msg")
        await pg.fill("#sgTitle", "새 노래 테스트"); await pg.click("#mOk"); await pg.wait_for_timeout(2000)
        check(q("select count(*) from songs where title='새 노래 테스트'") == "1", "song add")
        await pg.screenshot(path=SHOT + "songs.png", full_page=False)
        # 모바일 폭 관리자 메뉴
        await pg.set_viewport_size({"width": 390, "height": 844}); await pg.goto(BASE + "/admin.html#history"); await pg.wait_for_timeout(2500)
        await pg.screenshot(path=SHOT + "admin_mobile.png")
        sw = await pg.evaluate("document.documentElement.scrollWidth")
        check(sw <= 392, f"admin mobile no h-scroll {sw}")
        check(not pg.errs, f"admin errs {pg.errs[:3]}")
        await b.close()

        # ---------------- 팀원 (모바일)
        b, ctx = await browser(p, mobile=True)
        pg = await login(ctx, "demo02@pole2.test", "pole2test!", "me.html")
        labels = [x.strip() for x in await pg.locator("#tabbar button").all_text_contents()]
        check(labels == ["홈", "섬김", "찬양", "나눔", "내 정보"], f"tabbar {labels}")
        await pg.click('#tabbar [data-tab="serve"]'); await pg.wait_for_timeout(1200)
        check(pg.url.endswith("#lineup") and await pg.locator("#serveNav:not(.hidden)").count() == 1, f"serve -> lineup {pg.url}")
        await pg.click('#serveNav [data-sv="respond"]'); await pg.wait_for_timeout(1200)
        check(pg.url.endswith("#respond") and await pg.locator('#tabbar [data-tab="serve"].on').count() == 1, "seg -> respond, serve tab on")
        await pg.screenshot(path=SHOT + "me_respond.png")
        await pg.click('#tabbar [data-tab="home"]'); await pg.wait_for_timeout(800)
        await pg.click('#tabbar [data-tab="serve"]'); await pg.wait_for_timeout(1000)
        check(pg.url.endswith("#respond"), "serve remembers last (respond)")
        await pg.click('#tabbar [data-tab="worship"]'); await pg.wait_for_timeout(800); await pg.click('#worshipNav [data-ws="history"]'); await pg.wait_for_timeout(2500)
        check(await pg.locator("#view-worship .hx-tabs button").count() == 5, "worship tabs")
        check(await pg.locator("#serveNav.hidden").count() == 1, "serveNav hidden on worship")
        await pg.screenshot(path=SHOT + "me_worship.png")
        await pg.click('#view-worship [data-hx="lin"]'); await pg.wait_for_timeout(800)
        await pg.screenshot(path=SHOT + "me_lineup_hist.png")
        await pg.click('#view-worship [data-hx="lib"]'); await pg.wait_for_timeout(800)
        check(await pg.locator('#view-worship .hx-flt.closed').count() >= 1, "filters folded on phone")
        await pg.screenshot(path=SHOT + "me_lib.png")
        sw = await pg.evaluate("document.documentElement.scrollWidth")
        check(sw <= 392, f"me no h-scroll {sw}")
        # 알림 주소 그대로
        mo2 = q("select to_char(min(month),'YYYY-MM-DD') from availability_months where is_open")
        await pg.goto(BASE + "/me.html#lineup/" + sun[:8] + "01"); await pg.wait_for_timeout(2000)
        check(pg.url.endswith("#lineup") and await pg.locator('#tabbar [data-tab="serve"].on').count() == 1, f"deep lineup {pg.url}")
        await pg.goto(BASE + "/me.html#pray"); await pg.wait_for_timeout(1500)
        check(await pg.locator('#tabbar [data-tab="pray"].on').count() == 1 and "나눔" in await pg.locator('#tabbar [data-tab="pray"]').text_content(), "deep pray")
        check(not pg.errs, f"member errs {pg.errs[:3]}")
        await ctx.close()

        # 예배MC
        ctx = (await browser(p, mobile=True))[1]
        q(f"update members set must_change_password=false where id='{mc}'")
        pg = await login(ctx, "mc1@pole2.test", "pole2mc!234", "me.html")
        check("예배MC" in await pg.locator("#whoBadge").text_content(), "mc badge")
        await pg.click('#tabbar [data-tab="serve"]'); await pg.wait_for_timeout(1200)
        check(await pg.locator('#serveNav [data-sv="respond"]').count() == 0, "mc no respond seg")
        await pg.goto(BASE + "/me.html#respond"); await pg.wait_for_timeout(1500)
        check(await pg.locator("#view-respond.hidden").count() == 1, "mc respond blocked")
        await pg.goto(BASE + "/me.html#home"); await pg.wait_for_timeout(1500)
        check("섬김 응답" not in (await pg.locator("#view-home").text_content()), "mc no respond banner")
        await pg.screenshot(path=SHOT + "mc_home.png")
        check(not pg.errs, f"mc errs {pg.errs[:3]}")
        await ctx.close()

        # 수습
        ctx = (await browser(p, mobile=True))[1]
        pg = await login(ctx, "trainee1@pole2.test", "pole2test!", "me.html")
        labels = [x.strip() for x in await pg.locator("#tabbar button").all_text_contents()]
        check(labels == ["홈", "찬양", "나눔", "내 정보"], f"trainee tabbar {labels}")
        check(not pg.errs, f"trainee errs {pg.errs[:3]}")
        await b.close()
    print("ok", ok, "bad", bad)

asyncio.run(main())
