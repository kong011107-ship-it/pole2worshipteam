// POST /api/reset-password  { memberId }
// 비밀번호를 잊은 멤버에게 새 임시 비밀번호 발급 (다음 로그인 때 변경 강제)
import { adminClient, requireAdmin, tempPassword, handler, HttpError, guardOwner } from "./_lib.js";

export default handler(async (req, body) => {
  const db = adminClient();
  const user = await requireAdmin(req, db);

  const { memberId } = body;
  if (!memberId) throw new HttpError(400, "멤버가 지정되지 않았습니다.");
  await guardOwner(db, memberId, user.id, "비밀번호를 바꿀");

  const { data: m } = await db.from("members").select("id, name, email").eq("id", memberId).maybeSingle();
  if (!m) throw new HttpError(404, "멤버를 찾을 수 없습니다.");

  const password = tempPassword();
  const { error } = await db.auth.admin.updateUserById(m.id, { password });
  if (error) throw new HttpError(400, `비밀번호를 바꾸지 못했습니다: ${error.message}`);

  await db.from("members").update({ must_change_password: true }).eq("id", m.id);
  return { name: m.name, email: m.email, tempPassword: password };
});
