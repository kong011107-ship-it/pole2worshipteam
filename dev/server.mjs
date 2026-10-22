// Local stand-in for Supabase (test only)
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const PORT = 8790, PGRST = "http://127.0.0.1:3001";
const SITE = "/home/claude/wp";
const SECRET = "local-test-secret-local-test-secret-123456";
const db = new pg.Pool({ host: "127.0.0.1", database: "wt", user: "postgres", password: "pgpw" });

const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
export function sign(payload) {
  const h = b64({ alg: "HS256", typ: "JWT" }), p = b64(payload);
  const s = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}
function verify(tok) {
  try {
    const [h, p, s] = tok.split(".");
    const exp = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
    if (exp !== s) return null;
    const o = JSON.parse(Buffer.from(p, "base64url").toString());
    if (o.exp && o.exp < Date.now() / 1000) return null;
    return o;
  } catch { return null; }
}
const now = () => Math.floor(Date.now() / 1000);
export const ANON = sign({ role: "anon", iss: "local", exp: now() + 86400 * 30 });
export const SERVICE = sign({ role: "service_role", iss: "local", exp: now() + 86400 * 30 });

const userObj = (u) => ({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email,
  email_confirmed_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
function session(u) {
  const exp = now() + 86400 * 30;   // 테스트에서 브라우저 시계를 앞당겨도 로그인이 유지되도록
  return { access_token: sign({ sub: u.id, role: "authenticated", aud: "authenticated", email: u.email, exp }),
    token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r." + u.id, user: userObj(u) };
}
const send = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(body === undefined ? "" : JSON.stringify(body)); };
const readBody = (req) => new Promise((ok) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => ok(d)); });
const bearer = (req) => (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

async function auth(req, res, url) {
  const body = req.method === "GET" || req.method === "DELETE" ? {} : JSON.parse((await readBody(req)) || "{}");
  const p = url.pathname.replace("/auth/v1", "");
  if (p === "/token") {
    const gt = url.searchParams.get("grant_type");
    let u;
    if (gt === "password") {
      u = (await db.query("select id, email from auth.users where lower(email)=lower($1) and password=$2", [body.email, body.password])).rows[0];
      if (!u) return send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials", code: "invalid_credentials" });
    } else if (gt === "refresh_token") {
      u = (await db.query("select id, email from auth.users where id=$1", [String(body.refresh_token).slice(2)])).rows[0];
      if (!u) return send(res, 400, { error: "invalid_grant" });
    }
    return send(res, 200, session(u));
  }
  if (p === "/logout") return send(res, 204);
  if (p === "/user") {
    const c = verify(bearer(req));
    if (!c?.sub) return send(res, 401, { message: "invalid JWT", code: "bad_jwt" });
    if (req.method === "PUT" && body.password) await db.query("update auth.users set password=$1 where id=$2", [body.password, c.sub]);
    const u = (await db.query("select id, email from auth.users where id=$1", [c.sub])).rows[0];
    return u ? send(res, 200, userObj(u)) : send(res, 404, { message: "User not found" });
  }
  if (p.startsWith("/admin/users")) {
    if (verify(bearer(req))?.role !== "service_role") return send(res, 403, { message: "forbidden" });
    const id = p.split("/")[3];
    if (req.method === "POST") {
      const dup = (await db.query("select 1 from auth.users where lower(email)=lower($1)", [body.email])).rowCount;
      if (dup) return send(res, 422, { code: "email_exists", message: "A user with this email address has already been registered" });
      const u = (await db.query("insert into auth.users(email, password) values ($1,$2) returning id, email", [body.email, body.password])).rows[0];
      return send(res, 200, userObj(u));
    }
    if (req.method === "PUT") {
      if (body.email) await db.query("update auth.users set email=$1 where id=$2", [body.email, id]);
      if (body.password) await db.query("update auth.users set password=$1 where id=$2", [body.password, id]);
      const u = (await db.query("select id, email from auth.users where id=$1", [id])).rows[0];
      return send(res, 200, userObj(u));
    }
    if (req.method === "DELETE") { await db.query("delete from auth.users where id=$1", [id]); return send(res, 200, {}); }
  }
  return send(res, 404, { message: "not implemented: " + p });
}

async function rest(req, res, url) {
  const body = ["GET", "HEAD"].includes(req.method) ? undefined : await readBody(req);
  const headers = {};
  for (const h of ["authorization", "content-type", "prefer", "accept", "range", "accept-profile", "content-profile"])
    if (req.headers[h]) headers[h] = req.headers[h];
  if (!headers.authorization) headers.authorization = "Bearer " + ANON;
  const r = await fetch(PGRST + url.pathname.replace("/rest/v1", "") + url.search, { method: req.method, headers, body });
  const out = Buffer.from(await r.arrayBuffer());
  const h = {}; r.headers.forEach((v, k) => { if (!["content-encoding", "transfer-encoding", "connection"].includes(k)) h[k] = v; });
  res.writeHead(r.status, h); res.end(out);
}


// ---------- Storage (021 · 022 테스트용): sheets 버킷 — 권한은 DB 함수(can_upload_object)로 확인 · PDF와 이미지
const STORE = "/home/claude/pgrst/storage";
async function asUser(claims, sql) {
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const r = await c.query(sql);
    await c.query("commit");
    return r.rows[0] ? Object.values(r.rows[0])[0] : null;
  } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
}
const readRaw = (req) => new Promise((ok) => { const b = []; req.on("data", (c) => b.push(c)); req.on("end", () => ok(Buffer.concat(b))); });
// 025: 서명된 주소 (공유 링크) — service_role만 만들고, 주소를 가진 누구나 받음
const signTok = (p, exp) => crypto.createHmac("sha256", SECRET).update(`sign:${p}:${exp}`).digest("base64url") + "." + exp;
async function signed(req, res, url) {
  const m = url.pathname.match(/^\/storage\/v1\/object\/sign\/sheets\/?(.*)$/);
  if (req.method === "POST") {
    if (verify(bearer(req))?.role !== "service_role") return send(res, 400, { statusCode: "403", error: "Unauthorized", message: "service role only" });
    const body = JSON.parse((await readRaw(req)).toString() || "{}"), exp = Math.floor(Date.now() / 1000) + (+body.expiresIn || 60);
    const one = (p) => ({ path: p, error: null, signedURL: `/object/sign/sheets/${p}?token=${signTok(p, exp)}` });
    if (m[1]) return send(res, 200, { signedURL: one(decodeURIComponent(m[1])).signedURL });
    return send(res, 200, (body.paths || []).map(one));
  }
  const rel = decodeURIComponent(m[1] || ""), tok = url.searchParams.get("token") || "", exp = +tok.split(".")[1] || 0;
  if (tok !== signTok(rel, exp) || exp < Date.now() / 1000) return send(res, 400, { statusCode: "403", error: "InvalidSignature", message: "invalid signature" });
  const f = path.join(STORE, "sheets", rel);
  if (!f.startsWith(path.join(STORE, "sheets") + "/") || !fs.existsSync(f)) return send(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
  res.writeHead(200, { "Content-Type": { ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" }[path.extname(f)] || "application/pdf" }); return res.end(fs.readFileSync(f));
}
async function storage(req, res, url) {
  if (url.pathname.startsWith("/storage/v1/object/sign/")) return signed(req, res, url);
  const claims = verify(bearer(req));
  if (!claims?.sub) return send(res, 400, { statusCode: "403", error: "Unauthorized", message: "로그인이 필요해요" });
  const m = url.pathname.match(/^\/storage\/v1\/object\/(?:authenticated\/)?([a-z-]+)\/?(.*)$/);
  if (!m) return send(res, 404, { message: "not found" });
  const [, bucket, rel] = m;
  if (bucket !== "sheets") return send(res, 400, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" });
  if (req.method === "POST" || req.method === "PUT") {
    const ok = await asUser(claims, `select public.can_upload_object('${rel.replace(/'/g, "")}')`);
    const body = await readRaw(req);
    if (!ok) return send(res, 400, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
    if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(req.headers["content-type"])) return send(res, 400, { statusCode: "415", error: "invalid_mime_type", message: "mime type not supported" });
    if (body.length > 31457280) return send(res, 400, { statusCode: "413", error: "Payload too large", message: "The object exceeded the maximum allowed size" });
    const f = path.join(STORE, bucket, rel);
    if (!f.startsWith(path.join(STORE, bucket) + "/")) return send(res, 400, { message: "bad path" });
    if (fs.existsSync(f) && req.headers["x-upsert"] !== "true") return send(res, 400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body);
    return send(res, 200, { Key: `${bucket}/${rel}`, Id: crypto.randomUUID() });
  }
  if (req.method === "GET") {
    const ok = await asUser(claims, "select public.is_member()");
    if (!ok) return send(res, 400, { statusCode: "403", error: "Unauthorized", message: "not allowed" });
    const f = path.join(STORE, bucket, rel);
    if (!f.startsWith(path.join(STORE, bucket) + "/") || !fs.existsSync(f)) return send(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
    res.writeHead(200, { "Content-Type": { ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" }[path.extname(f)] || "application/pdf" }); return res.end(fs.readFileSync(f));
  }
  if (req.method === "DELETE") {
    const ok = await asUser(claims, "select public.is_admin()");
    const body = JSON.parse((await readRaw(req)).toString() || "{}");
    if (!ok) return send(res, 200, []);
    const out = [];
    for (const p of body.prefixes || []) { const f = path.join(STORE, bucket, p); if (f.startsWith(path.join(STORE, bucket) + "/") && fs.existsSync(f)) { fs.unlinkSync(f); out.push({ name: p }); } }
    return send(res, 200, out);
  }
  return send(res, 405, {});
}

process.env.SUPABASE_URL = `http://localhost:${PORT}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE;
// 테스트 푸시: 실제 발송 대신 파일에 기록 (PUSH_SINK)
process.env.PUSH_SINK = "/home/claude/pgrst/push.log";
process.env.CRON_SECRET = "cron-test";
for (const l of (fs.existsSync("/home/claude/pgrst/vapid.env") ? fs.readFileSync("/home/claude/pgrst/vapid.env", "utf8").split("\n") : []))
  { const [k, ...v] = l.split("="); if (k) process.env[k] = v.join("="); }
async function api(req, res, url) {
  const name = url.pathname.replace("/api/", "");
  if (!/^[a-z-]+$/.test(name)) return send(res, 404, {});
  const f = path.join(SITE, "api", name + ".js");
  if (!fs.existsSync(f)) return send(res, 404, {});
  const mod = await import(f + "?t=" + fs.statSync(f).mtimeMs + "-" + fs.statSync(path.join(SITE, "api", "_lib.js")).mtimeMs);
  const raw = await readBody(req);
  req.body = raw ? JSON.parse(raw) : {};
  req.query = Object.fromEntries(url.searchParams);
  const r = { status(c) { this.c = c; return this; }, json(o) { send(res, this.c || 200, o); }, setHeader() {}, end(b) { res.writeHead(this.c || 200); res.end(b); } };
  await mod.default(req, r);
}

const MIME = { ".pdf": "application/pdf", ".mjs": "text/javascript", ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json" };
function stat(req, res, url) {
  if (url.pathname === "/assets/config.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    return res.end(`window.APP_CONFIG = { SUPABASE_URL: "http://localhost:${PORT}", SUPABASE_ANON_KEY: "${ANON}", TEAM_NAME: "폴투공동체 찬양팀" };`);
  }
  const f = path.join(SITE, decodeURIComponent(url.pathname === "/" ? "index.html" : url.pathname));
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}

http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "*");
  res.setHeader("Access-Control-Expose-Headers", "*");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith("/auth/v1")) return await auth(req, res, url);
    if (url.pathname.startsWith("/rest/v1")) return await rest(req, res, url);
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    if (url.pathname.startsWith("/storage/v1/")) return await storage(req, res, url);
    if (url.pathname.startsWith("/realtime")) { res.writeHead(404); return res.end(); }
    return stat(req, res, url);
  } catch (e) { console.error(e); send(res, 500, { error: String(e) }); }
}).listen(PORT, () => console.log("stack on", PORT));
