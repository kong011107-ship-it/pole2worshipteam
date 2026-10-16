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

// 로그인한 팀원(수습 포함) 확인 → { user, me }
export async function requireMember(req, db) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "로그인이 필요합니다.");
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) throw new HttpError(401, "로그인이 만료되었습니다. 다시 로그인해 주세요.");
  const { data: me } = await db.from("members").select("id, name, role, status, is_active, is_owner").eq("id", user.id).maybeSingle();
  if (!me || !me.is_active) throw new HttpError(403, "활동 중인 팀원만 할 수 있습니다.");
  return { user, me };
}

// 최상위 리더십 계정 보호 (015): 본인이 아니면 휴면·탈퇴·비밀번호·이메일·삭제 불가
export async function ownerId(db) {
  const { data } = await db.from("members").select("id").eq("is_owner", true).maybeSingle();
  return data?.id || null;
}
export async function guardOwner(db, targetId, callerId, what = "바꿀") {
  const oid = await ownerId(db);
  if (oid && targetId === oid && callerId !== oid) throw new HttpError(403, `최상위 리더십 계정은 본인만 ${what} 수 있어요.`);
  return oid;
}

// 함께 쓰는 임시 비밀번호 검사 (일괄 등록, 015). 문제가 없으면 null
const WEAK = ["12345678", "123456789", "1234567890", "password", "password1", "qwerty12", "qwer1234", "abcd1234", "a1234567", "pole21234", "pole2pole2", "worship1"];
export function sharedPasswordProblem(pw, emails = []) {
  pw = String(pw || "");
  if (pw.length < 8) return "8자 이상으로 정해 주세요";
  if (pw.length > 40) return "40자 이하로 정해 주세요";
  if (/\s/.test(pw)) return "띄어쓰기 없이 정해 주세요";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "영문과 숫자를 섞어 주세요";
  const low = pw.toLowerCase();
  if (WEAK.includes(low) || /^(.)\1+$/.test(pw)) return "너무 쉬운 비밀번호예요";
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|qwer)/.test(low) && low.replace(/[^a-z]/g, "").length <= 4) return "너무 쉬운 비밀번호예요";
  const hit = emails.map((e) => String(e || "").split("@")[0].toLowerCase()).find((u) => u.length >= 3 && low.includes(u));
  if (hit) return "이메일 아이디가 들어간 비밀번호는 쓸 수 없어요";
  return null;
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
