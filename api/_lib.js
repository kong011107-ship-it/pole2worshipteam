import { createClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";

// 서버 전용 클라이언트 (service_role 키 — Vercel 환경변수에만 존재)
export function adminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(500, "서버 환경변수(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)가 설정되지 않았습니다.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// 요청한 사람이 로그인한 관리자인지 확인
export async function requireAdmin(req, db) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "로그인이 필요합니다.");

  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) throw new HttpError(401, "로그인이 만료되었습니다. 다시 로그인해 주세요.");

  const { data: me } = await db.from("members").select("id, role, is_active").eq("id", user.id).maybeSingle();
  if (!me || me.role !== "admin" || !me.is_active) throw new HttpError(403, "관리자만 할 수 있습니다.");
  return user;
}

// 헷갈리는 글자(0/O, 1/l/I) 뺀 10자리 임시 비밀번호
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
export function tempPassword(len = 10) {
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

export function handler(fn) {
  return async (req, res) => {
    if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용됩니다." });
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const out = await fn(req, body);
      res.status(200).json(out);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      res.status(status).json({ error: e.status ? e.message : "서버 오류가 발생했습니다." });
    }
  };
}
