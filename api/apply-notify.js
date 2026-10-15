// 새 지원서 알림 — 지원서 제출 직후 apply.html이 부름 (로그인 없음)
// 방금(10분 안) 들어온 지원서만, 한 번만 보냄
import { adminClient, handler, HttpError } from "./_lib.js";
import { settingOf, fill, deliver, admins, wasSent } from "./_notify.js";

export default handler(async (req, body) => {
  const id = String(body.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "잘못된 요청이에요.");
  const db = adminClient();
  const { data: a } = await db.from("applications").select("id, name, applied_position, created_at, positions:applied_position(name)").eq("id", id).maybeSingle();
  if (!a || Date.now() - new Date(a.created_at).getTime() > 10 * 60 * 1000) return { ok: true };
  const key = `apply:${a.id}`;
  if (await wasSent(db, key)) return { ok: true };
  const st = await settingOf(db, "apply");
  if (!st.enabled) return { ok: true };
  const vars = { "지원자": a.name, "포지션": a.positions?.name || a.applied_position };
  const lead = await admins(db);
  await deliver(db, { kind: "apply", sentKey: key, url: `/admin.html#app/${a.id}`, label: `리더십 ${lead.length}명`,
    items: lead.map((m) => ({ member_id: m.id, title: fill(st.title, { ...vars, "이름": m.name }), body: fill(st.body, { ...vars, "이름": m.name }) })) });
  return { ok: true };
});
