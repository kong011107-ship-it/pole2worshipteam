import asyncio, json, os, re, subprocess, sys, time
from playwright.async_api import async_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
PORT = 8931
BASE = f"http://localhost:{PORT}"
ok = bad = 0
def check(c, m):
    global ok, bad
    if c: ok += 1; print("  ok ", m)
    else: bad += 1; print("  BAD", m)
CHROME = os.popen("ls -d /opt/pw-browsers/chromium-*/chrome-linux*/chrome | head -1").read().strip()
async def page(p, mobile=False, ua=None, w=None):
    b = await p.chromium.launch(executable_path=CHROME)
    o = dict(viewport={"width": w or (390 if mobile else 1280), "height": 844 if mobile else 900}, has_touch=mobile, is_mobile=mobile)
    if ua: o["user_agent"] = ua
    ctx = await b.new_context(**o)
    await ctx.route(re.compile(r"https?://(?!localhost).*"), lambda r: r.fulfill(body="", status=200))
    L = "/home/claude/libs/node_modules/"
    async def lib(route):
        u = route.request.url
        f = L + ("pdfjs-dist/build/pdf.worker.min.js" if "pdf.worker" in u else "pdfjs-dist/build/pdf.min.js" if "pdf.js" in u else "pdf-lib/dist/pdf-lib.min.js")
        await route.fulfill(path=f, content_type="text/javascript", headers={"Access-Control-Allow-Origin": "*"})
    await ctx.route(re.compile(r".*(pdf\.js/3\.11\.174|pdf-lib@1\.17\.1).*"), lib)
    api = []
    async def apih(route):
        body = json.loads(route.request.post_data or "{}"); api.append(body)
        resp = {"recipients": 3, "pushed": 2}
        if body.get("action") == "sheet-notify": resp = {"filled": ["은혜"], "recipients": 1, "pushed": 1}
        if body.get("action") == "yt": resp = {"videos": {}, "configured": True}
        await route.fulfill(body=json.dumps(resp), content_type="application/json")
    await ctx.route(re.compile(r".*/api/.*"), apih)
    pg = await ctx.new_page(); pg.errs = []; pg.api = api
    pg.on("pageerror", lambda e: pg.errs.append(str(e)))
    pg.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
    return b, pg

HIST = """window.HISTORY.load = async () => ({ songs: [
  { id: 1, count: 12, last: '2026-10-25', refs: [['AAAAAAAAAAA', 8, '', 30, '2026-10-25'], ['BBBBBBBBBBB', 3, '', 0, '2025-06-01']] },
  { id: 2, count: 2, last: '2026-09-01', refs: [] } ], plays: [] }); 0;"""

async def editor_tests(p):
    print("== 콘티 쓰기: 악보 없이 올리기 · 레퍼런스")
    b, pg = await page(p)
    await pg.goto(BASE + "/dev/tests/v31/harness.html"); await pg.wait_for_timeout(500)
    await pg.evaluate(HIST)
    dialogs = []
    pg.on("dialog", lambda d: dialogs.append(d.message))
    await pg.evaluate("CONTI.openEditor('s1')"); await pg.wait_for_timeout(800)
    await pg.fill("#ceQ", "은혜"); await pg.wait_for_timeout(300)
    check(await pg.locator(".ce-orow .ce-oplay").count() == 1, "곡 찾기 결과에 ▶ 미리 보기 (레퍼런스 있는 곡만)")
    await pg.click(".ce-oplay"); await pg.wait_for_timeout(300)
    src = await pg.get_attribute(".ytp iframe", "src") or ""
    check("embed/AAAAAAAAAAA" in src and "start=30" in src and "autoplay=1" in src, "넣기 전 미리 보기 = 앱 안 재생 " + src[:90])
    check(await pg.locator("[data-add]").count() == 1, "미리 보기를 눌러도 곡은 안 들어감")
    await pg.click(".ytp-x"); await pg.wait_for_timeout(200)
    check(await pg.locator(".ytp").count() == 0, "닫기")
    await pg.click("[data-add='1']"); await pg.wait_for_timeout(700)
    chip = pg.locator(".ce-row .ce-refchip")
    check(await chip.count() == 1, "곡 줄에 레퍼런스 칩")
    txt = await chip.inner_text()
    check("마커스워십" in txt and "0:30~4:10" in txt, "칩에 영상 제목 · 구간 " + txt.replace("\n", " "))
    await chip.click(); await pg.wait_for_timeout(300)
    src = await pg.get_attribute(".ytp iframe", "src") or ""
    check("start=30" in src and "end=250" in src, "칩 → 구간 시작부터 끝에서 멈춤 " + src[-60:])
    check("마커스워십" in await pg.inner_text(".ytp-hd"), "재생 창에 제목")
    await pg.keyboard.press("Escape"); await pg.wait_for_timeout(200)
    check(await pg.locator(".ytp").count() == 0, "Esc로 닫기")
    await pg.click("[data-ce='more']"); await pg.wait_for_timeout(600)
    cards = pg.locator(".ce-rc")
    check(await cards.count() == 2, "후보 영상 카드 2개")
    t2 = await cards.nth(1).inner_text()
    check("어쿠스틱" in t2 and "3번" in t2, "후보 카드에 제목 · 쓴 횟수 " + t2.replace("\n", " "))
    check(await pg.locator(".ce-rc.on .ce-rc-now").count() == 1, "지금 영상 표시")
    await cards.nth(1).locator(".ce-rc-th").click(); await pg.wait_for_timeout(300)
    check("BBBBBBBBBBB" in (await pg.get_attribute(".ytp iframe", "src") or ""), "후보 썸네일 → 미리 보기")
    await pg.click(".ytp-x")
    await pg.click("[data-ce='ref-use']"); await pg.wait_for_timeout(500)
    check("어쿠스틱" in await pg.inner_text(".ce-row .ce-refchip"), "'이 영상으로' → 곡 줄 영상 바뀜")
    # 두 번째 곡 (레퍼런스 없음)
    await pg.fill("#ceQ", "주님"); await pg.wait_for_timeout(300)
    check(await pg.locator(".ce-orow .ce-oplay").count() == 0, "레퍼런스 없는 곡엔 ▶ 없음")
    await pg.click("[data-add='2']"); await pg.wait_for_timeout(600)
    bar = await pg.inner_text("#ceBar")
    check("악보 없는 곡 2곡" in bar, "올리기 위에 '악보 없는 곡 N곡' " + bar.replace("\n", " "))
    await pg.screenshot(path="/tmp/v31_editor.png")
    await pg.click("[data-ce='publish']"); await pg.wait_for_timeout(900)
    check(not dialogs, f"확인 창 없이 올라감 {dialogs}")
    calls = await pg.evaluate("CALLS.filter(c => c.kind === 'rpc' && c.name === 'save_setlist')")
    check(len(calls) == 1 and calls[0]["args"]["p_publish"] is True, "save_setlist 올리기")
    its = calls[0]["args"]["p_data"]["items"] if calls else []
    check(len(its) == 2 and all(not x.get("sheet_id") and not x.get("new_sheet") for x in its), "두 곡 모두 악보 없이")
    check(its and its[0]["refs"][0][0] == "BBBBBBBBBBB", "바꾼 레퍼런스로 저장")
    check(any(a.get("action") == "notify" for a in pg.api), "올리기 알림 호출")
    check(not pg.errs, f"오류 없음 {pg.errs}")
    await b.close()

async def band_tests(p):
    print("== 밴드 '악보 저장' → 처음 채워진 악보 알림")
    b, pg = await page(p)
    await pg.goto(BASE + "/dev/tests/v31/harness.html"); await pg.wait_for_timeout(400)
    await pg.evaluate(HIST)
    await pg.evaluate("""FIX.setlist = { status: 'published', version: 3, published_at: '2026-11-01T00:00:00Z', items: [{ ord: 1, song_id: 1, title: '은혜', key: 'G', refs: [] }] };
      FIX.rpc.conti_one = ((f) => () => ({ ...f(), can_edit: false }))(FIX.rpc.conti_one);
      FIX.rpc.song_sheets = [{ id: 51, song_id: 1, kind: 'original', name: '원본 G', key: 'G', pages: 2, path: 'originals/1/a.pdf', thumb: null, created_at: '2026-10-01', used: 0 }];
      FIX.rpc.save_setlist_sheets = () => ({ id: 9, version: 4 }); 0;""")
    await pg.evaluate("CONTI.openEditor('s1')"); await pg.wait_for_timeout(900)
    check("악보 저장" in await pg.inner_text("#ceBar"), "밴드: 악보 저장 화면")
    await pg.click("[data-ce='sheets']"); await pg.wait_for_timeout(900)
    check(any(a.get("action") == "sheet-notify" and a.get("service_id") == "s1" for a in pg.api), "악보 저장 뒤 sheet-notify 호출")
    toast = await pg.locator(".toast").last.inner_text() if await pg.locator(".toast").count() else ""
    check("처음 올라온 악보(은혜)" in toast and "1명" in toast, "토스트: " + toast)
    check(not pg.errs, f"오류 없음 {pg.errs}")
    await b.close()

IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
async def ios_tests(p):
    print("== 아이폰: 사진 보관함 / 파일 고르기 · 원본 악보 지우기 · 사진으로 원본")
    b, pg = await page(p, mobile=True, ua=IPHONE)
    await pg.goto(BASE + "/dev/tests/v31/harness.html"); await pg.wait_for_timeout(400)
    await pg.evaluate(HIST)
    await pg.evaluate("""FIX.rpc.can_upload_sheet = true;
      FIX.rpc.song_sheets = [{ id: 51, song_id: 1, kind: 'original', name: '원본 G', key: 'G', pages: 2, path: 'originals/1/a.pdf', thumb: null, created_at: '2026-10-01', used: 0 }];
      FIX.tables.songs[0].memo = null;""")
    await pg.evaluate("CONTI.songDetail(1)"); await pg.wait_for_timeout(900)
    inp = pg.locator("#sdOrig")
    check((await inp.get_attribute("accept")) == "application/pdf,image/*", "원본 올리기: PDF · 사진")
    await pg.click("label:has(#sdOrig)"); await pg.wait_for_timeout(300)
    check(await pg.locator(".fpick").count() == 1, "아이폰: 누르면 '어디서 고를까요?' 창")
    async with pg.expect_file_chooser() as fc:
        await pg.click("[data-fp='photo']")
    ch = await fc.value
    acc = await inp.get_attribute("accept")
    check(acc == "image/*", "사진 보관함 → 사진만 고르게 (accept=image/*) " + str(acc))
    check(ch.is_multiple(), "여러 장 고르기")
    await ch.set_files([])
    await pg.wait_for_timeout(200)
    await pg.click("label:has(#sdOrig)"); await pg.wait_for_timeout(200)
    async with pg.expect_file_chooser() as fc:
        await pg.click("[data-fp='file']")
    await (await fc.value).set_files([])
    check((await inp.get_attribute("accept")) == "application/pdf,image/*", "파일 → 원래대로")
    await pg.click("label:has(#sdOrig)"); await pg.wait_for_timeout(200)
    await pg.click(".fpick-x"); await pg.wait_for_timeout(200)
    check(await pg.locator(".fpick").count() == 0, "취소")
    # 원본 지우기
    dl = pg.locator("[data-sheet-del='51']")
    check(await dl.count() == 1, "원본 악보 줄에 '지우기'")
    await dl.click(); await pg.wait_for_timeout(500)
    calls = await pg.evaluate("CALLS.filter(c => (c.kind === 'rpc' && c.name === 'edit_sheet') || c.kind === 'remove')")
    check(any(c.get("name") == "edit_sheet" and c["args"]["p_delete"] is True and c["args"]["p_id"] == 51 for c in calls), "edit_sheet 지우기 호출")
    check(any(c["kind"] == "remove" for c in calls), "저장소 파일도 지우기 시도")
    check(await pg.locator("[data-sheet-del='51']").count() == 0, "줄이 사라짐")
    check(not pg.errs, f"오류 없음 {pg.errs}")
    await b.close()
    # 안드로이드는 그대로 (창 없이 바로)
    b, pg = await page(p, mobile=True)
    await pg.goto(BASE + "/dev/tests/v31/harness.html"); await pg.wait_for_timeout(400)
    await pg.evaluate("FIX.rpc.can_upload_sheet = true; FIX.rpc.song_sheets = [];")
    await pg.evaluate("CONTI.songDetail(1)"); await pg.wait_for_timeout(800)
    async with pg.expect_file_chooser() as fc:
        await pg.click("label:has(#sdOrig)")
    await (await fc.value).set_files([])
    check(await pg.locator(".fpick").count() == 0, "안드로이드는 고르기 창 없이 바로")
    await b.close()

async def backup_tests(p):
    print("== 백업찬양 후보: ✕ · 끌어서 순서 · 모두 비우기")
    b, pg = await page(p, mobile=True, w=430)
    await pg.goto(BASE + "/dev/tests/v31/harness.html"); await pg.wait_for_timeout(400)
    await pg.evaluate("""FIX.tables.backup_books = [{ id: 1, active: true, label: 'Ver.2605', path: 'books/1.pdf' }];
      FIX.tables.backup_songs = [1,2,3,4,5].map((i) => ({ id: i, book_id: 1, code: 'g' + i + '1', title: '곡' + i, key: 'g', topic: i, page: i, pages: 1, hidden: false, norm: 'n' + i }));
      window.LIVE = { seq: 1, can_lead: true, candidates: [1, 2, 3], active: false, confirmed: false };
      FIX.rpc.backup_state_live = () => window.LIVE; FIX.rpc.proc_on = [];
      FIX.rpc.backup_update = (a) => (window.LIVE = { ...window.LIVE, ...a.p, seq: window.LIVE.seq + 1 }); 0;""")
    await pg.evaluate("BACKUP.mount(document.getElementById('root'), { me: { id: 'u-lead' } })"); await pg.wait_for_timeout(800)
    order = lambda: pg.evaluate("[...document.querySelectorAll('.bk-slot[data-slot]')].map(x => +x.dataset.slot)")
    check(await order() == [1, 2, 3], "후보 3곡")
    check(await pg.locator(".bk-slot-x").count() == 3 and await pg.locator(".bk-grip").count() == 3, "칸마다 ✕ · ☰")
    await pg.screenshot(path="/tmp/v31_backup.png")
    await pg.click("[data-bk-rm='2']"); await pg.wait_for_timeout(600)
    check(await order() == [1, 3], "✕ → 바로 빠지고 번호가 당겨짐")
    live = await pg.evaluate("window.LIVE.candidates")
    check(live == [1, 3], f"저장됨 {live}")
    check(await pg.locator(".bk-slot[data-slot='1'] .n").inner_text() == "1" and await pg.locator(".bk-slot[data-slot='3'] .n").inner_text() == "2", "번호 1 · 2")
    # 끌어서 순서: 3번 곡(두 번째 칸)을 첫 칸 위로
    g = pg.locator(".bk-slot[data-slot='3'] .bk-grip"); t = pg.locator(".bk-slot[data-slot='1']")
    gb = await g.bounding_box(); tb = await t.bounding_box()
    await pg.mouse.move(gb["x"] + 8, gb["y"] + 8); await pg.mouse.down()
    for k in range(1, 11):
        await pg.mouse.move(gb["x"] + 8 + (tb["x"] + 20 - gb["x"] - 8) * k / 10, gb["y"] + 8 + (tb["y"] + 20 - gb["y"] - 8) * k / 10); await pg.wait_for_timeout(20)
    await pg.mouse.up(); await pg.wait_for_timeout(600)
    check(await order() == [3, 1], f"끌어서 순서 바꿈 {await order()}")
    await pg.wait_for_timeout(400); lv = await pg.evaluate("window.LIVE.candidates"); bc = await pg.evaluate("BACKUP._test.B.live.candidates"); check(lv == [3, 1], f"바뀐 순서 저장 live={lv} B={bc}")
    # 칸을 누르면 악보 (빼지 않음)
    await pg.click(".bk-slot[data-slot='3'] .bk-slot-v"); await pg.wait_for_timeout(500)
    check(await order() == [3, 1], "칸 누르기는 빼지 않음")
    await pg.evaluate("CONTI.closeLayer && CONTI.closeLayer()"); await pg.keyboard.press("Escape"); await pg.wait_for_timeout(300)
    await pg.evaluate("document.querySelectorAll('.cv-layer').forEach(x => x.remove()); document.body.classList.remove('cv-open')")
    await pg.click("[data-bk='clear']"); await pg.wait_for_timeout(600)
    check(await order() == [] and await pg.evaluate("window.LIVE.candidates") == [], "모두 비우기")
    check(await pg.locator("[data-bk='clear']").count() == 0, "비우면 '모두 비우기' 숨김")
    errs = [e for e in pg.errs if "pdf" not in e.lower()]
    check(not errs, f"오류 없음 {errs}")
    await b.close()

async def ink_tests(p):
    print("== 부분 지우개 (내 메모)")
    b, pg = await page(p, w=900)
    await pg.goto(BASE + "/dev/tests/v31/harness.html"); await pg.wait_for_timeout(400)
    await pg.evaluate("localStorage.clear(); FIX.tables.sheet_notes = []; 0")
    await pg.evaluate("CONTI.openViewer(null, { single: { title: '시험 악보', path: 'sheets/1/a.pdf', pages: 1, ink: { key: 's:77' } } })")
    await pg.wait_for_timeout(2500)
    await pg.click("[data-iv=pen]"); await pg.wait_for_timeout(300)
    cv = await pg.locator(".iv-ink").bounding_box()
    y = cv["y"] + cv["height"] * 0.4
    x0, x1 = cv["x"] + cv["width"] * 0.2, cv["x"] + cv["width"] * 0.8
    async def line(a, bb, yy, steps=20):
        await pg.mouse.move(a, yy); await pg.mouse.down()
        for k in range(1, steps + 1): await pg.mouse.move(a + (bb - a) * k / steps, yy); await pg.wait_for_timeout(8)
        await pg.mouse.up(); await pg.wait_for_timeout(150)
    await line(x0, x1, y)
    strokes = lambda: pg.evaluate("(INK._S.mem.get('s:77|1')?.strokes || []).length")
    await pg.wait_for_timeout(1200)
    n1 = await strokes()
    check(n1 == 1, f"펜으로 한 획 {n1}")
    await pg.click("[data-iv-tool=eraser]"); await pg.wait_for_timeout(200)
    check(await pg.locator("[data-iv-er]").count() == 2, "지우개: 획 | 부분 고르기")
    await pg.click("[data-iv-er=part]"); await pg.wait_for_timeout(200)
    check(await pg.locator("[data-iv-esz]").count() == 3, "부분 지우개 굵기 3단계")
    await pg.screenshot(path="/tmp/v31_ink_bar.png")
    mx = (x0 + x1) / 2
    await line(mx, mx + 1, y - 30, 2)  # 안 닿게
    await pg.mouse.move(mx, y - 20); await pg.mouse.down()
    for k in range(1, 9): await pg.mouse.move(mx, y - 20 + 40 * k / 8); await pg.wait_for_timeout(10)
    await pg.mouse.up(); await pg.wait_for_timeout(1500)
    n2 = await strokes()
    check(n2 == 2, f"가운데를 문지르면 두 조각 {n2}")
    await pg.click("[data-iv=undo]"); await pg.wait_for_timeout(1300)
    n3 = await strokes()
    check(n3 == 1, f"되돌리기 한 번에 원래 한 획 {n3}")
    await pg.click("[data-iv-er=stroke]"); await pg.wait_for_timeout(100)
    await pg.mouse.move(mx, y - 20); await pg.mouse.down()
    for k in range(1, 9): await pg.mouse.move(mx, y - 20 + 40 * k / 8); await pg.wait_for_timeout(10)
    await pg.mouse.up(); await pg.wait_for_timeout(1300)
    n4 = await strokes()
    check(n4 == 0, f"획 지우개는 통째로 {n4}")
    errs = [e for e in pg.errs if "Failed to fetch" not in e]
    check(not errs, f"오류 없음 {errs}")
    await b.close()
    print("== 부분 지우개 (공유 필기 · 악보 고치기)")
    b, pg = await page(p, w=900)
    async def line(a, bb, yy, steps=20):
        await pg.mouse.move(a, yy); await pg.mouse.down()
        for k in range(1, steps + 1): await pg.mouse.move(a + (bb - a) * k / steps, yy); await pg.wait_for_timeout(8)
        await pg.mouse.up(); await pg.wait_for_timeout(150)
    await pg.goto(BASE + "/dev/tests/v31/harness.html"); await pg.wait_for_timeout(400)
    await pg.evaluate("""localStorage.clear(); FIX.tables.sheet_ink = []; let n = 1;
      FIX.rpc.sheet_ink_put = (a) => { const T = FIX.tables.sheet_ink, o = a.p_ops;
        o.add.forEach((x) => T.push({ id: n++, sheet_id: a.p_sheet, cid: x.cid, page: x.page, stroke: x.stroke, author: 'u-lead', author_name: '공준혁', valid_from: '2026-11-07', deleted_from: null }));
        o.del.forEach((c) => { const r = T.find((r) => r.cid === c); if (r) r.deleted_from = '2026-11-07'; });
        o.undel.forEach((c) => { const r = T.find((r) => r.cid === c); if (r) r.deleted_from = null; });
        return { ok: true }; }; 0""")
    await pg.evaluate("CONTI.openViewer(null, { single: { title: '시험 악보', path: 'sheets/1/a.pdf', pages: 1, shared: { sheet: 5, date: '2026-11-07', svc: 's1', canEdit: true, canEraseAll: true, kind: 'sheet', name: '공준혁 G' } } })")
    await pg.wait_for_timeout(2500)
    await pg.click("[data-iv=fix]"); await pg.wait_for_timeout(400)
    await pg.click("[data-iv-tool=pen]")
    cv = await pg.locator(".iv-page").bounding_box()
    y = cv["y"] + cv["height"] * 0.4; x0, x1 = cv["x"] + cv["width"] * 0.2, cv["x"] + cv["width"] * 0.8; mx = (x0 + x1) / 2
    await line(x0, x1, y); await pg.wait_for_timeout(1200)
    await pg.click("[data-iv-tool=eraser]"); await pg.click("[data-iv-er=part]"); await pg.wait_for_timeout(100)
    await pg.mouse.move(mx, y - 20); await pg.mouse.down()
    for k in range(1, 9): await pg.mouse.move(mx, y - 20 + 40 * k / 8); await pg.wait_for_timeout(10)
    await pg.mouse.up(); await pg.wait_for_timeout(1500)
    puts = await pg.evaluate("CALLS.filter(c => c.kind === 'rpc' && c.name === 'sheet_ink_put').map(c => c.args.p_ops)")
    allops = {"add": sum(len(o["add"]) for o in puts), "del": sum(len(o["del"]) for o in puts)}
    check(allops["add"] == 3 and allops["del"] == 1, f"공유 필기: 원래 획 지우기 1 + 조각 2개 더하기 (+처음 쓴 획 1) {allops}")
    await pg.click("[data-iv=undo]"); await pg.wait_for_timeout(1500)
    puts = await pg.evaluate("CALLS.filter(c => c.kind === 'rpc' && c.name === 'sheet_ink_put').map(c => c.args.p_ops)")
    last = puts[-1] if puts else {}
    check(len(last.get("del", [])) == 2 and len(last.get("undel", [])) == 1, f"되돌리기: 조각 2개 지우고 원래 획 되살리기 {last.get('del')} {last.get('undel')}")
    errs = [e for e in pg.errs if "Failed to fetch" not in e]
    check(not errs, f"오류 없음 {errs}")
    await b.close()

async def main():
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "-d", ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        async with async_playwright() as p:
            for t in [editor_tests, band_tests, ios_tests, backup_tests, ink_tests]:
                try: await t(p)
                except Exception as e: check(False, f"{t.__name__} 예외: {e}")
    finally: srv.kill()
    print(f"ok {ok} bad {bad}")
if __name__ == "__main__": asyncio.run(main())
