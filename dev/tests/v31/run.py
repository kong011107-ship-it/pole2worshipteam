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
# v34.2: 콘티 쓰기 — 함께 부른 곡 추천용 기록(plays)을 더한 것 (다른 시험은 HIST 그대로)
HISTE = HIST.replace("plays: [] }", """plays: [['2026-10-25', 1, 1, '은혜', 'G', [], 0, null], ['2026-10-25', 2, 2, '주님의 마음', 'A', [], 0, null], ['2026-09-01', 1, 1, '은혜', 'G', [], 0, null], ['2026-09-01', 2, 2, '주님의 마음', 'A', [], 0, null], ['2026-08-01', 1, 3, '예수 피를 힘입어', 'D', [], 0, null], ['2026-08-01', 2, 1, '은혜', 'G', [], 0, null]] }""")
# v34.2: 곡 줄을 펼치고 탭 고르기
async def open_row(pg, i, tab):
    r = pg.locator(".ce-row").nth(i)
    if await r.locator(".ce2-det").count() == 0: await r.locator(".ce2-hd").click(); await pg.wait_for_timeout(250)
    await r.locator(f'[data-ce="tab"][data-tab="{tab}"]').click(); await pg.wait_for_timeout(400)
    return r

async def editor_tests(p):
    print("== 콘티 쓰기: 악보 없이 올리기 · 레퍼런스")
    b, pg = await page(p)
    await pg.goto(BASE + "/dev/tests/v31/harness.html"); await pg.wait_for_timeout(500)
    await pg.evaluate(HISTE)
    dialogs = []
    pg.on("dialog", lambda d: dialogs.append(d.message))
    await pg.evaluate("CONTI.openEditor('s1')"); await pg.wait_for_timeout(800)
    await pg.fill("#ceQ", "은혜"); await pg.wait_for_timeout(300)
    check(await pg.locator(".ce-orow .ce-oplay").count() == 1, "곡 찾기 결과에 ▶ 미리 보기 (레퍼런스 있는 곡만)")
    await pg.click(".ce-oplay"); await pg.wait_for_timeout(300)
    src = await pg.get_attribute(".ytp iframe", "src") or ""
    check("embed/AAAAAAAAAAA" in src and "start=30" in src and "autoplay=1" in src, "넣기 전 미리 보기 = 앱 안 재생 " + src[:90])
    check(await pg.locator(".ce-row").count() == 0, "미리 보기를 눌러도 곡은 안 들어감")
    await pg.click(".ytp-x"); await pg.wait_for_timeout(200)
    check(await pg.locator(".ytp").count() == 0, "닫기")
    await pg.click("[data-add='1']"); await pg.wait_for_timeout(700)
    # v34.2: 줄은 접혀 있고 (번호 · 제목 · 키 · 시간 · 상태 아이콘), 누르면 탭
    check(await pg.locator(".ce-row .ce2-hd").count() == 1 and await pg.locator(".ce-row .ce2-det").count() == 0, "곡 줄은 접혀서 들어감")
    check((await pg.inner_text(".ce-row .ce2-key")).strip() == "G" and await pg.locator(".ce-row .ce2-ics .no").count() == 1, "줄에 키 · 악보 없음 아이콘")
    # 함께 부른 곡 추천 (곡 추가 칸이 비어 있으면) — v34.3: 서랍처럼 기본은 닫혀 있고, 머리를 누르면 펼쳐요
    lab = await pg.inner_text("#ceDrop .ce2-lab") if await pg.locator("#ceDrop .ce2-lab").count() else ""
    check(await pg.locator("#ceDrop .ce2-sugh[aria-expanded=false]").count() == 1 and await pg.locator("#ceDrop .ce-o").count() == 0 and "2곡" in lab, "추천 서랍은 기본 닫힘 " + lab)
    await pg.click("#ceDrop .ce2-sugh"); await pg.wait_for_timeout(300)
    check(await pg.locator("#ceDrop .ce2-sugh[aria-expanded=true]").count() == 1, "머리를 누르면 펼쳐짐")
    sug = [x.strip() for x in await pg.locator("#ceDrop .ce-o b").all_text_contents()]
    check("자주 같이 부른 곡" in lab and sug == ["주님의 마음", "예수 피를 힘입어"], f"함께 부른 곡 추천 (많이 같이 부른 순 · 넣은 곡 빼고) {sug}")
    sub = await pg.locator("#ceDrop .ce-o small").first.inner_text()
    check("'은혜'와 2번 같이" in sub, "추천 이유 " + sub)
    await open_row(pg, 0, "ref")
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
    sug = [x.strip() for x in await pg.locator("#ceDrop .ce-o b").all_text_contents()]
    check(sug == ["예수 피를 힘입어"], f"이미 넣은 곡은 추천에서 빠짐 {sug}")
    # 위 요약: 확인 칩
    cks = await pg.inner_text(".ce2-checks")
    check("곡 2" in cks and "키 2/2" in cks and "악보 없는 곡 2" in cks and "BPM 0/2" in cks, "확인 칩 " + cks.replace("\n", " "))
    await pg.click("[data-ce='jump-sheet']"); await pg.wait_for_timeout(400)
    check(await pg.locator('.ce-row[data-i="0"] [data-ce="tab"][data-tab="sheet"][aria-pressed="true"]').count() == 1, "'악보 없는 곡' 칩 → 그 곡 악보 탭")
    # 기본 탭: 키 단추 · 위로/아래로 · 이어서 부르기
    r1 = await open_row(pg, 1, "basic")
    check(await r1.locator(".ce2-keys button").count() == 12, "키 단추 12개")
    await r1.locator('[data-ce="key"][data-k="Bb"]').click(); await pg.wait_for_timeout(300)
    check((await pg.locator(".ce-row").nth(1).locator(".ce2-key").inner_text()).strip() == "Bb", "키 단추 → 줄 키 바로 바뀜")
    await pg.locator(".ce-row").nth(1).locator('[data-ce="up"]').click(); await pg.wait_for_timeout(300)
    names = [x.strip() for x in await pg.locator(".ce-row .ce-t b").all_text_contents()]
    check(names == ["주님의 마음", "은혜"] and await pg.locator('.ce-row[data-i="0"].open').count() == 1, f"위로 → 순서 바뀌고 펼친 채로 {names}")
    await pg.locator(".ce-row").nth(1).locator('[data-ce="join"]').click(); await pg.wait_for_timeout(300)
    sn = [x.strip() for x in await pg.locator(".ce-row .cv-sn").all_text_contents()]
    check(sn == ["1", "+"] and "이어짐" in await pg.locator(".ce-row").nth(1).locator(".ce2-cb").inner_text(), f"이어서 부르기 → 앞 번호 아래로 {sn}")
    await pg.locator(".ce-row").nth(1).locator('[data-ce="join"]').click(); await pg.wait_for_timeout(300)
    await pg.locator(".ce-row").nth(0).locator('[data-ce="down"]').click(); await pg.wait_for_timeout(300)
    names = [x.strip() for x in await pg.locator(".ce-row .ce-t b").all_text_contents()]
    check(names == ["은혜", "주님의 마음"], f"끊고 아래로 → 처음 순서 {names}")
    await r1.locator('[data-ce="key"][data-k="A"]').click() if await r1.locator('[data-ce="key"][data-k="A"]').count() else None
    await pg.wait_for_timeout(200)
    saved_at = await pg.locator("#ceSaved:not([hidden]) em").inner_text() if await pg.locator("#ceSaved:not([hidden])").count() else ""
    check(re.match(r"\d\d:\d\d", saved_at or ""), "위 막대 '이 기기에 자동 저장 · 시각' " + saved_at)
    await pg.screenshot(path="/tmp/v31_editor.png")
    await pg.click("[data-ce='publish']"); await pg.wait_for_timeout(400)
    # v34.2: 올리기 전 확인 창 (곡 · RT · 키 · 악보 없는 곡 · BPM · 카톡 문구 복사)
    dlg = await pg.inner_text(".ce2-pub") if await pg.locator(".ce2-pub").count() else ""
    check("올리기 전에 확인" in dlg and "곡 2개" in dlg and "악보 없는 곡 2곡" in dlg and "BPM 0/2" in dlg and "카톡" in dlg, "올리기 전 확인 창 " + dlg.replace("\n", " ")[:120])
    calls0 = await pg.evaluate("CALLS.filter(c => c.kind === 'rpc' && c.name === 'save_setlist').length")
    check(calls0 == 0, "확인 창에서는 아직 안 올라감")
    await pg.click("[data-pub='go']"); await pg.wait_for_timeout(1200)
    check(not dialogs, f"브라우저 확인 창 없음 {dialogs}")
    check(await pg.locator(".cp-modal").count() == 1, "올린 뒤 카톡 복사 창 (기본 켜짐)")
    calls = await pg.evaluate("CALLS.filter(c => c.kind === 'rpc' && c.name === 'save_setlist')")
    check(len(calls) == 1 and calls[0]["args"]["p_publish"] is True, "save_setlist 올리기")
    its = calls[0]["args"]["p_data"]["items"] if calls else []
    check(len(its) == 2 and all(not x.get("sheet_id") and not x.get("new_sheet") for x in its), "두 곡 모두 악보 없이")
    check(its and its[0]["refs"][0][0] == "BBBBBBBBBBB", "바꾼 레퍼런스로 저장")
    check(any(a.get("action") == "notify" for a in pg.api), "올리기 알림 호출")
    check(not pg.errs, f"오류 없음 {pg.errs}")
    await b.close()

async def draft_tests(p):
    print("== v34.2: 개편 전에 이 기기에 쓰던 내용(임시 저장 데이터) 그대로 읽기")
    b, pg = await page(p)
    await pg.goto(BASE + "/dev/tests/v31/harness.html"); await pg.wait_for_timeout(400)
    await pg.evaluate(HISTE)
    # v33 편집기가 남긴 모양 그대로 (base = 콘티 버전 · 없으면 null)
    await pg.evaluate("""(() => { const it = (o) => Object.assign({ medley: false, join: false, medley_id: null, medley_title: null, diff: false, refs: [], dur: null, src: null, memo: '', sheet: { mode: 'none' }, page_from: null, page_to: null, bpm: null, meter: null, bpm0: null, meter0: null }, o);
      localStorage.setItem('pole2.conti.draft.s1', JSON.stringify({ base: (window.FIX.setlist && window.FIX.setlist.version) ?? null, target: 1500, at: Date.now() - 60000,
        items: [it({ song_id: 1, title: '은혜', key: 'A', diff: true, dur: 300, src: 'manual', memo: '옛 메모' }), it({ song_id: 2, title: '주님의 마음', key: 'B', join: true, dur: 0, src: 'medley' }), it({ song_id: 3, title: '예수 피를 힘입어', key: 'D', bpm: 72, meter: '4/4', sheet: { mode: 'new', name: '인도자 D' } })] })); })()""")
    await pg.evaluate("CONTI.openEditor('s1')"); await pg.wait_for_timeout(900)
    check(await pg.locator(".ce-restored").count() == 1, "'이 기기에서 쓰던 내용을 불러왔어요'")
    names = [x.strip() for x in await pg.locator(".ce-row .ce-t b").all_text_contents()]
    sn = [x.strip() for x in await pg.locator(".ce-row .cv-sn").all_text_contents()]
    keys = [x.strip() for x in await pg.locator(".ce-row .ce2-key").all_text_contents()]
    check(names == ["은혜", "주님의 마음", "예수 피를 힘입어"] and sn == ["1", "+", "2"] and keys == ["A", "B", "D"], f"곡 · 메들리 묶음 · 키 그대로 {names} {sn} {keys}")
    check("옛 메모" in await pg.locator(".ce-row").nth(0).inner_text() and await pg.locator(".ce-row").nth(0).locator(".ce2-key.diff").count() == 1, "메모 · 키 다름(*) 그대로")
    check("25:00" in await pg.inner_text(".ce2-rt") and await pg.locator(".ce-row").nth(2).locator(".ce2-ics span:not(.off)").count() == 2, "목표 RT · BPM 그대로")
    r = await open_row(pg, 2, "sheet")
    check(await r.locator("input[data-f=sheetname]").input_value() == "인도자 D", "'새 악보로 저장' 이름 그대로")
    check(await pg.locator("#ceSaved:not([hidden])").count() == 1, "자동 저장 시각 보임")
    await pg.click("[data-ce='save']"); await pg.wait_for_timeout(600)
    calls = await pg.evaluate("CALLS.filter(c => c.kind === 'rpc' && c.name === 'save_setlist')")
    its = calls[-1]["args"]["p_data"]["items"] if calls else []
    check(len(its) == 3 and its[0]["memo"] == "옛 메모" and its[0]["diff_key"] is True and its[0]["duration_sec"] == 300 and its[1]["join_prev"] is True and its[2]["bpm"] == 72 and calls[-1]["args"]["p_publish"] is False,
          f"임시 저장도 예전 내용 그대로 {its[:1]}")
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
    # v34.1: delete_sheet (먼저 p_dry로 쓰인 곳을 보고 확인 창 → 지우기)
    await pg.evaluate("FIX.rpc.delete_sheet = (a) => a && a.p_dry ? { id: 51, name: '원본 G', kind: 'original', uses: [{ date: '2026-11-01', published: true }], notes: 0, ink: 3 } : { deleted: true, path: 'originals/1/x.pdf', uses: [], versions: {} }; 0")
    await dl.click(); await pg.wait_for_timeout(500)
    cf = pg.locator(".u-confirm")
    check(await cf.count() == 1 and "올라온 콘티 1개" in await cf.inner_text() and "공유 필기 3획" in await cf.inner_text(), "확인 창에 쓰인 콘티 · 필기 수")
    await pg.click(".u-confirm [data-u-ok]"); await pg.wait_for_timeout(600)
    calls = await pg.evaluate("CALLS.filter(c => (c.kind === 'rpc' && c.name === 'delete_sheet') || c.kind === 'remove')")
    check(any(c.get("name") == "delete_sheet" and c["args"]["p_dry"] is False and c["args"]["p_id"] == 51 for c in calls), "delete_sheet 지우기 호출")
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

async def links_tests(p):
    print("== 모든 유튜브 링크 → 앱 안 재생")
    b, pg = await page(p, mobile=True)
    await pg.goto(BASE + "/dev/tests/v31/harness.html"); await pg.wait_for_timeout(400)
    await pg.evaluate("""document.getElementById('root').innerHTML = `<ol class="hx-svc"><li><b>놀라우신 은혜</b> <a id="l1" class="hx-yt" href="https://youtu.be/CwCDGzuTrYs?t=231" target="_blank">▶ 영상</a></li></ol>
      <a id="l2" href="https://www.youtube.com/watch?v=CwCDGzuTrYs&list=PLH1dfOmrHoct-UOzuYzLZiBOAyBiyycIj&index=100&t=582s" target="_blank">I thank God</a>
      <a id="l3" href="https://www.youtube.com/@onnuri" target="_blank">채널</a>
      <a id="l4" href="https://youtu.be/CwCDGzuTrYs" data-yt-ext target="_blank">밖에서</a>`; 0""")
    pops = []
    pg.context.on("page", lambda np: pops.append(np))
    await pg.click("#l1"); await pg.wait_for_timeout(300)
    src = await pg.get_attribute(".ytp iframe", "src") or ""
    check("embed/CwCDGzuTrYs" in src and "start=231" in src, "youtu.be?t= 링크 → 앱 안 재생 · 시작 지점 " + src[-40:])
    check("놀라우신 은혜" in await pg.inner_text(".ytp-hd"), "제목은 둘레 곡 이름")
    await pg.click(".ytp-x")
    await pg.click("#l2"); await pg.wait_for_timeout(300)
    src = await pg.get_attribute(".ytp iframe", "src") or ""
    check("start=582" in src, "watch?v=…&t=582s 링크 " + src[-30:])
    await pg.click(".ytp-x")
    await pg.click("#l3"); await pg.wait_for_timeout(500)
    check(await pg.locator(".ytp").count() == 0, "영상이 아닌 유튜브 링크(채널)는 그대로")
    await pg.click("#l4"); await pg.wait_for_timeout(500)
    check(await pg.locator(".ytp").count() == 0, "data-yt-ext 링크는 밖에서 열기")
    # 악보 보기 위쪽 '레퍼런스' 단추
    await pg.evaluate("CONTI.openViewer({ id: 's1', date: '2026-11-07', setlist: null, proc: [], extras: [], applied: [] }, { items: [{ title: '은혜', key: 'G', ref: ['AAAAAAAAAAA', 30], src: [{ path: 'sheets/1/a.pdf', p: 1 }] }] })")
    await pg.wait_for_timeout(2000)
    ref = pg.locator("#cvvRef")
    if await ref.count() and await ref.is_visible():
        await ref.click(); await pg.wait_for_timeout(300)
        src = await pg.get_attribute(".ytp iframe", "src") or ""
        check("AAAAAAAAAAA" in src and "start=30" in src, "악보 보기 '레퍼런스' 단추 → 앱 안 재생")
    else: check(False, "악보 보기 레퍼런스 단추가 안 보임")
    await b.close()

async def main():
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "-d", ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        async with async_playwright() as p:
            for t in [editor_tests, draft_tests, band_tests, ios_tests, backup_tests, ink_tests, links_tests]:
                try: await t(p)
                except Exception as e: check(False, f"{t.__name__} 예외: {e}")
    finally: srv.kill()
    print(f"ok {ok} bad {bad}")
if __name__ == "__main__": asyncio.run(main())
