// POST /api/members-bulk  — 멤버 일괄 작업 (014). Vercel 함수 수를 아끼려고 한 파일에 모음
//  { action: "add", rows: [{ name, email, phone, gender, main_position, extra_positions, skill, small_group, status, cohort, birth_date, gift_join }], password? }
//      멤버 일괄 등록: 첫 로그인 때 비밀번호 변경을 강제
//      password가 있으면 모두 같은 임시 비밀번호(015), 없으면 사람마다 다르게
//      반환 { results: [{ ok, name, email, tempPassword } | { ok: false, name, email, error }], shared }
//  { action: "delete", ids, confirm: "삭제" }
//      멤버 완전 삭제 — 정식 운영 전 정리용. 탈퇴 기록(alumni)을 남기지 않아요. 지난 배치표 칸은 이름만 남김
//      운영 중에는 삭제 대신 '휴면'(로그인·응답·배치 대상에서 빠짐, 기록은 유지)을 써요
//  { action: "transfer-owner", to, password }   (015)
//      최상위 리더십 넘기기 — 지금 최상위 리더십만, 비밀번호를 다시 확인. 받는 사람은 리더십이 되고, 넘긴 사람은 일반 리더십으로
//  { action: "reset", confirm: "초기화" }   — 최상위 리더십만 (015)
//      초기화 — 관리자가 아닌 멤버(계정 포함)를 지우고 reset_team_data()로 일정·응답·출석·배치·객원·알림·지원 기록을 비움
//      남김: 관리자 계정과 그 정보, 설정, 안내 문구·서약서, 알림 설정
import { createClient } from "@supabase/supabase-js";
import { adminClient, requireAdmin, tempPassword, handler, HttpError, ownerId, sharedPasswordProblem } from "./_lib.js";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default handler(async (req, body) => {
  if (body.action === "add") return add(req, body);
  if (body.action === "delete") return del(req, body);
  if (body.action === "reset") return reset(req, body);
  if (body.action === "transfer-owner") return transferOwner(req, body);
  throw new HttpError(400, "알 수 없는 요청이에요.");
});

async function add(req, body) {
  const db = adminClient();
  await requireAdmin(req, db);
  const rows = [].concat(body.rows || []);
  if (!rows.length) throw new HttpError(400, "등록할 사람이 없어요.");
  if (rows.length > 100) throw new HttpError(400, "한 번에 100명까지 등록할 수 있어요.");
  const shared = body.password ? String(body.password) : null;
  if (shared) {
    const why = sharedPasswordProblem(shared, rows.map((r) => r.email));
    if (why) throw new HttpError(400, `임시 비밀번호: ${why}`);
  }

  const { data: pos } = await db.from("positions").select("code");
  const codes = new Set((pos || []).map((p) => p.code));
  const { data: existing } = await db.from("members").select("email");
  const taken = new Set((existing || []).map((m) => String(m.email || "").toLowerCase()));

  const results = [];
  for (const r of rows) {
    const name = String(r.name || "").trim(), email = String(r.email || "").trim().toLowerCase();
    const fail = (error) => results.push({ ok: false, name, email, error });
    const phone = String(r.phone || "").replace(/[^0-9-]/g, "") || null;
    const extras = [...new Set([].concat(r.extra_positions || []))].filter((c) => c !== r.main_position);
    if (!name || name.length > 30) { fail("이름을 확인해 주세요"); continue; }
    if (!EMAIL.test(email)) { fail("이메일 형식이 아니에요"); continue; }
    if (taken.has(email)) { fail("이미 등록된 이메일이에요"); continue; }
    if (!codes.has(r.main_position)) { fail("주 포지션을 확인해 주세요"); continue; }
    if (extras.some((c) => !codes.has(c))) { fail("추가 포지션을 확인해 주세요"); continue; }
    if (r.gender && !["m", "f"].includes(r.gender)) { fail("성별은 남/여로 적어 주세요"); continue; }
    if (r.skill && ![1, 2, 3].includes(+r.skill)) { fail("숙련도는 상/중/하로 적어 주세요"); continue; }
    const cohort = r.cohort === null || r.cohort === undefined || r.cohort === "" ? null : +r.cohort;
    if (cohort !== null && !(Number.isInteger(cohort) && cohort >= 1 && cohort <= 200)) { fail("기수를 확인해 주세요"); continue; }
    const birth = r.birth_date || null;
    if (birth && !(/^\d{4}-\d{2}-\d{2}$/.test(birth) && birth >= "1940-01-01" && birth <= "2020-12-31" && !isNaN(Date.parse(birth)))) { fail("생년월일을 확인해 주세요"); continue; }
    const gift = r.gift_join === true || r.gift_join === false ? r.gift_join : null;

    const password = shared || tempPassword();
    const { data: created, error: e1 } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
    if (e1) { fail(/already|registered|exists/i.test(e1.message) ? "이미 계정이 있는 이메일이에요" : "계정을 만들지 못했어요"); continue; }
    const id = created.user.id;
    const { error: e2 } = await db.from("members").insert({
      id, name, email, phone, gender: r.gender || null, main_position: r.main_position,
      status: r.status === "trainee" ? "trainee" : "active", must_change_password: true,
      small_group: String(r.small_group || "").trim().slice(0, 30) || null,
      cohort, birth_date: birth, gift_join: gift,
    });
    if (e2) { await db.auth.admin.deleteUser(id); fail("멤버 정보를 저장하지 못했어요: " + e2.message); continue; }
    if (extras.length) await db.from("member_extra_positions").insert(extras.map((c) => ({ member_id: id, position_code: c })));
    if (r.skill) await db.from("member_skills").upsert({ member_id: id, position_code: r.main_position, level: +r.skill });
    taken.add(email);
    results.push({ ok: true, id, name, email, tempPassword: password });
  }
  return { results, shared: !!shared };
}

async function del(req, body) {
  const db = adminClient();
  const me = await requireAdmin(req, db);
  if (body.confirm !== "삭제") throw new HttpError(400, "확인 문구가 맞지 않아요.");
  const oid = await ownerId(db);
  const ids = [...new Set([].concat(body.ids || []))].filter((id) => id !== me.id);
  if (oid && ids.includes(oid)) throw new HttpError(403, "최상위 리더십 계정은 지울 수 없어요.");
  if (!ids.length) throw new HttpError(400, "삭제할 멤버를 골라 주세요. (본인 계정은 지울 수 없어요)");
  if (ids.length > 200) throw new HttpError(400, "한 번에 200명까지 지울 수 있어요.");

  const { data: ms } = await db.from("members").select("id, name").in("id", ids);
  const removed = [], failed = [];
  for (const m of ms || []) {
    await db.from("assignments").update({ former_name: m.name }).eq("member_id", m.id);
    await db.from("applications").delete().eq("user_id", m.id);
    const { error } = await db.auth.admin.deleteUser(m.id);
    if (error) failed.push(m.name); else removed.push(m.name);
  }
  return { removed: removed.length, failed };
}

async function reset(req, body) {
  const db = adminClient();
  const user = await requireAdmin(req, db);
  const oid = await ownerId(db);
  if (oid && user.id !== oid) throw new HttpError(403, "초기화는 최상위 리더십만 할 수 있어요.");
  if (body.confirm !== "초기화") throw new HttpError(400, "확인 문구가 맞지 않아요.");

  const { data: ms } = await db.from("members").select("id, role");
  const others = (ms || []).filter((m) => m.role !== "admin");
  let failed = 0;
  for (const m of others) {
    await db.from("applications").delete().eq("user_id", m.id);
    const { error } = await db.auth.admin.deleteUser(m.id);
    if (error) failed++;
  }
  const { error } = await db.rpc("reset_team_data");
  if (error) throw new HttpError(500, "데이터를 비우지 못했어요: " + error.message);
  return { removedMembers: others.length - failed, failed, keptAdmins: (ms || []).length - others.length };
}

async function transferOwner(req, body) {
  const db = adminClient();
  const user = await requireAdmin(req, db);
  const oid = await ownerId(db);
  if (oid !== user.id) throw new HttpError(403, "최상위 리더십만 넘길 수 있어요.");
  if (!body.to || body.to === user.id) throw new HttpError(400, "넘길 사람을 골라 주세요.");
  const { data: to } = await db.from("members").select("id, name, role, status, is_active").eq("id", body.to).maybeSingle();
  if (!to || !to.is_active || to.status !== "active") throw new HttpError(400, "활동 중인 정식 팀원에게만 넘길 수 있어요.");
  // 비밀번호 다시 확인 (저장하지 않는 별도 연결)
  const check = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: pe } = await check.auth.signInWithPassword({ email: user.email, password: String(body.password || "") });
  if (pe) throw new HttpError(400, "비밀번호가 맞지 않아요.");
  const { error: e1 } = await db.from("members").update({ is_owner: false }).eq("id", user.id);
  if (e1) throw new HttpError(500, "넘기지 못했어요: " + e1.message);
  const { error: e2 } = await db.from("members").update({ role: "admin", is_owner: true }).eq("id", to.id);
  if (e2) {
    await db.from("members").update({ is_owner: true }).eq("id", user.id);   // 되돌리기
    throw new HttpError(500, "넘기지 못했어요: " + e2.message);
  }
  return { name: to.name };
}
