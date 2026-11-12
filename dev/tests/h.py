import asyncio, json, re, sys, os
from playwright.async_api import async_playwright
BASE = "http://localhost:8790"
UMD = "/home/claude/wp/node_modules/@supabase/supabase-js/dist/umd/supabase.js"
ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
async def browser(p, mobile=False, ua=None, **kw):
    b = await p.chromium.launch(executable_path=[x for x in [os.popen("ls -d /opt/pw-browsers/chromium-*/chrome-linux*/chrome | head -1").read().strip()] if x][0])
    opts = dict(viewport={"width": 390, "height": 844} if mobile else {"width": 1440, "height": 1000}, has_touch=mobile, is_mobile=mobile, accept_downloads=True)
    if mobile: opts["user_agent"] = ua or ANDROID_UA
    opts.update(kw)
    ctx = await b.new_context(**opts)
    async def umd(route): await route.fulfill(path=UMD, content_type="text/javascript")
    await ctx.route(re.compile(r".*supabase-js@2.*"), umd)
    await ctx.route(re.compile(r".*(cdn\.jsdelivr|fonts\.googleapis|fonts\.gstatic|cdnjs).*"), lambda r: r.fulfill(body="", status=200) if "supabase" not in r.request.url else r.fallback())
    # 022: 악보 도구 (pdf.js · pdf-lib) — 나중에 등록한 route가 먼저
    L = "/home/claude/libs/node_modules/"
    async def lib(route):
        u = route.request.url
        f = L + ("pdfjs-dist/build/pdf.worker.min.js" if "pdf.worker" in u else "pdfjs-dist/build/pdf.min.js" if "pdf.js" in u else "pdf-lib/dist/pdf-lib.min.js")
        await route.fulfill(path=f, content_type="text/javascript", headers={"Access-Control-Allow-Origin": "*"})
    await ctx.route(re.compile(r".*(pdf\.js/3\.11\.174|pdf-lib@1\.17\.1).*"), lib)
    return b, ctx
async def login(ctx, email, pw, dest="admin.html"):
    pg = await ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" and "404" not in m.text and "WebSocket" not in m.text and "Failed to load resource" not in m.text else None)
    await pg.goto(BASE + "/login.html")
    await pg.fill("input[type=email]", email); await pg.fill("input[type=password]", pw)
    await pg.click("#loginBtn")
    await pg.wait_for_url(re.compile(r".*(admin|me)\.html.*"), timeout=10000)
    if dest and dest not in pg.url: await pg.goto(BASE + "/" + dest)
    await pg.wait_for_timeout(1200)
    pg.errs = errs
    return pg
# v34.3: 리더십 메뉴 B안 — 레일(영역)을 누른 뒤 메뉴 칸의 메뉴를 눌러요. 휴대폰 폭이면 하단 탭 + 위 세그먼트
AD_AREA = {"dashboard": "home", "schedule": "serve", "lineup": "serve", "attendance": "serve", "conti": "worship", "songs": "worship", "history": "worship",
           "members": "people", "pipeline": "people", "forecast": "people", "notify": "comm", "sharing": "comm", "settings": "settings"}
async def navclick(pg, key):
    area = AD_AREA.get(key, "home")
    a = pg.locator(f'#adItems a[data-nav="{key}"]')
    if await a.count() and await a.is_visible():
        await a.click(); return
    rail = pg.locator(f'#adRail [data-area="{area}"]')
    if await rail.is_visible():
        await rail.click(); await pg.wait_for_timeout(300)
        a = pg.locator(f'#adItems a[data-nav="{key}"]')
        if await a.is_visible(): await a.click(); return
        fly = pg.locator(f'#adFly a[data-nav="{key}"]')
        if await fly.count(): await fly.click(); return
        await pg.click("#adOpen"); await pg.wait_for_timeout(300); await pg.click(f'#adItems a[data-nav="{key}"]'); return
    await pg.click(f'#adTab [data-area="{area}"]'); await pg.wait_for_timeout(300)
    seg = pg.locator(f'#adSeg [data-nav-m="{key}"]')
    if await seg.count(): await seg.click()

# 029: 테스트 날짜와 상관없이 다가오는 주일 라인업을 LINEUPS[0]으로 고정 (demo.js 순서가 날짜마다 달라져서)
def fix_lineup(q, sid):
    q(f"delete from assignments where service_id='{sid}'")
    rows = [("leader",1,1,False,False),("singer",1,2,True,False),("singer",2,3,False,False),("singer",3,4,False,False),
            ("key_main",1,6,False,True),("key_second",1,7,False,False),("e_guitar",1,8,False,False),("bass",1,9,False,False),("drum",1,10,False,False)]
    for pos, slot, n, sl, bm in rows:
        q(f"insert into assignments(service_id, position_code, slot, member_id, is_singer_leader, is_band_master) select '{sid}', '{pos}', {slot}, id, {str(sl).lower()}, {str(bm).lower()} from members where email='demo{n:02d}@pole2.test'")
    q(f"update services set status='published' where id='{sid}'")

# v35: 리더십 콘티 목록 — 줄(.ca-row) · 주 행동(쓰기/고치기) · 악보는 줄에, 나머지는 '더보기' 시트(.ca-sheet)에
def ca_row(pg, sid, past=False):
    return pg.locator(f'{"#caPast " if past else ""}.ca-row[data-sid="{sid}"]')
async def ca_more(pg, sid, act):
    await ca_row(pg, sid).locator("[data-ca=more]").click(); await pg.wait_for_timeout(400)
    return pg.locator(f'.ca-sheet [data-ca="{act}"]')
