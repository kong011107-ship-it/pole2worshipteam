// POST /api/start-trainee
// { applicationId, mainPosition, startDate: "YYYY-MM-DD", result: "pass"|"pass_cond", condition }
// 면접 → 수습: 계정 생성(임시 비밀번호) + 수습생 등록
import { adminClient, requireAdmin, tempPassword, handler, HttpError } from "./_lib.js";

export default handler(async (req, body) => {
  const db = adminClient();
  await requireAdmin(req, db);

  const { applicationId, mainPosition, startDate, result, condition } = body;
  if (!applicationId) throw new HttpError(400, "지원자가 지정되지 않았습니다.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || "")) throw new HttpError(400, "수습 시작일을 정해 주세요.");
  if (!["pass", "pass_cond"].includes(result)) throw new HttpError(400, "면접 결과를 골라 주세요.");
  if (result === "pass_cond" && !String(condition || "").trim()) throw new HttpError(400, "조건부 수습의 조건을 적어 주세요.");

  const { data: app } = await db.from("applications")
    .select("id, name, email, stage, applied_position").eq("id", applicationId).maybeSingle();
  if (!app) throw new HttpError(404, "지원서를 찾을 수 없습니다.");
  if (app.stage !== "interview") throw new HttpError(409, "면접 단계의 지원자만 수습을 시작할 수 있습니다.");

  const password = tempPassword();
  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email: app.email, password, email_confirm: true, user_metadata: { name: app.name },
  });
  if (createErr) {
    const dup = /already|registered|exists/i.test(createErr.message);
    throw new HttpError(dup ? 409 : 400, dup
      ? `${app.email} 은(는) 이미 계정이 있는 이메일입니다. 멤버 화면에서 확인해 주세요.`
      : `계정을 만들지 못했습니다: ${createErr.message}`);
  }

  const { error: rpcErr } = await db.rpc("start_trainee", {
    p_application_id: app.id,
    p_user_id: created.user.id,
    p_main_position: mainPosition || app.applied_position,
    p_start: startDate,
    p_result: result,
    p_condition: result === "pass_cond" ? String(condition).trim() : null,
  });
  if (rpcErr) {
    await db.auth.admin.deleteUser(created.user.id);   // 되돌리기
    throw new HttpError(400, `수습 등록에 실패했습니다: ${rpcErr.message}`);
  }

  return { name: app.name, email: app.email, tempPassword: password };
});
