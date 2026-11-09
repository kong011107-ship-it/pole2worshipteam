# v33: 곡 탭 · 곡 상세 '부른 기록'에 우리 연주(예배 영상) 연결 · 곡 상세 더 보기 (v31 시험 틀 · 가짜 sb)
import asyncio, json, os, subprocess, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../v31"))
import run as R
from playwright.async_api import async_playwright
# 곡 1을 14번 부름 (8/2 ~ 11/1 매주). 영상: 10/25(위치 앎 231~552) · 11/1(위치 모름)
FIX = """(() => { const ds = []; for (let i = 0; i < 14; i++) { const d = new Date(Date.UTC(2026, 7, 2 + 7 * i)); ds.push(d.toISOString().slice(0, 10)); }
FIX.rpc.history_bundle = { songs: [{ id: 1, title: '은혜', main_key: 'G' }, { id: 2, title: '주님의 마음', main_key: 'A' }],
  setlists: ds.map((d, i) => ({ d, leaders: [i % 2 ? '공준혁' : '이영희'], note: '', items: [[1, 1, 'G', false, [['AAAAAAAAAAA', 30, '']], null], [2, 2, 'A', false, [], null]] })), lineup: [], applied: [] };
FIX.rpc.video_bundle = { videos: [['VID00000001', '2026-10-25', 1800, '10/25', '2026-10-26T00:00:00Z', true], ['VID00000003', '2026-11-01', 1600, '11/1', '2026-11-02T00:00:00Z', false]],
  songs: [['VID00000001', 1, 231, 552, false, true, 'solo', null, null], ['VID00000001', 2, 552, 800, false, true, 'solo', null, null], ['VID00000003', 1, 0, null, false, false, 'solo', null, null]] };
FIX.tables.songs = [{ id: 1, title: '은혜', main_key: 'G', team_sec: null }, { id: 2, title: '주님의 마음', main_key: 'A' }];
return ds.length; })();"""

async def lib(p):
    print("== 기록 › 곡: 부른 기록에 우리 연주")
    b, pg = await R.page(p, mobile=True)
    await pg.goto(R.BASE + "/dev/tests/v31/harness.html"); await pg.wait_for_timeout(400)
    await pg.evaluate(FIX)
    await pg.evaluate("HISTORY.mount(document.getElementById('root'), { tab: 'lib' })"); await pg.wait_for_timeout(900)
    card = pg.locator(".hx-refs", has_text="부른 기록 14번").first
    R.check(await card.count() == 1 and "영상 2" in await card.locator("summary").inner_text(), "제목에 '부른 기록 14번 · 영상 2'")
    await card.locator("summary").click(); await pg.wait_for_timeout(200)
    items = card.locator("li")
    t0, t1 = await items.nth(0).inner_text(), await items.nth(1).inner_text()
    R.check("26.11.01" in t0 and "▶ 예배 영상" in t0 and "위치 모름" in t0, f"위치 모르는 날: 예배 영상 처음부터 {t0!r}")
    R.check("26.10.25" in t1 and "▶ 우리 연주 3:51" in t1, f"위치 아는 날: 우리 연주 3:51 {t1!r}")
    R.check(await items.nth(2).locator(".hx-live, .hx-wv").count() == 0, "영상 없는 날은 버튼 없음")
    R.check(await items.nth(1).locator(".hx-yt").count() == 1, "레퍼런스 ▶(보라)는 그대로")
    await items.nth(1).locator(".hx-live").click(); await pg.wait_for_timeout(300)
    src = await pg.get_attribute(".ytp iframe", "src") or ""
    R.check("VID00000001" in src and "start=231" in src and "end=552" in src, "누르면 곡 시작부터 다음 곡 전까지 앱 안 재생 " + src[-40:])
    await pg.click(".ytp-x")
    await items.nth(0).locator(".hx-wv").click(); await pg.wait_for_timeout(300)
    src = await pg.get_attribute(".ytp iframe", "src") or ""
    R.check("VID00000003" in src and "start=231" not in src, "위치 모름 → 처음부터")
    await pg.screenshot(path="/tmp/v33_lib.png")
    R.check(not [e for e in pg.errs if "pdf" not in e.lower()], f"오류 없음 {pg.errs}")
    await b.close()

async def detail(p):
    print("== 곡 상세: 부른 기록에 우리 연주 · 더 보기")
    b, pg = await R.page(p, mobile=True)
    await pg.goto(R.BASE + "/dev/tests/v31/harness.html"); await pg.wait_for_timeout(400)
    await pg.evaluate(FIX)
    await pg.evaluate("CONTI.songDetail(1)"); await pg.wait_for_timeout(1000)
    sec = pg.locator("#sdLog")
    R.check(await sec.count() == 1 and "14번 · 영상 2" in await sec.locator(".card-title").inner_text(), "제목 '14번 · 영상 2'")
    R.check(await sec.locator(".sd-log:visible").count() == 12, "처음엔 12개")
    rows = sec.locator(".sd-log")
    R.check("▶ 예배 영상" in await rows.nth(0).inner_text() and "위치 모름" in await rows.nth(0).inner_text(), "11/1: 예배 영상 · 곡 위치 모름")
    R.check("▶ 우리 연주 3:51" in await rows.nth(1).inner_text(), "10/25: 우리 연주 3:51")
    await rows.nth(1).locator(".hx-live").click(); await pg.wait_for_timeout(300)
    src = await pg.get_attribute(".ytp iframe", "src") or ""
    R.check("VID00000001" in src and "start=231" in src, "앱 안 재생 " + src[-40:])
    await pg.click(".ytp-x"); await pg.wait_for_timeout(200)
    R.check(await pg.locator("#sdLog").count() == 1, "재생을 닫아도 곡 상세는 그대로")
    mb = sec.locator("[data-sd-more]")
    R.check(await mb.count() == 1 and "2번 더 보기" in await mb.inner_text(), "'2번 더 보기'")
    await mb.click(); await pg.wait_for_timeout(200)
    R.check(await sec.locator(".sd-log:visible").count() == 14 and await sec.locator("[data-sd-more]").count() == 0, "더 보기 → 14개 전부")
    await pg.screenshot(path="/tmp/v33_detail.png", full_page=True)
    R.check(not [e for e in pg.errs if "pdf" not in e.lower()], f"오류 없음 {pg.errs}")
    await b.close()

async def main():
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(R.PORT), "-d", R.ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        async with async_playwright() as p:
            for t in [lib, detail]:
                try: await t(p)
                except Exception as e: R.check(False, f"{t.__name__} 예외: {e}")
    finally: srv.kill()
    print(f"ok {R.ok} bad {R.bad}")
if __name__ == "__main__": asyncio.run(main())
