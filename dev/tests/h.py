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
# 021.1: 관리자 메뉴 서랍 — 닫힌 묶음이면 묶음 제목부터 누르고 메뉴를 누름
async def navclick(pg, key):
    a = pg.locator(f'.side nav a[data-nav="{key}"]')
    if not await a.is_visible():
        g = pg.locator(f'.side .nav-sec:has(a[data-nav="{key}"]) > button.nav-group')
        if await g.count(): await g.click(); await pg.wait_for_timeout(300)
    await a.click()
