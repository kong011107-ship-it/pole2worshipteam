# 전후 비교 캡처: python3 cap.py <out_dir>
import asyncio, os, re, subprocess, sys
from playwright.async_api import async_playwright
BASE = "http://localhost:8790"
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
UMD = "/home/claude/wp/node_modules/@supabase/supabase-js/dist/umd/supabase.js"
L = "/home/claude/libs/node_modules/"
CHROME = os.popen("ls -d /opt/pw-browsers/chromium-*/chrome-linux*/chrome | head -1").read().strip()
ERRS = []

def q(sql):
    return subprocess.run(["su", "postgres", "-c", f"psql -d wt -At -c \"{sql}\""], capture_output=True, text=True).stdout.strip()

async def ctx_for(b, w, h, mobile):
    ctx = await b.new_context(viewport={"width": w, "height": h}, has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
    async def umd(r): await r.fulfill(path=UMD, content_type="text/javascript")
    await ctx.route(re.compile(r".*supabase-js@2.*"), umd)
    await ctx.route(re.compile(r".*(fonts\.googleapis|fonts\.gstatic|youtube|ytimg).*"), lambda r: r.fulfill(body="", status=200))
    async def lib(route):
        u = route.request.url
        f = L + ("pdfjs-dist/build/pdf.worker.min.js" if "pdf.worker" in u else "pdfjs-dist/build/pdf.min.js" if "pdf.js" in u else "pdf-lib/dist/pdf-lib.min.js")
        await route.fulfill(path=f, content_type="text/javascript", headers={"Access-Control-Allow-Origin": "*"})
    await ctx.route(re.compile(r".*(pdf\.js/3\.11\.174|pdf-lib@1\.17\.1).*"), lib)
    return ctx

async def login(ctx, email, pw):
    pg = await ctx.new_page()
    pg.on("pageerror", lambda e: ERRS.append(f"{email}: {e}"))
    await pg.goto(BASE + "/login.html")
    await pg.fill("input[type=email]", email); await pg.fill("input[type=password]", pw)
    await pg.click("#loginBtn")
    await pg.wait_for_url(re.compile(r".*(admin|me)\.html.*"), timeout=15000)
    await pg.wait_for_timeout(1500)
    return pg

async def shot(pg, name, full=True):
    await pg.wait_for_timeout(700)
    await pg.screenshot(path=f"{OUT}/{name}.png", full_page=full)

async def member(p, w, h, tag):
    b = await p.chromium.launch(executable_path=CHROME)
    ctx = await ctx_for(b, w, h, w < 900)
    pg = await login(ctx, "demo02@pole2.test", "pole2test!")
    if "admin.html" in pg.url: await pg.goto(BASE + "/me.html"); await pg.wait_for_timeout(1500)
    for v in ["home", "worship", "lineup", "respond", "pray", "info"]:
        await pg.goto(BASE + "/me.html#" + v); await pg.wait_for_timeout(1500)
        await shot(pg, f"m{tag}_{v}")
    # 곡 상세 서랍 (찬양 › 콘티 첫 곡)
    await pg.goto(BASE + "/me.html#worship"); await pg.wait_for_timeout(1500)
    s = pg.locator("[data-song], .cv-song, .so, [data-sd]").first
    if await s.count():
        try: await s.click(timeout=2000); await shot(pg, f"m{tag}_songdetail", False)
        except Exception: pass
    await b.close()

async def admin(p, w, h, tag):
    b = await p.chromium.launch(executable_path=CHROME)
    ctx = await ctx_for(b, w, h, w < 900)
    pg = await login(ctx, "admin@x.com", "adminpass")
    if "admin.html" not in pg.url: await pg.goto(BASE + "/admin.html"); await pg.wait_for_timeout(1500)
    await shot(pg, f"a{tag}_dash")
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tests"))
    from h import navclick
    for key in ["attendance", "lineup", "conti", "members", "history"]:
        try:
            await navclick(pg, key); await pg.wait_for_timeout(1500)
            await shot(pg, f"a{tag}_{key}")
        except Exception as e: ERRS.append(f"nav {key}: {e}")
    await b.close()

async def share(p, w, h, tag):
    tok = q("select token from share_links where active limit 1")
    if not tok:
        q("insert into share_links(token,label) values ('Abc123Def456Ghi789Jkl0','자막팀')"); tok = "Abc123Def456Ghi789Jkl0"
    b = await p.chromium.launch(executable_path=CHROME)
    ctx = await ctx_for(b, w, h, w < 900)
    pg = await ctx.new_page(); pg.on("pageerror", lambda e: ERRS.append(f"share: {e}"))
    await pg.goto(BASE + "/share.html?t=" + tok); await pg.wait_for_timeout(2500)
    await shot(pg, f"s{tag}")
    await b.close()

async def main():
    async with async_playwright() as p:
        only = sys.argv[2] if len(sys.argv) > 2 else "msa"
        for w, h, tag in [(390, 844, "390"), (820, 1180, "820")]:
            if "m" in only: await member(p, w, h, tag)
            if "s" in only: await share(p, w, h, tag)
        if "a" in only:
            for w, h, tag in [(1280, 900, "1280"), (390, 844, "390"), (820, 1180, "820")]:
                await admin(p, w, h, tag)
    print("errors:", ERRS)
asyncio.run(main())
