# v32: 예배 영상 — 기록 탭 ▶ · 리더십 확인 목록 · 콘티 쓰기 '이전 연주' · 실연주 RT · 콘티 화면 새 영상 (v31 시험 틀 · 가짜 sb)
import asyncio, json, os, subprocess, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../v31"))
import run as R
from playwright.async_api import async_playwright
FIX = """FIX.rpc.history_bundle = { songs: [{ id: 1, title: '은혜', main_key: 'G' }, { id: 2, title: '주님의 마음', main_key: 'A' }, { id: 3, title: '예수 피를 힘입어', main_key: 'D' }],
  setlists: [{ d: '2026-08-30', leaders: ['김철수'], note: '', items: [[1, 1, 'A', false, [], null]] },
             { d: '2026-10-25', leaders: ['공준혁'], note: '', items: [[1, 1, 'G', false, [['AAAAAAAAAAA', 30, '']], null], [2, 2, 'A', false, [], null]] },
             { d: '2026-11-01', leaders: ['이영희'], note: '', items: [[1, 1, 'G', false, [], null]] }], lineup: [], applied: [] };
FIX.rpc.video_bundle = { videos: [['VID00000001', '2026-10-25', 1800, '10/25 예배', new Date().toISOString(), true], ['VID00000002', '2026-08-30', 1500, '8/30', '2026-09-01T00:00:00Z', true], ['VID00000003', '2026-11-01', 1600, '11/1', '2026-11-02T00:00:00Z', false]],
  songs: [['VID00000001', 1, 231, 552, false, true], ['VID00000001', 2, 552, 800, false, true], ['VID00000002', 1, 100, 400, false, true], ['VID00000003', 1, 0, null, false, false]] };
FIX.tables.worship_videos = [
  { id: 'VID00000004', title: 'Pole2 대학부 주일예배 찬양', service_date: '2026-10-25', date_src: 'upload', status: 'review', reasons: ['date'], marks: [], leaders_said: [], pinned: false },
  { id: 'VID00000005', title: '2026년 11월 1일 주일예배', service_date: '2026-11-01', date_src: 'title', status: 'linked', reasons: ['songs', 'leader'], marks: [{ t: 0, label: '찬양 List', songs: null, skip: true }, { t: 200, label: '은혜 (Live)2', songs: null, skip: false }], leaders_said: ['홍길동'], pinned: false },
  { id: 'VID00000006', title: '2026년 10월 4일 주일예배', service_date: '2026-10-04', status: 'skipped', skip_why: 'noconti', reasons: ['noconti'], marks: [], pinned: false },
  { id: 'VID00000001', title: '10/25', service_date: '2026-10-25', status: 'linked', reasons: [], marks: [], pinned: false }];
FIX.tables.video_sync = [{ id: 1, full_done: false, pending: true, last_run: null, last_result: null }];
0;"""

async def history(p):
    print("== 기록 탭: ▶ 예배 영상 · 곡마다 우리 연주")
    b, pg = await R.page(p, mobile=True)
    await pg.goto(R.BASE + "/dev/tests/v31/harness.html"); await pg.wait_for_timeout(400)
    await pg.evaluate(FIX)
    await pg.evaluate("HISTORY.mount(document.getElementById('root'), { tab: 'his' })"); await pg.wait_for_timeout(800)
    R.check(await pg.locator(".hx-svc .hx-wv").count() == 3, "주일마다 ▶ 예배 영상 (3)")
    R.check(await pg.locator(".hx-live").count() == 3, "위치 아는 곡만 ▶ 우리 연주 (마커 없는 11/1은 영상만)")
    R.check(await pg.locator(".hx-svc .chip-ok", has_text="새 영상").count() == 2, "최근 7일 안에 연결된 영상만 '새 영상' (10/25 · 11/1, 8/30은 아님)")
    await pg.locator(".hx-live", has_text="3:51").first.click(); await pg.wait_for_timeout(300)
    src = await pg.get_attribute(".ytp iframe", "src") or ""
    R.check("VID00000001" in src and "start=231" in src and "end=552" in src, "곡 시작부터 다음 곡 전까지 " + src[-50:])
    await pg.click(".ytp-x")
    await pg.locator(".hx-svc .hx-wv").first.click(); await pg.wait_for_timeout(300)
    R.check("embed/VID0000000" in (await pg.get_attribute(".ytp iframe", "src") or ""), "▶ 예배 영상 → 앱 안 재생")
    await pg.click(".ytp-x")
    R.check(await pg.locator(".hx-vadm").count() == 0, "팀원 화면엔 확인 목록 없음")
    D = await pg.evaluate("HISTORY.load().then((D) => ({ live: D.V.live[1], p: HISTORY.perfs(D, 1, '').map((x) => x.date + x.key), pa: HISTORY.perfs(D, 1, 'A').map((x) => x.date) }))")
    R.check(D["live"] == {"sec": 311, "n": 2}, f"실연주 기준 = 중간값 {D['live']}")
    R.check(D["p"] == ["2026-11-01G", "2026-10-25G", "2026-08-30A"], f"이전 연주: 주로 부른 키(G) 먼저 · 최근 먼저 {D['p']}")
    R.check(D["pa"][0] == "2026-08-30", "키 A면 A 연주 먼저")
    R.check(not [e for e in pg.errs if "pdf" not in e.lower()], f"오류 없음 {pg.errs}")
    await pg.screenshot(path="/tmp/v32_hist.png")
    await b.close()

async def admin(p):
    print("== 리더십: 예배 영상 연결 확인 목록")
    b, pg = await R.page(p, w=1100)
    seq = {"n": 0}; reqs = []
    async def api(route):
        body = json.loads(route.request.post_data or "{}"); reqs.append(body)
        a = body.get("action"); r = {}
        if a == "video-sync": seq["n"] += 1; r = {"done": seq["n"] >= 2, "added": 3, "linked": 2, "review": 1}
        elif a == "video-rematch": r = {"checked": 4, "linked": 3, "review": 1, "skipped": 0}
        else: r = {"checked": 1, "linked": 1, "review": 0, "skipped": 0}
        await route.fulfill(body=json.dumps(r), content_type="application/json")
    await pg.route("**/api/**", api)
    await pg.goto(R.BASE + "/dev/tests/v31/harness.html"); await pg.wait_for_timeout(400)
    await pg.evaluate(FIX)
    await pg.evaluate("HISTORY.mount(document.getElementById('root'), { admin: true, tab: 'his' })"); await pg.wait_for_timeout(1000)
    box = pg.locator(".hx-vadm")
    R.check(await box.count() == 1, "리더십 화면에 '예배 영상 연결'")
    R.check(await pg.locator(".hx-vadm > .hx-vlist > .hx-vi").count() == 2, "확인 목록 2 (날짜 애매 · 곡 이름 못 맞춤)")
    t = await box.inner_text()
    R.check("처음 전체 맞추기" in t and "날짜 확인" in t and "곡 이름 확인" in t and "인도자 다름" in t, "단추 · 이유 표시")
    R.check("그날 콘티: 은혜 · 주님의 마음" in t, "그날 콘티 곡 보여 줌")
    R.check(await box.locator(".hx-vm").count() == 1 and "은혜 (Live)2" in await box.locator(".hx-vm").inner_text(), "곡이 아닌 줄('찬양 List')은 빼고 못 맞춘 마커만")
    await pg.screenshot(path="/tmp/v32_admin.png", full_page=True)
    # 마커 → 곡 연결 (그날 콘티 곡)
    row = box.locator("[data-label='은혜 (Live)2']")
    await row.locator(".hx-vsel").select_option("1")
    await row.locator("[data-va='alias']").click(); await pg.wait_for_timeout(900)
    R.check(any(r.get("action") == "video-alias" and r.get("song_id") == 1 and r.get("label") == "은혜 (Live)2" for r in reqs), "별칭 연결 요청")
    # 다른 곡 찾기
    await pg.wait_for_timeout(500)
    row = pg.locator(".hx-vadm [data-label='은혜 (Live)2']")
    await row.locator(".hx-vsel").select_option("?")
    R.check(await row.locator(".hx-vother").is_visible(), "'다른 곡…' → 곡 이름 칸")
    await row.locator(".hx-vother").fill("예수 피를 힘입어"); await row.locator("[data-va='alias']").click(); await pg.wait_for_timeout(900)
    R.check(any(r.get("action") == "video-alias" and r.get("song_id") == 3 for r in reqs), "다른 곡으로 연결")
    # 날짜 정하기 · 빼기
    vi = pg.locator(".hx-vadm .hx-vi[data-vid='VID00000004']")
    await vi.locator(".hx-vdate").fill("2026-11-01"); await vi.locator("[data-va='date']").click(); await pg.wait_for_timeout(900)
    R.check(any(r.get("action") == "video-set" and r.get("date") == "2026-11-01" and r.get("id") == "VID00000004" for r in reqs), "날짜 직접 연결")
    await pg.wait_for_timeout(300)
    await pg.locator(".hx-vadm .hx-vi[data-vid='VID00000004'] [data-va='skip']").click(); await pg.wait_for_timeout(900)
    R.check(any(r.get("action") == "video-set" and r.get("skip") for r in reqs), "빼기")
    # 처음 전체 맞추기: 나눠서 끝날 때까지
    await pg.wait_for_timeout(300)
    await pg.locator(".hx-vadm [data-va='sync']").click(); await pg.wait_for_timeout(1500)
    R.check(sum(1 for r in reqs if r.get("action") == "video-sync") == 2, "덜 끝나면 이어서 다시 부름 (2번)")
    await pg.locator(".hx-vadm [data-va='rematch']").click(); await pg.wait_for_timeout(900)
    R.check(any(r.get("action") == "video-rematch" for r in reqs), "다시 맞추기")
    R.check("건너뛴 영상 1개" in await pg.inner_text(".hx-vadm"), "건너뛴 영상 (그날 콘티 없음) 접어 둠")
    R.check(not [e for e in pg.errs if "pdf" not in e.lower()], f"오류 없음 {pg.errs}")
    await b.close()

async def editor(p):
    print("== 콘티 쓰기: 이전 연주 · 실연주 RT")
    b, pg = await R.page(p, mobile=True, w=430)
    await pg.goto(R.BASE + "/dev/tests/v31/harness.html"); await pg.wait_for_timeout(400)
    await pg.evaluate(FIX)
    await pg.evaluate("CONTI.openEditor('s1')"); await pg.wait_for_timeout(900)
    await pg.fill("#ceQ", "은혜"); await pg.wait_for_timeout(300)
    pv = pg.locator("[data-ce-prev='1']")
    R.check(await pv.count() == 1 and (await pv.inner_text()).strip() == "연주 3", "곡 찾기: 레퍼런스 ▶ 옆에 '연주 3'")
    R.check("5:11" in await pg.inner_text(".ce-orow"), "곡 찾기 예상 시간 = 실연주 기준 5:11")
    await pv.click(); await pg.wait_for_timeout(300)
    rows = pg.locator(".ce-pvbox .pv-row")
    R.check(await rows.count() == 3, "이전 연주 목록 3")
    txt = [t.replace("\n", " ") for t in await rows.all_inner_texts()]
    R.check("26.11.01" in txt[0] and "곡 위치 모름" in txt[0] and "26.10.25" in txt[1] and "5:21" in txt[1] and "26.08.30" in txt[2], f"G(주로 부른 키) 먼저 · 최근 먼저 · 위치 모름 {txt}")
    R.check("이영희" in txt[0] and "공준혁" in txt[1], "인도자 표시")
    await pg.screenshot(path="/tmp/v32_search.png")
    await rows.nth(1).click(); await pg.wait_for_timeout(300)
    src = await pg.get_attribute(".ytp iframe", "src") or ""
    R.check("VID00000001" in src and "start=231" in src, "누르면 그 곡 시작 지점부터 앱 안 재생")
    R.check(await pg.locator("[data-add]").count() >= 1 and await pg.locator(".ce-row").count() == 0, "목록을 눌러도 곡은 안 들어감")
    await pg.click(".ytp-x")
    await pg.click("[data-ce-prev='1']"); await pg.wait_for_timeout(200)
    R.check(await pg.locator(".ce-pvbox").count() == 0, "다시 누르면 닫힘")
    await pg.click("[data-add='1']"); await pg.wait_for_timeout(700)
    R.check("실연주" in await pg.inner_text(".ce-row .ce-src") and await pg.locator(".ce-row [data-f='dur']").input_value() == "5:11", "넣으면 곡 시간 = 실연주 기준 (출처 '실연주')")
    await pg.click("[data-ce='more']"); await pg.wait_for_timeout(600)
    f = pg.locator(".ce-prevf")
    R.check(await f.count() == 1 and "이전 연주" in await f.inner_text() and await pg.locator(".ce-reftag").count() == 1, "펼침: '이전 연주' 칸 · 레퍼런스(음원)와 이름표 다름")
    first = lambda: pg.locator(".ce-prevf .pv-row").first.inner_text()
    R.check("26.11.01" in await first(), "키 없으면 주로 부른 키(G) 먼저")
    await pg.locator(".ce-row [data-f='key']").fill("A"); await pg.locator(".ce-row [data-f='key']").dispatch_event("change"); await pg.wait_for_timeout(500)
    R.check("26.08.30" in await first(), "키를 A로 바꾸면 A 연주가 맨 위로")
    await pg.screenshot(path="/tmp/v32_more.png")
    await pg.click("[data-ce='publish']"); await pg.wait_for_timeout(900)
    calls = await pg.evaluate("CALLS.filter(c => c.kind === 'rpc' && c.name === 'save_setlist')")
    it = calls[-1]["args"]["p_data"]["items"][0] if calls else {}
    R.check(it.get("duration_sec") == 311 and it.get("duration_src") == "live", f"저장: duration_src 'live' {it.get('duration_sec')} {it.get('duration_src')}")
    R.check(not [e for e in pg.errs if "pdf" not in e.lower()], f"오류 없음 {pg.errs}")
    await b.close()

async def week(p):
    print("== 콘티 화면: 예배 영상이 올라왔어요")
    b, pg = await R.page(p, mobile=True)
    await pg.goto(R.BASE + "/dev/tests/v31/harness.html"); await pg.wait_for_timeout(400)
    await pg.evaluate(FIX + """FIX.rpc.conti_week = [{ id: 's1', date: '2099-11-15', deadline: '2099-11-12T14:59:00Z', lineup: [], setlist: null }];
      FIX.tables.worship_videos = [{ id: 'VID00000001', service_date: '2026-11-01', title: 'x', status: 'linked', linked_at: new Date().toISOString() }]; 0;""")
    await pg.evaluate("localStorage.clear(); CONTI.mountWeek(document.getElementById('root'), { me: { id: 'u-lead' } })"); await pg.wait_for_timeout(900)
    n = pg.locator(".cv-vnews")
    R.check(await n.count() == 1 and "예배 영상이 올라왔어요" in await n.inner_text() and "11/1 주일" in await n.inner_text(), "맨 위에 '예배 영상이 올라왔어요'")
    await pg.screenshot(path="/tmp/v32_week.png")
    await n.locator(".btn").click(); await pg.wait_for_timeout(300)
    R.check("VID00000001" in (await pg.get_attribute(".ytp iframe", "src") or ""), "▶ 보기 → 앱 안 재생")
    await pg.click(".ytp-x")
    await n.locator("[data-vnews-x]").click(); await pg.wait_for_timeout(200)
    R.check(await pg.locator(".cv-vnews").count() == 0, "✕ 닫기")
    await pg.evaluate("CONTI.mountWeek(document.getElementById('root'), { me: { id: 'u-lead' } })"); await pg.wait_for_timeout(900)
    R.check(await pg.locator(".cv-vnews").count() == 0, "닫은 영상은 다시 안 보임")
    R.check(not [e for e in pg.errs if "pdf" not in e.lower()], f"오류 없음 {pg.errs}")
    await b.close()

async def main():
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(R.PORT), "-d", R.ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        async with async_playwright() as p:
            for t in [history, admin, editor, week]:
                try: await t(p)
                except Exception as e: R.check(False, f"{t.__name__} 예외: {e}")
    finally: srv.kill()
    print(f"ok {R.ok} bad {R.bad}")
if __name__ == "__main__": asyncio.run(main())
