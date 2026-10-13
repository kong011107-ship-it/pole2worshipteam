// POST /api/demo  { action: "status" | "seed" | "clear" }
// 리더십 테스트용 더미 데이터. 모두 이메일 @pole2.test, 이름 끝 (T)로 표시돼요.
// "clear"는 이 표시가 있는 데이터만 지웁니다. 실제 팀원 데이터는 건드리지 않아요.
import { adminClient, requireAdmin, handler, HttpError } from "./_lib.js";

const DOMAIN = "@pole2.test";
const PASSWORD = "pole2test!";

// ---------- 날짜 (한국 시간) ----------
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = (iso) => new Date(iso + "T00:00:00Z").getUTCDay();
const nextSat = (iso) => addDays(iso, ((6 - dow(iso) + 7) % 7) || 7);
const monthStart = (iso) => iso.slice(0, 8) + "01";
const nextMonth = (iso) => { const [y, m] = iso.split("-").map(Number); return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); };
const sundaysOf = (mon) => { const out = []; let d = mon; while (dow(d) !== 0) d = addDays(d, 1); while (d.slice(0, 7) === mon.slice(0, 7)) { out.push(d); d = addDays(d, 7); } return out; };
const monthsAgo = (n) => { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toISOString(); };

const MEMBERS = [
  // 이름, 주 포지션, 추가 포지션, 다음 달 응답 패턴(토·주 × 주차: y 가능 / n 불가 / - 미응답)
  ["정사랑(T)", "leader", ["singer"], "yyyyyyyyyy"],
  ["김하늘(T)", "singer", [], "yyyyyynyyy"],
  ["이소망(T)", "singer", [], "yyyyyyyyyy"],
  ["박은혜(T)", "singer", [], "nnyyyyyyyy"],
  ["최다윗(T)", "singer", ["key_second"], "yyyynyyyyy"],
  ["한믿음(T)", "key_main", [], "yyyyyyyynn"],
  ["윤기쁨(T)", "key_second", ["key_main"], "yyyyyyyyyy"],
  ["오평강(T)", "e_guitar", [], "----------"],
  ["강온유(T)", "bass", [], "yyyyyyyyyy"],
  ["서충성(T)", "drum", [], "yy--------"],
  ["임소금(T)", "drum", [], "yyyyyyyyyy"],
];

async function demoIds(db) {
  const { data: ms } = await db.from("members").select("id, name, email").ilike("email", `%${DOMAIN}`);
  const { data: as } = await db.from("applications").select("id, user_id").ilike("email", `%${DOMAIN}`);
  return { members: ms || [], apps: as || [] };
}

async function clear(db) {
  const { members, apps } = await demoIds(db);
  const memberIds = members.map((m) => m.id);
  const userIds = [...new Set([...memberIds, ...apps.map((a) => a.user_id).filter(Boolean)])];
  // 테스트 멤버의 배치(테스트 중 탈퇴 처리된 (T) 칸 포함)는 남기지 않고 지움, 비게 된 주일도 정리
  const sids = new Set();
  if (memberIds.length) {
    const { data: as } = await db.from("assignments").select("service_id").in("member_id", memberIds);
    (as || []).forEach((x) => sids.add(x.service_id));
    await db.from("assignments").delete().in("member_id", memberIds);
  }
  const { data: gone } = await db.from("assignments").select("service_id").is("member_id", null).like("former_name", "%(T)");
  (gone || []).forEach((x) => sids.add(x.service_id));
  await db.from("assignments").delete().is("member_id", null).like("former_name", "%(T)");
  for (const sid of sids) {
    const { count } = await db.from("assignments").select("id", { count: "exact", head: true }).eq("service_id", sid);
    if (!count) await db.from("services").delete().eq("id", sid);
  }
  if (apps.length) await db.from("applications").delete().in("id", apps.map((a) => a.id));
  for (const id of userIds) await db.auth.admin.deleteUser(id);
  await db.from("alumni").delete().like("name", "%(T)");
  return { removedMembers: userIds.length, removedApplications: apps.length };
}

async function createUser(db, email, name) {
  const { data, error } = await db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { name } });
  if (error) throw new HttpError(400, `테스트 계정을 만들지 못했습니다 (${email}): ${error.message}`);
  return data.user.id;
}

async function seed(db, me) {
  const existing = await demoIds(db);
  if (existing.members.length || existing.apps.length) throw new HttpError(409, "이미 테스트 데이터가 있어요. 지운 뒤 다시 만들어 주세요.");
  const t = today();

  // ---------- 1. 정식 팀원 11명 + 휴면 1명 ----------
  const ids = {};
  let n = 0;
  for (const [name, pos, extra] of MEMBERS) {
    const email = `demo${String(++n).padStart(2, "0")}${DOMAIN}`;
    const id = await createUser(db, email, name);
    ids[name] = id;
    const { error } = await db.from("members").insert({
      id, name, email, phone: "010-0000-00" + String(n).padStart(2, "0"), main_position: pos,
      status: "active", must_change_password: false, joined_at: addDays(t, -200 + n * 7),
    });
    if (error) throw new HttpError(500, "테스트 팀원을 만들지 못했습니다: " + error.message);
    for (const e of extra) await db.from("member_extra_positions").insert({ member_id: id, position_code: e });
  }
  const restId = await createUser(db, `demo12${DOMAIN}`, "조인내(T)");
  await db.from("members").insert({ id: restId, name: "조인내(T)", email: `demo12${DOMAIN}`, main_position: "singer", status: "active", is_active: false, must_change_password: false });

  // ---------- 2. 지원자 (모집 중인 포지션으로) ----------
  const { data: ps } = await db.from("positions").select("code, is_recruiting").order("sort_order");
  const recruiting = (ps || []).filter((p) => p.is_recruiting).map((p) => p.code);
  const pick = (want) => (recruiting.includes(want) ? want : recruiting[0]);
  const { data: pledge } = await db.from("pledge_versions").select("id").eq("is_active", true).maybeSingle();
  const apps = {};
  if (recruiting.length && pledge) {
    const mk = async (key, name, pos, motivation) => {
      const email = `${key}${DOMAIN}`;
      const { data, error } = await db.from("applications").insert({
        name, phone: "010-1111-2222", email, applied_position: pick(pos), small_group: "3순",
        motivation, goal: "팀과 함께 예배를 세워가고 싶어요", privacy_agreed: true, q_practice: true, q_sunday: true, q_group: true,
      }).select("id").single();
      if (error) throw new HttpError(500, "테스트 지원서를 만들지 못했습니다: " + error.message);
      apps[key] = { id: data.id, email, name };
      return data.id;
    };
    const log = (appId, code, at) => db.from("message_log").insert({ application_id: appId, template_code: code, sent_by: me.id, ...(at ? { sent_at: at } : {}) });

    await mk("apply1", "신지혜(T)", "singer", "고등부 때부터 찬양팀을 섬겼어요");
    const a2 = await mk("apply2", "문빛나(T)", "bass", "베이스로 예배를 돕고 싶어요"); await log(a2, "1");

    const a3 = await mk("interview1", "배하람(T)", "e_guitar", "일렉기타 3년 했어요");
    await log(a3, "1"); await log(a3, "2");
    await db.rpc("demo_set_stage", { p_id: a3, p_stage: "interview", p_interview_at: `${nextSat(t)}T19:00:00+09:00`, p_place: "본당 2층" });

    // 수습 3주차 (2주 전 토요일 시작)
    const a4 = await mk("trainee1", "노새벽(T)", "singer", "예배 인도를 배우고 싶어요");
    await log(a4, "1"); await log(a4, "2");
    await db.rpc("demo_set_stage", { p_id: a4, p_stage: "interview", p_interview_at: `${addDays(nextSat(t), -28)}T19:00:00+09:00`, p_place: "본당 2층" });
    const traineeId = await createUser(db, `trainee1${DOMAIN}`, "노새벽(T)");
    const start = addDays(nextSat(t), -21);
    const { error: te } = await db.rpc("start_trainee", { p_application_id: a4, p_user_id: traineeId, p_main_position: pick("singer"), p_start: start, p_result: "pass_cond", p_condition: "합주 시 타 파트 청취 보완" });
    if (te) throw new HttpError(500, "테스트 수습생을 만들지 못했습니다: " + te.message);
    await db.from("members").update({ must_change_password: false }).eq("id", traineeId);
    await log(a4, "4");
    await db.from("trainee_weeks").update({ leader_id: me.id, sat_attended: true, sun_attended: true, updated_by: me.id,
      note: "첫 주라 긴장했지만 세팅 동선을 빠르게 익힘\n팀원 이름을 먼저 외워서 인사함\n다음 주엔 리허설 흐름을 같이 보기로" }).eq("application_id", a4).eq("week", 1);
    await db.from("trainee_weeks").update({ leader_id: me.id, sat_attended: true, sun_attended: false, updated_by: me.id,
      note: "리허설에서 싱어 동선 확인\n주일 9시는 가족 일정으로 불참 (사전 연락)\n3주차 봉헌송 키 미리 공유함" }).eq("application_id", a4).eq("week", 2);

    // 종료: 4개월 전 미선발(일괄 삭제 대상), 1개월 전 보류
    const a5 = await mk("closed1", "구은총(T)", "drum", "드럼 독학 중이에요");
    await db.rpc("demo_set_stage", { p_id: a5, p_stage: "closed", p_reason: "not_selected", p_changed_at: monthsAgo(4) });
    const a6 = await mk("closed2", "홍겸손(T)", "singer", "노래를 좋아해요");
    await db.rpc("demo_set_stage", { p_id: a6, p_stage: "closed", p_reason: "hold", p_changed_at: monthsAgo(1) });

    // 재가입 테스트: 탈퇴 기록 + 같은 이름 지원자(면담 단계)
    await db.from("alumni").insert({ name: "장요셉(T)", main_position: "singer", joined_at: "2025-03-01", left_at: "2026-06-30", reason: "졸업·파송", created_by: me.id });
    const a7 = await mk("rejoin1", "장요셉(T)", "singer", "다시 함께하고 싶어요");
    await db.rpc("demo_set_stage", { p_id: a7, p_stage: "interview", p_interview_at: `${nextSat(t)}T18:00:00+09:00`, p_place: "카페" });
  }

  // ---------- 3. 다음 달 섬김 응답 (열어 두고 팀원들이 응답한 상태) ----------
  const nm = nextMonth(t);
  const { data: mo } = await db.from("availability_months").select("month").eq("month", nm).maybeSingle();
  if (!mo) await db.from("availability_months").insert({ month: nm, deadline: addDays(sundaysOf(nm)[0], -2), is_open: true });
  const slots = sundaysOf(nm).flatMap((sun) => [[addDays(sun, -1), "sat_practice"], [sun, "sunday"]]);
  const rows = [];
  MEMBERS.forEach(([name, , , pat]) => slots.forEach(([date, kind], i) => {
    const c = pat[i % pat.length];
    if (c !== "-") rows.push({ member_id: ids[name], date, kind, available: c === "y" });
  }));
  await db.from("availability").upsert(rows);
  await db.from("availability_notes").upsert({ member_id: ids["김하늘(T)"], month: nm, note: "셋째 주는 오후만 가능해요" });

  // ---------- 4. 이번 달 남은 주일 배치표 (공개) ----------
  const LINEUPS = [
    { leader: "정사랑(T)", singers: ["김하늘(T)", "이소망(T)", "박은혜(T)"], sl: "김하늘(T)", key_main: "한믿음(T)", key_second: "윤기쁨(T)", e_guitar: "오평강(T)", bass: "강온유(T)", drum: "서충성(T)", bm: "한믿음(T)" },
    { leader: "정사랑(T)", singers: ["이소망(T)", "최다윗(T)"], sl: "이소망(T)", key_main: "윤기쁨(T)", e_guitar: "오평강(T)", bass: "강온유(T)", drum: "임소금(T)", bm: "강온유(T)" },
  ];
  const upcoming = sundaysOf(monthStart(t)).filter((d) => d >= t);
  let lineupCount = 0;
  for (let i = 0; i < upcoming.length; i++) {
    const d = upcoming[i], L = LINEUPS[i % LINEUPS.length];
    let { data: s } = await db.from("services").select("id, assignments(id)").eq("service_date", d).maybeSingle();
    if (s && s.assignments?.length) continue;   // 실제 배치가 있으면 건드리지 않음
    if (!s) ({ data: s } = await db.from("services").insert({ service_date: d }).select("id").single());
    const put = (pos, slot, name, flags = {}) => db.from("assignments").insert({ service_id: s.id, position_code: pos, slot, member_id: ids[name], ...flags });
    await put("leader", 1, L.leader);
    for (let k = 0; k < L.singers.length; k++) await put("singer", k + 1, L.singers[k], { is_singer_leader: L.singers[k] === L.sl });
    for (const pos of ["key_main", "key_second", "e_guitar", "bass", "drum"]) if (L[pos]) await put(pos, 1, L[pos], { is_band_master: L[pos] === L.bm });
    await db.from("services").update({ status: "published", published_at: new Date().toISOString() }).eq("id", s.id);
    lineupCount++;
  }

  return {
    members: MEMBERS.length + 1, applicants: Object.keys(apps).length, lineups: lineupCount, respondMonth: nm,
    password: PASSWORD, memberEmail: `demo02${DOMAIN}`, traineeEmail: apps.trainee1 ? `trainee1${DOMAIN}` : null,
  };
}

export default handler(async (req, body) => {
  const db = adminClient();
  const me = await requireAdmin(req, db);
  if (body.action === "status") {
    const { members, apps } = await demoIds(db);
    return { members: members.length, applications: apps.length, password: PASSWORD };
  }
  if (body.action === "seed") return await seed(db, me);
  if (body.action === "clear") return await clear(db);
  throw new HttpError(400, "알 수 없는 요청입니다.");
});
