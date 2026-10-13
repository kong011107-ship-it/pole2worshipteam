// POST /api/remove-member  { memberId, reason, confirmName }
// 탈퇴 처리: 탈퇴 기록(이름·포지션·활동 기간·사유)만 남기고 계정과 개인정보를 삭제
//   남김: alumni 1행, 지난 배치표 칸(이름만)
//   삭제: 로그인 계정, 멤버 정보(연락처·이메일), 지원서·서약, 평가표, 수습 기록, 발송 기록, 섬김 응답, 출석
import { adminClient, requireAdmin, handler, HttpError } from "./_lib.js";

export default handler(async (req, body) => {
  const db = adminClient();
  const me = await requireAdmin(req, db);

  const { memberId, reason, confirmName } = body;
  if (!memberId) throw new HttpError(400, "멤버가 지정되지 않았습니다.");
  if (memberId === me.id) throw new HttpError(400, "본인 계정은 탈퇴 처리할 수 없습니다.");

  const { data: m } = await db.from("members").select("id, name, main_position, joined_at").eq("id", memberId).maybeSingle();
  if (!m) throw new HttpError(404, "멤버를 찾을 수 없습니다.");
  if (String(confirmName || "").trim() !== m.name) throw new HttpError(400, "확인용 이름이 맞지 않습니다.");

  // 1) 탈퇴 기록
  const { error: e1 } = await db.from("alumni").insert({
    name: m.name, main_position: m.main_position, joined_at: m.joined_at,
    reason: String(reason || "").trim().slice(0, 200) || null, created_by: me.id,
  });
  if (e1) throw new HttpError(500, "탈퇴 기록을 남기지 못했습니다.");

  // 2) 지난 배치표에 이름 보존
  await db.from("assignments").update({ former_name: m.name }).eq("member_id", m.id);

  // 3) 지원서(서약·평가·수습 기록·발송 기록 포함) 삭제
  const { error: e3 } = await db.from("applications").delete().eq("user_id", m.id);
  if (e3) throw new HttpError(500, "지원서를 삭제하지 못했습니다.");

  // 4) 계정 삭제 → 멤버 정보·응답·출석 함께 삭제, 배치 칸은 이름만 남음
  const { error: e4 } = await db.auth.admin.deleteUser(m.id);
  if (e4) throw new HttpError(500, `계정을 삭제하지 못했습니다: ${e4.message}`);

  return { name: m.name };
});
