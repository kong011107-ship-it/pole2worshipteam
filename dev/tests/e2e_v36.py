# v36 실제 스택 e2e — EXTRA=migration_035 SITE=<저장소> bash dev/v34/reset_stack.sh 뒤에
#  ① 파트 악보: 예배 진행곡 · 특별순서 (악보 보기) · 기록 › 곡 → 곡 상세에서 올리기
#  ② 악보 받기: 콘티 카드 · 곡 서랍 · 악보 보기 단추 → PDF · 이미지(zip)
#  ③ 익명 기도제목: 팀원 화면 · 표 직접 읽기 막힘 · 나눔 관리 · 급한 기도 알림
#  ④ 양육 출석 등급: 가짜 양육 /api/grades → 지금 가져오기 → 멤버 목록 · 상세 · 대시보드
def pdf_pages(path):
    return int(subprocess.run(["node", "-e", "const {PDFDocument}=require('/home/claude/libs/node_modules/pdf-lib');PDFDocument.load(require('fs').readFileSync(process.argv[1])).then(d=>console.log(d.getPageCount()))", path], capture_output=True, text=True).stdout.strip() or 0)
import asyncio, sys, json, subprocess, os, re, uuid, datetime, threading, zipfile, io, time, urllib.request
import http.server as hs
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
FX = "/home/claude/tests/fx/"
PW = "pole2test!"
U = lambda: str(uuid.uuid4())
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


ok = 0; bad = []
def check(c, msg):
    global ok
    if c: ok += 1
    else: bad.append(msg); print("FAIL", msg)
SHOT = "/home/claude/tests/v36_"
SITE = os.environ.get("SITE", "/home/claude/wp")
KEY = "test-share-key-0123456789"
GRADES = {}   # 번호 → 등급 (가짜 양육 서버가 돌려줌)

class Fake(hs.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.headers.get("x-share-key") != KEY:
            self.send_response(401); self.end_headers(); self.wfile.write(b'{"error":"unauthorized"}'); return
        body = json.dumps({"as_of": "x", "people": [{"phone": p, "grade": g} for p, g in GRADES.items()]}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass

def restart_server(env):
    subprocess.run("fuser -k 8790/tcp", shell=True, capture_output=True); time.sleep(1)
    e = dict(os.environ, SITE=SITE, **env)
    subprocess.Popen(["node", "server.mjs"], cwd="/home/claude/pgrst", env=e, stdout=open("/home/claude/pgrst/server.log", "w"), stderr=subprocess.STDOUT)
    for _ in range(30):
        try:
            if http("/rest/v1/positions")[0] == 200: return
        except Exception: pass
        time.sleep(0.5)

async def save_download(pg, click):
    async with pg.expect_download(timeout=60000) as d:
        await click()
    dl = await d.value
    p = f"/tmp/v36_{dl.suggested_filename}"
    await dl.save_as(p)
    return p, dl.suggested_filename

async def main():
    restart_server({"NURTURE_GRADES_URL": "http://127.0.0.1:8799/api/grades", "NURTURE_SHARE_KEY": KEY})
    srv = hs.ThreadingHTTPServer(("127.0.0.1", 8799), Fake); threading.Thread(target=srv.serve_forever, daemon=True).start()
    T, D, mid, sun, sid, nxt, sid2 = setup()
    print("sunday", sun, sid)
    # 콘티 · 진행곡 · 특별순서 (악보 있는 것)
    p1, p2 = f"sheets/162/{U()}.pdf", f"sheets/18/{U()}.pdf"
    for p in (p1, p2): up(p, FX + "conti5.pdf", D[1], "application/pdf")
    st, r = rpc("save_setlist", {"p_service": sid, "p_data": {"pages": 4, "items": [
        {"song_id": 162, "key": "G", "new_sheet": {"name": "공준혁 G", "path": p1, "pages": 2, "size": 100}, "page_from": 1, "page_to": 2},
        {"song_id": 18, "key": "A", "new_sheet": {"name": "A", "path": p2, "pages": 2, "size": 100}, "page_from": 3, "page_to": 4}]}, "p_publish": True, "p_base": None}, D[1])
    check(st == 200, f"publish conti {st} {r}")
    pp = f"proc/{U()}.pdf"; up(pp, FX + "proc.pdf", T, "application/pdf")
    rest("worship_proc", T, {"kind": "blessing", "title": "축복합니다", "path": pp, "pages": 1, "start_date": "2026-01-01"}, "POST")
    proc_id = int(q("select id from worship_proc where kind='blessing' order by id desc limit 1"))
    xp = f"extra/{sid}/{U()}.jpg"; up(xp, FX + "ap1.jpg", D[1], "image/jpeg")
    st, r = rest("service_extras", D[1], {"service_id": sid, "title": "파송식", "key": "D", "images": [xp]}, "POST", "return=representation")
    xid = r[0]["id"]
    q(f"update services set flow = null where id='{sid}'")
    e8 = q(f"select main_position from members where id='{mid[8]}'"); print("demo08", e8)
    q(f"update members set main_position='e_guitar' where id='{mid[8]}'")

    async with async_playwright() as p:
        # ================= ① 파트 악보 — 진행곡 · 특별순서
        b, ctx = await browser(p)
        pg = await login(ctx, "demo08@pole2.test", PW, "me.html#worship")
        await pg.wait_for_selector("[data-cv-open]", timeout=15000)
        await pg.click("[data-cv-open]"); await pg.wait_for_selector(".cv-viewer", timeout=10000); await pg.wait_for_timeout(1500)
        items = await pg.evaluate("document.querySelector('.cv-viewer')._viewer.items.map(x => [x.id, x.pt || null, x.kind || 'song'])")
        print("items", items)
        check(any(i[1] == f"p:{proc_id}" for i in items), f"proc item has pt {items}")
        check(any(i[1] == f"x:{xid}" for i in items), "extra item has pt")
        for target, label in ((f"p:{proc_id}", "proc"), (f"x:{xid}", "extra")):
            i = [k for k, x in enumerate(items) if x[1] == target][0]
            await pg.evaluate(f"document.querySelector('.cv-viewer')._viewer.goItem('{items[i][0]}')"); await pg.wait_for_timeout(600)
            vis = await pg.is_visible("#cvvPart")
            check(vis, f"{label}: part button visible")
            if not vis: continue
            await pg.click("#cvvPart"); await pg.wait_for_selector(".pt-pop", timeout=3000)
            pg.once("dialog", lambda d: asyncio.ensure_future(d.accept(f"일렉 {label}")))
            await pg.set_input_files(".pt-pop [data-pt-up]", FX + "proc.pdf"); await pg.wait_for_timeout(2500)
            col = "proc_id" if label == "proc" else "extra_id"
            row = q(f"select part || '|' || path || '|' || coalesce(song_id::text,'') from part_sheets where {col} = {proc_id if label == 'proc' else xid}")
            check(row.startswith("e_guitar|parts/" + ("p" if label == "proc" else "x")), f"{label} part sheet saved {row}")
            st_ = await pg.evaluate("document.querySelector('.cv-viewer')._viewer.state")
            check(st_["part"] is not None, f"{label}: now showing part sheet {st_}")
            picks = q(f"select tgt from part_picks where member_id='{mid[8]}' and service_id='{sid}' order by tgt")
            check(target in picks.split("\n"), f"{label}: pick saved {picks}")
        await pg.screenshot(path=SHOT + "part_extra.png")
        await pg.evaluate("CONTI.closeLayer()"); await pg.wait_for_timeout(400)
        # 다시 열면 고른 파트 악보로
        await pg.click("[data-cv-open]"); await pg.wait_for_timeout(2000)
        i = [k for k, x in enumerate(items) if x[1] == f"p:{proc_id}"][0]
        await pg.evaluate(f"document.querySelector('.cv-viewer')._viewer.goItem('{items[i][0]}')"); await pg.wait_for_timeout(500)
        txt = await pg.inner_text("#cvvPart")
        check("공용" in txt or "일렉" in txt, f"reopen part button {txt}")
        await pg.evaluate("CONTI.closeLayer()"); await pg.wait_for_timeout(400)
        # 드럼(demo10)에게는 안 보임
        check(rpc("my_parts", {}, D[10])[1] and "e_guitar" not in rpc("my_parts", {}, D[10])[1], "drum parts")
        check(rest("part_sheets?select=id", D[10])[1] == [], "drum sees no elec part sheets")

        # ================= ① 기록 › 곡 → 곡 상세 → 콘티에 없는 곡에 파트 악보
        await pg.click('#worshipNav [data-ws="history"]'); await pg.wait_for_timeout(2500)
        await pg.click('.hx-tabs [data-hx="lib"]'); await pg.wait_for_timeout(1200)
        n = await pg.locator("[data-page=lib] .hx-sc.hx-open").count()
        check(n > 5, f"history song rows clickable {n}")
        sid_song = await pg.locator("[data-page=lib] .hx-sc.hx-open").nth(3).get_attribute("data-sid")
        await pg.locator("[data-page=lib] .hx-sc.hx-open").nth(3).locator(".t").click(); await pg.wait_for_selector(".cv-sheetpage", timeout=8000)
        check(await pg.is_visible("#sdParts"), "song detail has part section")
        pg.once("dialog", lambda d: asyncio.ensure_future(d.accept("일렉 미리")))
        await pg.set_input_files('[data-sd-pup="e_guitar"]', FX + "proc.pdf"); await pg.wait_for_timeout(2500)
        check(q(f"select count(*) from part_sheets where song_id={sid_song} and part='e_guitar'") == "1", "part sheet on library song")
        await pg.screenshot(path=SHOT + "song_detail.png")
        await pg.evaluate("CONTI.closeLayer()"); await pg.wait_for_timeout(300)
        # 영상 링크는 곡 상세를 안 열어요
        a = pg.locator("[data-page=lib] .hx-sc.hx-open summary").first
        if await a.count():
            await a.click(); await pg.wait_for_timeout(500)
            check(not await pg.is_visible(".cv-sheetpage"), "refs summary click does not open detail")
        check(not pg.errs, f"member errors {pg.errs[:3]}")
        await b.close()

        # ================= ② 악보 받기 (모든 팀원 — 싱어 demo03)
        b, ctx = await browser(p)
        pg = await login(ctx, "demo03@pole2.test", PW, "me.html#worship")
        await pg.wait_for_selector("[data-cv-export]", timeout=15000)
        await pg.screenshot(path=SHOT + "conti_card.png")
        await pg.click("[data-cv-export]"); await pg.wait_for_selector(".xp-sheet .xp-it", timeout=10000)
        nit = await pg.locator(".xp-sheet .xp-it").count(); on = await pg.locator(".xp-sheet .xp-it input:checked").count()
        check(nit >= 4 and on == nit, f"export: all items listed and on {nit} {on}")
        check(await pg.locator('.xp-sheet input[data-xp="shared"]').count() == 1, "export: shared ink toggle")
        go = await pg.inner_text("#xpGo"); check("PDF 만들기" in go, f"go text {go}")
        await pg.screenshot(path=SHOT + "export_sheet.png")
        await pg.click("#xpGo"); await pg.wait_for_function("document.querySelector('#xpGo').textContent.includes('저장하기')", timeout=60000)
        path, name = await save_download(pg, lambda: pg.click("#xpGo"))
        pdf = open(path, "rb").read()
        npages = pdf_pages(path)
        pages_expected = await pg.evaluate("[...document.querySelectorAll('.xp-sheet .xp-it small')].reduce((a, s) => a + parseInt(s.textContent), 0)")
        check(pdf[:4] == b"%PDF" and npages == pages_expected, f"pdf pages {npages} expected {pages_expected} name {name}")
        check(name.endswith("콘티.pdf"), f"pdf name {name}")
        # 이미지 · 한 곡 끄기 → zip
        await pg.click('.xp-sheet [data-xp="fmt"] [data-v="jpg"]')
        await pg.locator(".xp-sheet .xp-it input").nth(0).uncheck()
        await pg.click("#xpGo"); await pg.wait_for_function("document.querySelector('#xpGo').textContent.includes('저장하기')", timeout=60000)
        path, name = await save_download(pg, lambda: pg.click("#xpGo"))
        z = zipfile.ZipFile(path); names = z.namelist()
        check(name.endswith(".zip") and len(names) == pages_expected - 2 and all(n.endswith(".jpg") for n in names), f"zip {name} {names}")
        check(z.read(names[0])[:2] == b"\xff\xd8", "zip has jpeg")
        await pg.click(".xp-sheet .u-shh [data-u-close]"); await pg.wait_for_timeout(400)
        # 곡 서랍 → 이 곡 악보 받기 (이 곡만 켜짐)
        await pg.locator("[data-cv-song]").first.click(); await pg.wait_for_selector("[data-cv-sxp]", timeout=8000)
        await pg.click("[data-cv-sxp]"); await pg.wait_for_selector(".xp-sheet .xp-it", timeout=10000)
        on = await pg.locator(".xp-sheet .xp-it input:checked").count()
        check(on == 1, f"song export: only one on {on}")
        await pg.click('.xp-sheet [data-xp="fmt"] [data-v="pdf"]')
        await pg.click("#xpGo"); await pg.wait_for_function("document.querySelector('#xpGo').textContent.includes('저장하기')", timeout=60000)
        path, name = await save_download(pg, lambda: pg.click("#xpGo"))
        check(pdf_pages(path) == 2 and "콘티" in name, f"one song pdf {name}")
        await pg.click(".xp-sheet .u-shh [data-u-close]"); await pg.wait_for_timeout(300)
        # 악보 보기 위 단추
        await pg.click("[data-cv-open]"); await pg.wait_for_selector('[data-cvv="export"]', timeout=8000)
        await pg.click('[data-cvv="export"]'); await pg.wait_for_selector(".xp-sheet .xp-it", timeout=5000)
        check(await pg.locator('.xp-sheet [data-xp="cur"]').count() == 1, "viewer export has '이 곡만'")
        await pg.screenshot(path=SHOT + "viewer_export.png")
        await pg.click(".xp-sheet .u-shh [data-u-close]")
        await pg.evaluate("CONTI.closeLayer()")
        # 휴대폰 화면
        await pg.set_viewport_size({"width": 390, "height": 844}); await pg.wait_for_timeout(500)
        await pg.click("[data-cv-export]"); await pg.wait_for_selector(".xp-sheet .xp-it", timeout=10000); await pg.wait_for_timeout(400)
        over = await pg.evaluate("document.querySelector('.xp-sheet .u-sheet').scrollWidth > document.querySelector('.xp-sheet .u-sheet').clientWidth + 1")
        check(not over, "export sheet no horizontal overflow on phone")
        await pg.screenshot(path=SHOT + "export_phone.png")
        await pg.click(".xp-sheet .u-shh [data-u-close]")
        check(not pg.errs, f"export errors {pg.errs[:3]}")

        # ================= ③ 익명 기도제목
        await pg.set_viewport_size({"width": 1440, "height": 1000})
        await pg.goto(BASE + "/me.html#pray"); await pg.wait_for_selector("#pNew", timeout=10000)
        await pg.click("#pNew"); await pg.wait_for_selector("#pForm [data-anon]")
        await pg.fill("#pForm [data-body]", "익명으로 올리는 기도")
        await pg.check("#pForm [data-anon]")
        await pg.click("#pUrgent"); await pg.click("#pSubmit"); await pg.wait_for_timeout(2000)
        row = q("select anon::text || '|' || urgent::text || '|' || (member_id = author_id)::text from prayers where body = '익명으로 올리는 기도'")
        check(row == "true|true|true", f"anon prayer saved {row}")
        card = await pg.inner_text(".pcard.anon")
        check("익명" in card and "나에게만 보여요" in card and "수정" in card, f"own anon card {card}")
        await pg.screenshot(path=SHOT + "pray_own.png")
        nt = q("select title || ' / ' || coalesce(body,'') from notifications where kind='prayer' order by id desc limit 1")
        check("익명으로 올라온" in nt and q(f"select name from members where id='{mid[3]}'") not in nt, f"urgent notify anonymous {nt}")
        await b.close()
        # 다른 팀원(demo05)
        b, ctx = await browser(p)
        pg = await login(ctx, "demo05@pole2.test", PW, "me.html#pray")
        await pg.wait_for_selector(".pcard", timeout=10000)
        card = await pg.inner_text(".pcard.anon")
        n3 = q(f"select name from members where id='{mid[3]}'")
        check(card.startswith("익명") and n3 not in card and "수정" not in card and "나에게만" not in card, f"other sees anonymous {card}")
        st, r = rest("prayers?select=member_id,body", D[5]); check(st >= 400, f"member cannot read member_id {st}")
        st, r = rest("prayers?select=*", D[5]); check(st >= 400, f"member cannot select * {st}")
        st, r = rest("prayers?select=id,body,anon", D[5]); check(st == 200 and any(x["anon"] for x in r), f"member reads body {st}")
        rows = rpc("prayer_rows", {"p_from": None}, D[5])[1]
        an = [x for x in rows if x["anon"]]
        check(an and all(x["member_id"] is None and x["author_id"] is None for x in an), "prayer_rows masks names")
        await pg.screenshot(path=SHOT + "pray_other.png")
        check(not pg.errs, f"pray errors {pg.errs[:3]}")
        await b.close()
        # 대신 올리기(익명) — demo01이 demo04 것
        st, r = rest("prayers", D[1], {"member_id": mid[4], "author_id": mid[1], "body": "대신 익명", "anon": True}, "POST")
        check(st in (200, 201), f"proxy anon insert {st} {r}")
        rows = rpc("prayer_rows", {"p_from": None}, D[4])[1]
        mine = [x for x in rows if x["body"] == "대신 익명"][0]
        check(mine["member_id"] == mid[4] and mine["mine"], "owner sees own proxy anon")
        # 리더십 나눔 관리
        b, ctx = await browser(p)
        pg = await login(ctx, "admin@x.com", "adminpass", "admin.html#sharing")
        await pg.wait_for_selector(".sh-row", timeout=10000)
        txt = await pg.inner_text(".sh-list")
        check(n3 in txt and "익명" in txt, "admin sees real name + anon chip")
        await pg.click('[data-sh="by"] [data-v="anon"]'); await pg.wait_for_timeout(800)
        check(await pg.locator(".sh-row").count() == 2, f"admin anon filter {await pg.locator('.sh-row').count()}")
        await pg.screenshot(path=SHOT + "sharing.png")

        # ================= ④ 양육 출석 등급
        phones = {n: q(f"select regexp_replace(phone, '\\D', '', 'g') from members where id='{mid[n]}'") for n in (2, 3, 5, 6)}
        GRADES.update({phones[2]: "A", phones[3]: "C", phones[5]: "E"})
        GRADES["01099998888"] = "B"   # 찬양팀에 없는 번호
        await pg.goto(BASE + "/admin.html#members"); await pg.wait_for_selector("#ngSync", timeout=10000)
        await pg.click("#ngSync"); await pg.wait_for_timeout(2500)
        check(q("select count(*) from nurture_grades") == "3", f"grades synced {q('select count(*) from nurture_grades')}")
        txt = await pg.inner_text(".mtable")
        check("양육 C" in txt and "양육 E" in txt and "양육 A" in txt, "member list chips")
        box = await pg.inner_text(".ng-box")
        check("3명 맞춤" in box and "못 찾은" in box, f"sync box {box}")
        await pg.screenshot(path=SHOT + "members.png", full_page=True)
        # 등급이 바뀌면 이전 등급
        GRADES[phones[3]] = "D"
        st, r = http("/api/members-bulk", {"action": "nurture-sync"}, T)
        check(st == 200 and r["changed"] == 1, f"resync changed {st} {r}")
        check(q(f"select prev_grade || grade from nurture_grades where member_id='{mid[3]}'") == "CD", "prev grade kept")
        # 팀원은 못 봄 · 못 부름
        check(rest("nurture_grades?select=grade", D[3])[1] in ([],) or rest("nurture_grades?select=grade", D[3])[0] >= 400, "member cannot read grades")
        check(http("/api/members-bulk", {"action": "nurture-sync"}, D[3])[0] == 403, "member cannot sync")
        # 상세 · 대시보드
        await pg.goto(BASE + f"/admin.html#member/{mid[3]}"); await pg.reload(); await pg.wait_for_selector(".ng-kpi", timeout=10000)
        k = await pg.inner_text(".ng-kpi"); check("D" in k and "C → D" in k, f"detail kpi {k}")
        await pg.screenshot(path=SHOT + "detail.png")
        await pg.goto(BASE + "/admin.html#dashboard"); await pg.wait_for_timeout(2500)
        dash = await pg.inner_text("#content")
        check("양육 출석 D" in dash and "양육 출석 E" in dash and "양육 출석 A" not in dash, "dashboard C 이하만")
        await pg.screenshot(path=SHOT + "dashboard.png")
        # 키가 틀리면 오류 기록
        restart_server({"NURTURE_GRADES_URL": "http://127.0.0.1:8799/api/grades", "NURTURE_SHARE_KEY": "wrong-key-xxxxxxxxxx"})
        T = tok("admin@x.com", "adminpass")
        st, r = http("/api/members-bulk", {"action": "nurture-sync"}, T)
        check(st == 502 and "키" in r.get("error", ""), f"wrong key error {st} {r}")
        check(q("select ok::text from nurture_sync") == "false" and q("select count(*) from nurture_grades") == "3", "failed sync keeps grades")
        await pg.goto(BASE + "/admin.html#members"); await pg.reload(); await pg.wait_for_selector(".ng-box", timeout=10000)
        check("가져오지 못했어요" in await pg.inner_text(".ng-box"), "box shows error")
        restart_server({})
        T = tok("admin@x.com", "adminpass")
        st, r = http("/api/members-bulk", {"action": "nurture-sync"}, T)
        check(st == 400 and "환경변수" in r.get("error", ""), f"no env {st} {r}")
        check(not pg.errs, f"admin errors {pg.errs[:3]}")
        await b.close()
    srv.shutdown()
    print(f"ok {ok} bad {len(bad)}")
    for x in bad: print(" -", x)

asyncio.run(main())
