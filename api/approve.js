// POST /api/approve  { applicationId, mainPosition }
// 신청서 승인 → 계정 생성(임시 비밀번호) → 멤버 등록
import { adminClient, requireAdmin, tempPassword, handler, HttpError } from "./_lib.js";

export default handler(async (req, body) => {
  const db = adminClient();
  await requireAdmin(req, db);

  const { applicationId, mainPosition } = body;
  if (!applicationId) throw new HttpError(400, "신청서가 지정되지 않았습니다.");

  const { data: app } = await db.from("applications")
    .select("id, name, email, status, applied_position")
    .eq("id", applicationId).maybeSingle();
  if (!app) throw new HttpError(404, "신청서를 찾을 수 없습니다.");
  if (app.status !== "pending") throw new HttpError(409, "이미 처리된 신청서입니다.");

  const password = tempPassword();
  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email: app.email,
    password,
    email_confirm: true,
    user_metadata: { name: app.name },
  });
  if (createErr) {
    const dup = /already|registered|exists/i.test(createErr.message);
    throw new HttpError(dup ? 409 : 400,
      dup ? `${app.email} 은(는) 이미 계정이 있는 이메일입니다.` : `계정을 만들지 못했습니다: ${createErr.message}`);
  }

  const { error: rpcErr } = await db.rpc("approve_application", {
    p_application_id: app.id,
    p_user_id: created.user.id,
    p_main_position: mainPosition || app.applied_position,
  });
  if (rpcErr) {
    // 멤버 등록이 실패하면 방금 만든 계정을 되돌림
    await db.auth.admin.deleteUser(created.user.id);
    throw new HttpError(400, `승인 처리에 실패했습니다: ${rpcErr.message}`);
  }

  return { name: app.name, email: app.email, tempPassword: password };
});
