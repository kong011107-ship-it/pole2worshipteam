// POST /api/update-email  { memberId, email }
// 멤버의 로그인 이메일(아이디)을 바꿈: 로그인 계정 + members.email 함께
import { adminClient, requireAdmin, handler, HttpError, guardOwner } from "./_lib.js";

export default handler(async (req, body) => {
  const db = adminClient();
  const user = await requireAdmin(req, db);
  const email = String(body.email || "").trim().toLowerCase();
  if (!body.memberId) throw new HttpError(400, "멤버를 찾을 수 없습니다.");
  await guardOwner(db, body.memberId, user.id, "로그인 이메일을 바꿀");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "이메일 주소를 다시 확인해 주세요.");

  const { data: m } = await db.from("members").select("id, email").eq("id", body.memberId).maybeSingle();
  if (!m) throw new HttpError(404, "멤버를 찾을 수 없습니다.");
  if ((m.email || "").toLowerCase() === email) return { email };

  const { data: dup } = await db.from("members").select("id").ilike("email", email).neq("id", m.id).maybeSingle();
  if (dup) throw new HttpError(409, "이미 다른 멤버가 쓰는 이메일이에요.");

  const { error } = await db.auth.admin.updateUserById(m.id, { email, email_confirm: true });
  if (error) throw new HttpError(400, /already|exists|registered/i.test(error.message) ? "이미 가입된 이메일이에요." : "로그인 이메일을 바꾸지 못했습니다: " + error.message);

  const { error: e2 } = await db.from("members").update({ email }).eq("id", m.id);
  if (e2) {
    await db.auth.admin.updateUserById(m.id, { email: m.email, email_confirm: true });   // 되돌리기
    throw new HttpError(500, "멤버 정보를 저장하지 못했습니다.");
  }
  return { email };
});
