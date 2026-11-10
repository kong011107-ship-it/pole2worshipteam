# v34.1 화면 시험 (실제 스택 · 캡처용 데이터 seed 덤프 위에서)
#  팀원 홈 · 하단 탭 4개 · 프로필 단추 · 찬양 › 콘티(예배 고르기 · 콘티 카드 · 다음 순서 · 라인업 · 곡 서랍) · 섬김이 링크
#  콘티 쓰기: 고른 악보 '빼기' · 미리보기 '이 콘티에서 빼기' · '지우기'(확인 창) · 밴드는 지우기 없음 · 동작 줄이기
import asyncio, os, re, subprocess, sys
from playwright.async_api import async_playwright
BASE = "http://localhost:8790"
UMD = "/home/claude/wp/node_modules/@supabase/supabase-js/dist/umd/supabase.js"
L = "/home/claude/libs/node_modules/"
CHROME = os.popen("ls -d /opt/pw-browsers/chromium-*/chrome-linux*/chrome | head -1").read().strip()
SHOT = os.environ.get("SHOT", "/tmp/v34_")
ok = 0; bad = []
def check(c, m):
    global ok
    if c: ok += 1; print("  ok ", m)
    else: bad.append(m); print("  BAD", m)
def q(sql): return subprocess.run(["su", "postgres", "-c", f"psql -d wt -At -c \"{sql}\""], capture_output=True, text=True).stdout.strip()

async def ctx_for(b, w, h, mobile, reduced=False):
    ctx = await b.new_context(viewport={"width": w, "height": h}, has_touch=mobile, is_mobile=mobile, reduced_motion="reduce" if reduced else "no-preference")
    async def umd(r): await r.fulfill(path=UMD, content_type="text/javascript")
    await ctx.route(re.compile(r".*supabase-js@2.*"), umd)
    await ctx.route(re.compile(r".*(fonts\.googleapis|fonts\.gstatic|youtube|ytimg).*"), lambda r: r.fulfill(body="", status=200))
    async def lib(route):
        u = route.request.url
        f = L + ("pdfjs-dist/build/pdf.worker.min.js" if "pdf.worker" in u else "pdfjs-dist/build/pdf.min.js" if "pdf.js" in u else "pdf-lib/dist/pdf-lib.min.js")
        await route.fulfill(path=f, content_type="text/javascript", headers={"Access-Control-Allow-Origin": "*"})
    await ctx.route(re.compile(r".*(pdf\.js/3\.11\.174|pdf-lib@1\.17\.1).*"), lib)
    return ctx
async def login(ctx, email, pw, dest="/me.html"):
    pg = await ctx.new_page(); pg.errs = []
    pg.on("pageerror", lambda e: pg.errs.append(str(e)))
    pg.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
    await pg.goto(BASE + "/login.html")
    await pg.fill("input[type=email]", email); await pg.fill("input[type=password]", pw)
    await pg.click("#loginBtn")
    await pg.wait_for_url(re.compile(r".*(admin|me)\.html.*"), timeout=15000)
    if dest not in pg.url: await pg.goto(BASE + dest)
    await pg.wait_for_timeout(1500)
    return pg

async def member(p):
    print("== 팀원 홈 · 탭 · 프로필")
    b = await p.chromium.launch(executable_path=CHROME)
    ctx = await ctx_for(b, 390, 844, True)
    pg = await login(ctx, "demo02@pole2.test", "pole2test!")
    labels = [x.strip() for x in await pg.locator("#tabbar button").all_text_contents()]
    check(labels == ["홈", "찬양", "섬김", "나눔"], f"하단 탭 4개 {labels}")
    check(await pg.locator("#tabbar .u-ind").count() == 1, "하단 탭 선택 표시(알약)")
    check(await pg.locator("#view-home .u-hd h1").text_content() == "이번 주", "홈 '이번 주' 머리글")
    wk = pg.locator("#weekCard")
    t = await wk.text_content()
    check("11월 15일 주일 섬김" in t and "싱어 리더" in t, f"이번 주 섬김 카드 {t[:60]}")
    tl = [x.strip() for x in await wk.locator(".u-tli .u-tlt b").all_text_contents()]
    check(tl == ["토 11/14", "토 11/14", "일 11/15"], f"타임라인 날짜는 같은 길이 {tl}")
    check([x.strip() for x in await wk.locator(".u-tlm b").all_text_contents()] == ["토요 연습", "팀모임", "리허설 · 섬김"], "토요 연습 → 팀모임 → 주일")
    await pg.wait_for_timeout(800)
    check("콘티 올라옴" in await pg.locator("#weekConti").text_content() and "4곡" in await pg.locator("#weekConti").text_content(), "콘티 상태 한 줄 (4곡 · 메들리 뒷곡 제외)")
    check(await pg.locator('#weekCard [data-home="pdf"]:not([disabled])').count() == 1, "악보 열기 켜짐")
    n = await pg.locator("#view-home .u-dbx").count()
    check(1 <= n <= 3 and await pg.locator("#view-home .u-dbx.u-on").count() == 1, f"다음 섬김 최대 3개 · 이번 주 강조 ({n})")
    check(await pg.locator('#view-home a.u-itm[href="#pray"]').count() == 1, "기도제목 바로가기")
    sw = await pg.evaluate("document.documentElement.scrollWidth")
    check(sw <= 392, f"가로 넘침 없음 {sw}")
    await pg.screenshot(path=SHOT + "home.png", full_page=True)
    await pg.click('#weekCard [data-home="conti"]'); await pg.wait_for_timeout(1800)
    check(pg.url.endswith("#worship") and await pg.locator(".cvw-conti").count() == 1, "콘티 보기 → 찬양 › 콘티")
    await pg.click("#meBtn"); await pg.wait_for_timeout(800)
    check(pg.url.endswith("#info") and "김하늘(T)님" in await pg.locator("#infoName").text_content(), "프로필 단추 → 내 정보 (이름)")
    check(await pg.locator("#meBtn.on").count() == 1 and await pg.locator("#tabbar .on").count() == 0, "내 정보일 때 프로필 단추 표시 · 하단 탭은 없음")

    print("== 찬양 › 콘티")
    await pg.click('#tabbar [data-tab="worship"]'); await pg.wait_for_timeout(1800)
    check("11월 15일 주일" in await pg.locator(".cvw-sw .u-wsel").text_content(), "예배 고르기 ◀ 선택 ▶")
    check(await pg.locator('.cvw-sw [data-cv-step="-1"][disabled]').count() == 1, "첫 예배면 ◀ 꺼짐")
    nums = [x.strip() for x in await pg.locator(".cvw-slist .cv-sn").all_text_contents()]
    check(nums == ["1", "2", "+", "3", "4"], f"곡 번호 · 메들리 뒷곡 + {nums}")
    check("20:30" in await pg.locator(".cvw-conti .u-rtl").text_content(), "RT 줄")
    check(await pg.locator("#cvFlow .u-acc-t").count() >= 1 and await pg.locator(".cvw-avs > span").count() >= 6, "다음 순서 · 라인업 얼굴 묶음")
    acc = pg.locator("#cvFlow [data-cv-acc]").first
    await acc.click(); await pg.wait_for_timeout(300)
    check(await acc.get_attribute("aria-expanded") == "true" and await pg.locator("#cvFlow .u-coll.u-open").count() == 1, "펼치기")
    await pg.click(".cvw-st >> nth=0"); await pg.wait_for_timeout(1200)
    sh = pg.locator(".u-sh .u-sheet")
    check(await sh.count() == 1 and "주의 이름 높이며" in await sh.locator(".u-shh").text_content(), "곡 서랍")
    check("이번 키" in await sh.text_content() and await sh.locator('.cvw-dseg [data-tab="1"]').count() == 1, "정보 | 부른 기록")
    await sh.locator('.cvw-dseg [data-tab="1"]').click(); await pg.wait_for_timeout(300)
    check(await sh.locator('.cvw-dseg [data-tab="1"][aria-pressed="true"]').count() == 1, "부른 기록 탭")
    await pg.screenshot(path=SHOT + "song_sheet.png")
    await pg.keyboard.press("Escape"); await pg.wait_for_timeout(400)
    check(await pg.locator(".u-sh").count() == 0, "Esc로 닫힘 (닫히는 모션 뒤 사라짐)")
    await pg.click("[data-cv-weeks]"); await pg.wait_for_timeout(500)
    n = await pg.locator(".u-sh [data-pick]").count()
    check(n >= 2, f"예배 고르기 서랍 {n}개")
    await pg.locator(".u-sh [data-pick]").nth(1).click(); await pg.wait_for_timeout(1500)
    check("11월 22일" in await pg.locator(".cvw-sw .u-wsel").text_content() and await pg.locator(".cv-wait").count() == 1, "다른 예배 → 빈 상태")
    await pg.click('.cvw-sw [data-cv-step="-1"]'); await pg.wait_for_timeout(1500)
    await pg.click(".cvw-lu .u-lnk"); await pg.wait_for_timeout(500)
    check(await pg.locator(".u-sh .u-lur").count() == 9 and await pg.locator(".u-sh .u-av1.u-me").count() == 1, "라인업 서랍 9명 · 나")
    await pg.keyboard.press("Escape"); await pg.wait_for_timeout(300)
    # 세그먼트 선택 표시
    check(await pg.locator("#worshipNav .segbar .u-thumb").count() == 1, "위 세그먼트 흰 칸")
    x0 = await pg.evaluate("getComputedStyle(document.querySelector('#worshipNav .u-thumb')).transform")
    await pg.click('#worshipNav [data-ws="backup"]'); await pg.wait_for_timeout(500)
    x1 = await pg.evaluate("getComputedStyle(document.querySelector('#worshipNav .u-thumb')).transform")
    check(x0 != x1, f"세그먼트 선택 표시가 움직임 {x0} → {x1}")
    check(not pg.errs, f"오류 없음 {pg.errs[:3]}")
    await b.close()

async def reduced(p):
    print("== 동작 줄이기")
    b = await p.chromium.launch(executable_path=CHROME)
    ctx = await ctx_for(b, 390, 844, True, reduced=True)
    pg = await login(ctx, "demo02@pole2.test", "pole2test!")
    d = await pg.evaluate("getComputedStyle(document.querySelector('#view-home')).animationDuration")
    check(d in ("0.001s", "1e-03s", "0s"), f"화면 전환 모션 꺼짐 {d}")
    await pg.click('#tabbar [data-tab="worship"]'); await pg.wait_for_timeout(1500)
    await pg.click(".cvw-st >> nth=0"); await pg.wait_for_timeout(600)
    await pg.keyboard.press("Escape"); await pg.wait_for_timeout(60)
    check(await pg.locator(".u-sh").count() == 0, "서랍이 바로 닫힘")
    await b.close()

async def share(p):
    print("== 섬김이 링크 (같은 배치 · 모션 없음)")
    tok = q("select token from share_links where active limit 1")
    b = await p.chromium.launch(executable_path=CHROME)
    ctx = await ctx_for(b, 390, 844, True)
    pg = await ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    await pg.goto(BASE + "/share.html?t=" + tok); await pg.wait_for_timeout(2500)
    check(await pg.locator(".shv-conti .cvw-slist .cv-srow").count() == 5 and await pg.locator(".shv-sw").count() == 1, "콘티 카드 · 예배 고르기")
    check(await pg.locator(".shv-flow .cv-prow").count() >= 1, "콘티 다음 순서")
    check(await pg.evaluate("getComputedStyle(document.querySelector('#shMain')).animationName") == "none", "모션 없음")
    check(await pg.evaluate("typeof window.UI") == "undefined", "ui.js 안 불러옴")
    await pg.click('.shv-sw [aria-label="다음 예배"]'); await pg.wait_for_timeout(500)
    check("11/22 주일" in await pg.locator(".shv-sel").text_content(), "다음 예배로")
    check(not errs, f"오류 없음 {errs[:3]}")
    await b.close()

async def editor(p):
    print("== 콘티 쓰기: 빼기 · 지우기")
    song = q("select id from songs where title='주의 이름 높이며'")
    sid = q("select id from services where service_date='2026-11-15' and ministry_id is null")
    lead = q("select id from members where email='demo01@pole2.test'")
    sv = q(f"insert into sheet_versions(song_id, kind, name, pages, path, created_by, added_for) values ({song}, 'sheet', '잘못 넣은 악보', 2, 'sheets/{song}/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.pdf', '{lead}', '{sid}') returning id").splitlines()[0]
    sv2 = q(f"insert into sheet_versions(song_id, kind, name, pages, path) values ({song}, 'original', '원본 G', 1, 'originals/{song}/bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb.pdf') returning id").splitlines()[0]
    q(f"update setlist_items set sheet_id={sv}, page_from=1, page_to=2 where song_id={song} and setlist_id=(select id from setlists where service_id='{sid}')")
    v0 = q(f"select version from setlists where service_id='{sid}'")
    b = await p.chromium.launch(executable_path=CHROME)
    # 밴드: 지우기 없음
    ctx = await ctx_for(b, 820, 1180, True)
    bp = await login(ctx, "demo07@pole2.test", "pole2test!")
    await bp.goto(BASE + "/me.html#worship"); await bp.wait_for_timeout(1800)
    await bp.click("[data-cv-edit]"); await bp.wait_for_timeout(1800)
    # v34.2: 곡 줄을 펼쳐 악보 탭
    row = bp.locator('.ce-row:has(.ce-t b:text-is("주의 이름 높이며"))')
    await row.locator(".ce2-hd").click(); await bp.wait_for_timeout(300)
    await row.locator('[data-ce="tab"][data-tab="sheet"]').click(); await bp.wait_for_timeout(400)
    await bp.locator(f'[data-ce="sheet-pv"][data-id="{sv}"]').click(); await bp.wait_for_timeout(400)
    check(await bp.locator('[data-ce="sheet-del"]').count() == 0 and await bp.locator('.ce-prev [data-ce="sheet-none"]').count() == 1, "밴드: '이 콘티에서 빼기'만 · 지우기 없음")
    await ctx.close()
    # 인도자
    ctx = await ctx_for(b, 820, 1180, True)
    pg = await login(ctx, "demo01@pole2.test", "pole2test!")
    await pg.goto(BASE + "/me.html#worship"); await pg.wait_for_timeout(1800)
    await pg.click("[data-cv-edit]"); await pg.wait_for_timeout(1800)
    row = pg.locator('.ce-row:has(.ce-t b:text-is("주의 이름 높이며"))')
    await row.locator(".ce2-hd").click(); await pg.wait_for_timeout(300)
    await row.locator('[data-ce="tab"][data-tab="sheet"]').click(); await pg.wait_for_timeout(400)
    check(await pg.locator(".ce-unlink").count() == 1, "고른 악보 옆 '빼기'")
    await pg.locator(f'[data-ce="sheet-pv"][data-id="{sv}"]').click(); await pg.wait_for_timeout(400)
    check(await pg.locator('.ce-prev [data-ce="sheet-none"]').count() == 1 and await pg.locator('[data-ce="sheet-del"]').count() == 1, "미리보기: 이 콘티에서 빼기 · 지우기")
    await pg.screenshot(path=SHOT + "editor_sheet.png")
    await pg.click('[data-ce="sheet-del"]'); await pg.wait_for_timeout(800)
    cf = pg.locator(".u-confirm")
    t = await cf.text_content() if await cf.count() else ""
    check("잘못 넣은 악보" in t and "올라온 콘티 1개" in t and "알림은 가지 않아요" in t, f"확인 창 {t[:90]}")
    await pg.screenshot(path=SHOT + "delete_confirm.png")
    await pg.click(".u-confirm [data-u-ok]"); await pg.wait_for_timeout(1500)
    check(q(f"select count(*) from sheet_versions where id={sv}") == "0", "지워짐")
    check(q(f"select coalesce(sheet_id::text,'null') from setlist_items where song_id={song} and setlist_id=(select id from setlists where service_id='{sid}')") == "null", "올라온 콘티에서 빠짐")
    check(int(q(f"select version from setlists where service_id='{sid}'")) == int(v0) + 1, "버전 +1")
    check(await pg.locator(f'[data-ce="sheet-pv"][data-id="{sv}"]').count() == 0 and await pg.locator(".ce-unlink").count() == 0, "목록에서 사라지고 그 곡은 악보 없이")
    # 원본은 '빼기'(악보 없이) 후 저장 없이도 다시 고를 수 있음
    if not await pg.locator(".ce-shlist").count(): await row.locator('[data-ce="tab"][data-tab="sheet"]').click(); await pg.wait_for_timeout(400)
    check(await pg.locator(f'[data-ce="sheet-pv"][data-id="{sv2}"]').count() == 1, "다른 악보는 그대로")
    check(not pg.errs, f"오류 없음 {pg.errs[:3]}")
    await b.close()

async def main():
    async with async_playwright() as p:
        for t in [member, reduced, share, editor]:
            try: await t(p)
            except Exception as e: check(False, f"{t.__name__} 예외: {str(e)[:300]}")
    print(f"ok {ok} bad {len(bad)} {bad}")
asyncio.run(main())
