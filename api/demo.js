// POST /api/demo  { action: "status" | "seed" | "clear" }
// 리더십 테스트용 더미 데이터. 모두 이메일 @pole2.test, 이름 끝 (T)로 표시돼요.
// "clear"는 이 표시가 있는 데이터만 지웁니다. 실제 팀원 데이터는 건드리지 않아요.
import { adminClient, requireAdmin, handler, HttpError } from "./_lib.js";

const DOMAIN = "@pole2.test";
const PASSWORD = "pole2test!";
const MEETING_NOTE = "(T) 테스트 데이터";

// ---------- 날짜 (한국 시간) ----------
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = (iso) => new Date(iso + "T00:00:00Z").getUTCDay();
const nextSat = (iso) => addDays(iso, ((6 - dow(iso) + 7) % 7) || 7);
const lastSat = (iso) => addDays(iso, -((dow(iso) + 1) % 7));
const monthStart = (iso) => iso.slice(0, 8) + "01";
const nextMonth = (iso) => { const [y, m] = iso.split("-").map(Number); return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); };
const sundaysOf = (mon) => { const out = []; let d = mon; while (dow(d) !== 0) d = addDays(d, 1); while (d.slice(0, 7) === mon.slice(0, 7)) { out.push(d); d = addDays(d, 7); } return out; };
const monthsAgo = (n) => { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toISOString(); };

const MEMBERS = [
  // 이름, 주 포지션, 추가 포지션, 다음 달 응답 패턴(토·주 × 주차: y 가능 / n 불가 / - 미응답), 숙련도(주 포지션 3 상 · 2 중 · 1 하), 성별
  ["정사랑(T)", "leader", ["singer"], "yyyyyyyyyy", 3, "m"],
  ["김하늘(T)", "singer", [], "yyyyyynyyy", 3, "f"],
  ["이소망(T)", "singer", [], "yyyyyyyyyy", 2, "f"],
  ["박은혜(T)", "singer", [], "nnyyyyyyyy", 1, "f"],
  ["최다윗(T)", "singer", ["key_second"], "yyyynyyyyy", 2, "m"],
  ["한믿음(T)", "key_main", [], "yyyyyyyynn", 3, "m"],
  ["윤기쁨(T)", "key_second", ["key_main"], "yyyyyyyyyy", 2, "f"],
  ["오평강(T)", "e_guitar", [], "----------", 2, "m"],
  ["강온유(T)", "bass", [], "yyyyyyyyyy", 3, "f"],
  ["서충성(T)", "drum", [], "yy--------", 1, "m"],
  ["임소금(T)", "drum", [], "yyyyyyyyyy", 3, "f"],
];

// 지난 토요일 팀모임 출석 패턴 (최근 주가 맨 오른쪽). p 출석 / l 지각 / a 결석 / - 미기록
// 8주 중 뒤에서 네 번째 주는 팀모임 없음(x)
const MEETING_PATTERN = {
  "서충성(T)": "ppaaxaaa",   // 팀모임 연속 결석 5회 → 대시보드 경고
  "박은혜(T)": "ppppxaaa",   // 3회
  "최다윗(T)": "ppapxpap",
};
// 결석 사유 (사람별로 돌려 씀): [칩, 직접 입력]
const REASONS = {
  "서충성(T)": [["직장", "토요 근무"], ["직장", null]],
  "박은혜(T)": [["가족 일정", "부모님 생신"], ["건강", null], ["가족 일정", null]],
  "최다윗(T)": [["학업·시험", "중간고사"], [null, "본가 방문"]],
};
// 지각 (최근 4주, 배치된 주만 기록됨): 연습 / 주일 리허설
const LATE = { "오평강(T)": 2, "강온유(T)": 1 };
const REHEARSAL_LATE = { "이소망(T)": 2 };

async function demoIds(db) {
  const { data: ms } = await db.from("members").select("id, name, email").ilike("email", `%${DOMAIN}`);
  const { data: as } = await db.from("applications").select("id, user_id").ilike("email", `%${DOMAIN}`);
  return { members: ms || [], apps: as || [] };
}

async function clear(db) {
  const { members, apps } = await demoIds(db);
  const memberIds = members.map((m) => m.id);
  const userIds = [...new Set([...memberIds, ...apps.map((a) => a.user_id).filter(Boolean)])];
  // 테스트 사역·객원 (예배·응답·배치는 사역과 함께 지워짐)
  await db.from("ministries").delete().like("name", "%(T)");
  const { data: gs } = await db.from("guests").select("id").like("name", "%(T)");
  const gids = (gs || []).map((g) => g.id);
  // 테스트 멤버·객원의 배치(테스트 중 탈퇴 처리된 (T) 칸 포함)는 남기지 않고 지움, 비게 된 주일도 정리
  const sids = new Set();
  if (memberIds.length) {
    const { data: as } = await db.from("assignments").select("service_id").in("member_id", memberIds);
    (as || []).forEach((x) => sids.add(x.service_id));
    await db.from("assignments").delete().in("member_id", memberIds);
  }
  if (gids.length) {
    const { data: as } = await db.from("assignments").select("service_id").in("guest_id", gids);
    (as || []).forEach((x) => sids.add(x.service_id));
    await db.from("assignments").delete().in("guest_id", gids);
    await db.from("guests").delete().in("id", gids);
  }
  const { data: gone } = await db.from("assignments").select("service_id").is("member_id", null).like("former_name", "%(T)");
  (gone || []).forEach((x) => sids.add(x.service_id));
  await db.from("assignments").delete().is("member_id", null).like("former_name", "%(T)");
  for (const sid of sids) {
    const { count } = await db.from("assignments").select("id", { count: "exact", head: true }).eq("service_id", sid);
    if (!count) await db.from("services").delete().eq("id", sid).is("start_time", null);
  }
  if (apps.length) await db.from("applications").delete().in("id", apps.map((a) => a.id));
  for (const id of userIds) await db.auth.admin.deleteUser(id);   // 출석·숙련도 기록은 멤버와 함께 지워짐
  await db.from("alumni").delete().like("name", "%(T)");
  // 테스트로 만든 토요일: 실제 기록이 없으면 지우고, 있으면 표시만 지움
  const { data: tms } = await db.from("team_meetings").select("id, attendance(member_id)").eq("note", MEETING_NOTE);
  for (const t of tms || []) {
    if (t.attendance?.length) await db.from("team_meetings").update({ note: null }).eq("id", t.id);
    else await db.from("team_meetings").delete().eq("id", t.id);
  }
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
  for (const [name, pos, extra, , level, gender] of MEMBERS) {
    const email = `demo${String(++n).padStart(2, "0")}${DOMAIN}`;
    const id = await createUser(db, email, name);
    ids[name] = id;
    const { error } = await db.from("members").insert({
      id, name, email, phone: "010-0000-00" + String(n).padStart(2, "0"), main_position: pos, gender,
      status: "active", must_change_password: false, joined_at: addDays(t, -200 + n * 7),
      small_group: `${(n % 5) + 1}순`, served_since: addDays(t, -900 + n * 60),
    });
    if (error) throw new HttpError(500, "테스트 팀원을 만들지 못했습니다: " + error.message);
    for (const e of extra) await db.from("member_extra_positions").insert({ member_id: id, position_code: e });
    await db.from("member_skills").insert([{ member_id: id, position_code: pos, level }, ...extra.map((e) => ({ member_id: id, position_code: e, level: Math.max(1, level - 1) }))]);
  }
  const restId = await createUser(db, `demo12${DOMAIN}`, "조인내(T)");
  await db.from("members").insert({ id: restId, name: "조인내(T)", email: `demo12${DOMAIN}`, main_position: "singer", gender: "f", status: "active", is_active: false, must_change_password: false });
  await db.from("guests").insert({ name: "홍객원(T)", positions: ["drum", "bass"], note: "다른 공동체 드러머" });

  // ---------- 2. 지원자 (모집 중인 포지션으로) ----------
  const { data: ps } = await db.from("positions").select("code, is_recruiting").order("sort_order");
  const recruiting = (ps || []).filter((p) => p.is_recruiting).map((p) => p.code);
  const pick = (want) => (recruiting.includes(want) ? want : recruiting[0]);
  const { data: pledge } = await db.from("pledge_versions").select("id").eq("is_active", true).maybeSingle();
  const apps = {};
  let traineeId = null;
  if (recruiting.length && pledge) {
    const mk = async (key, name, pos, motivation) => {
      const email = `${key}${DOMAIN}`;
      const { data, error } = await db.from("applications").insert({
        name, phone: "010-1111-2222", email, applied_position: pick(pos), small_group: "3순", gender: key.length % 2 ? "m" : "f",
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
    traineeId = await createUser(db, `trainee1${DOMAIN}`, "노새벽(T)");
    const start = addDays(nextSat(t), -21);
    const { error: te } = await db.rpc("start_trainee", { p_application_id: a4, p_user_id: traineeId, p_main_position: pick("singer"), p_start: start, p_result: "pass_cond", p_condition: "합주 시 타 파트 청취 보완" });
    if (te) throw new HttpError(500, "테스트 수습생을 만들지 못했습니다: " + te.message);
    await db.from("members").update({ must_change_password: false, joined_at: start }).eq("id", traineeId);
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

  // ---------- 3-1. 다음 달 사역: 원스텝(T) — 월말 응답에 포함, 연습 시간 취합 중 ----------
  const ms = addDays(sundaysOf(nm)[1], -1);   // 다음 달 둘째 토요일 저녁
  const { data: mi } = await db.from("ministries").insert({
    name: "원스텝(T)", response_mode: "monthly", target_mode: "all", required_positions: ["drum", "leader"],
    practice_mode: "poll", poll_from: addDays(ms, -6), poll_to: addDays(ms, -1), poll_day_start: "10:00", poll_day_end: "23:00",
    practice_minutes: 120, poll_deadline: addDays(ms, -8), poll_open: true, created_by: me.id,
  }).select("id").single();
  if (mi) {
    const { data: msv } = await db.from("services").insert({ ministry_id: mi.id, service_date: ms, label: "본 섬김", start_time: "19:00", end_time: "21:00" }).select("id").single();
    const yes = ["정사랑(T)", "김하늘(T)", "이소망(T)", "한믿음(T)", "강온유(T)", "임소금(T)", "윤기쁨(T)"];
    await db.from("ministry_availability").insert([...yes.map((nmx) => ({ service_id: msv.id, member_id: ids[nmx], available: true })),
      { service_id: msv.id, member_id: ids["박은혜(T)"], available: false }]);
    // 칠한 시간: 저녁 위주로 서로 조금씩 다르게
    const evening = (d, from, to) => { const out = []; for (let h = from; h < to; h += 0.5) out.push(`${d} ${String(Math.floor(h)).padStart(2, "0")}:${h % 1 ? "30" : "00"}`); return out; };
    const d = (k) => addDays(ms, -k);
    const polls = {
      "정사랑(T)": [...evening(d(3), 19.5, 23), ...evening(d(4), 19, 22)],
      "김하늘(T)": [...evening(d(3), 20, 23), ...evening(d(2), 20, 22)],
      "이소망(T)": [...evening(d(3), 19, 22.5), ...evening(d(6), 13, 17)],
      "한믿음(T)": [...evening(d(3), 20, 23), ...evening(d(4), 20, 23)],
      "강온유(T)": [...evening(d(4), 19, 23), ...evening(d(3), 21, 23)],
      "임소금(T)": [...evening(d(3), 20, 22.5)],
    };
    await db.from("ministry_poll").insert(Object.entries(polls).map(([nmx, sl]) => ({ ministry_id: mi.id, member_id: ids[nmx], slots: sl })));
  }

  // ---------- 3-2. 다음 달 사역: 수련회(T) — 예배 3개, 따로 받기, 연습 후보 날짜를 골라서 취합 ----------
  const rs = addDays(sundaysOf(nm)[2], -2);   // 다음 달 셋째 주 금요일
  const pd = [addDays(rs, -11), addDays(rs, -9), addDays(rs, -6), addDays(rs, -4)];   // 앞 주 월·수 + 그 주 토·월
  const { data: rt } = await db.from("ministries").insert({
    name: "수련회(T)", response_mode: "separate", response_open: true, response_deadline: addDays(rs, -14), target_mode: "all", required_positions: ["leader", "drum"],
    practice_mode: "poll", poll_dates: pd, poll_from: pd[0], poll_to: pd[pd.length - 1], poll_day_start: "10:00", poll_day_end: "23:00",
    practice_minutes: 120, poll_deadline: addDays(rs, -12), poll_open: true, created_by: me.id,
  }).select("id").single();
  if (rt) {
    const { data: rsv } = await db.from("services").insert([
      { ministry_id: rt.id, service_date: rs, label: "예배 1", start_time: "19:30", end_time: "21:30", sort_order: 0 },
      { ministry_id: rt.id, service_date: addDays(rs, 1), label: "예배 2", start_time: "10:00", end_time: "12:00", sort_order: 1 },
      { ministry_id: rt.id, service_date: addDays(rs, 1), label: "예배 3", start_time: "19:30", end_time: "21:30", sort_order: 2 },
    ]).select("id, label");
    const sv = Object.fromEntries((rsv || []).map((x) => [x.label, x.id]));
    // 예배별 가능 여부: y 가능 / n 불가 (예배 1·2·3)
    const ans = { "정사랑(T)": "yyy", "김하늘(T)": "yyn", "이소망(T)": "yyy", "박은혜(T)": "nyy", "최다윗(T)": "yyy", "한믿음(T)": "yyy",
      "윤기쁨(T)": "yny", "강온유(T)": "yyy", "서충성(T)": "yyy", "임소금(T)": "nyy" };
    const rows = [];
    Object.entries(ans).forEach(([nmx, pat]) => ["예배 1", "예배 2", "예배 3"].forEach((lb, i) => rows.push({ service_id: sv[lb], member_id: ids[nmx], available: pat[i] === "y" })));
    await db.from("ministry_availability").insert(rows);
    const span = (d, from, to) => { const out = []; for (let h = from; h < to; h += 0.5) out.push(`${d} ${String(Math.floor(h)).padStart(2, "0")}:${h % 1 ? "30" : "00"}`); return out; };
    // 평일은 저녁, 토요일은 낮
    const P = {
      "정사랑(T)": [...span(pd[0], 19, 23), ...span(pd[2], 13, 18)],
      "김하늘(T)": [...span(pd[0], 20, 23), ...span(pd[1], 19, 22)],
      "이소망(T)": [...span(pd[1], 19, 23), ...span(pd[2], 10, 17)],
      "최다윗(T)": [...span(pd[0], 19, 22), ...span(pd[2], 14, 18)],
      "한믿음(T)": [...span(pd[0], 19, 23), ...span(pd[2], 13, 17), ...span(pd[3], 20, 23)],
      "강온유(T)": [...span(pd[0], 20, 23), ...span(pd[2], 12, 18)],
      "서충성(T)": [...span(pd[2], 13, 18), ...span(pd[3], 19, 23)],
      "임소금(T)": [...span(pd[1], 19, 23), ...span(pd[3], 19, 22)],
    };
    await db.from("ministry_poll").insert(Object.entries(P).map(([nmx, sl]) => ({ ministry_id: rt.id, member_id: ids[nmx], slots: sl })));
  }

  // ---------- 4. 배치표: 지난 4주 + 이번 달 남은 주일 (공개) ----------
  const LINEUPS = [
    { leader: "정사랑(T)", singers: ["김하늘(T)", "이소망(T)", "박은혜(T)"], sl: "김하늘(T)", key_main: "한믿음(T)", key_second: "윤기쁨(T)", e_guitar: "오평강(T)", bass: "강온유(T)", drum: "서충성(T)", bm: "한믿음(T)" },
    { leader: "정사랑(T)", singers: ["이소망(T)", "최다윗(T)"], sl: "이소망(T)", key_main: "윤기쁨(T)", e_guitar: "오평강(T)", bass: "강온유(T)", drum: "임소금(T)", bm: "강온유(T)" },
  ];
  const last = lastSat(t) === t ? addDays(t, -7) : lastSat(t);     // 오늘이 토요일이면 오늘은 비워 둠
  const pastSundays = [3, 2, 1, 0].map((k) => addDays(last, 1 - 7 * k)).filter((d) => d < t);
  const upcoming = sundaysOf(monthStart(t)).filter((d) => d >= t);
  const lineupOf = {};
  let lineupCount = 0;
  const allSundays = [...pastSundays, ...upcoming];
  for (let i = 0; i < allSundays.length; i++) {
    const d = allSundays[i], L = LINEUPS[i % LINEUPS.length];
    let { data: s } = await db.from("services").select("id, assignments(id)").eq("service_date", d).is("ministry_id", null).maybeSingle();
    if (s && s.assignments?.length) continue;   // 실제 배치가 있으면 건드리지 않음
    if (!s) ({ data: s } = await db.from("services").insert({ service_date: d }).select("id").single());
    const put = (pos, slot, name, flags = {}) => db.from("assignments").insert({ service_id: s.id, position_code: pos, slot, member_id: ids[name], ...flags });
    await put("leader", 1, L.leader);
    for (let k = 0; k < L.singers.length; k++) await put("singer", k + 1, L.singers[k], { is_singer_leader: L.singers[k] === L.sl });
    for (const pos of ["key_main", "key_second", "e_guitar", "bass", "drum"]) if (L[pos]) await put(pos, 1, L[pos], { is_band_master: L[pos] === L.bm });
    await db.from("services").update({ status: "published", published_at: new Date().toISOString() }).eq("id", s.id);
    lineupOf[d] = [...new Set([L.leader, ...L.singers, L.key_main, L.key_second, L.e_guitar, L.bass, L.drum].filter(Boolean))];
    if (d >= t) lineupCount++;
  }

  // ---------- 5. 토요 출석: 지난 8주 (연습 · 팀모임) + 이번 주는 '미정' ----------
  const sats = [7, 6, 5, 4, 3, 2, 1, 0].map((k) => addDays(last, -7 * k));
  const upSat = addDays(t, (6 - dow(t) + 7) % 7);
  const satRow = {};
  for (const d of [...sats, upSat]) {
    let { data: row } = await db.from("team_meetings").select("id, meeting_status, note").eq("meeting_date", d).maybeSingle();
    if (!row) ({ data: row } = await db.from("team_meetings").insert({ meeting_date: d, note: MEETING_NOTE }).select("id, meeting_status, note").single());
    satRow[d] = row;
  }
  const att = [];
  const lateLeft = { ...LATE }, rLateLeft = { ...REHEARSAL_LATE }, reasonIdx = {};
  const absent = (name) => {
    const list = REASONS[name] || [["가족 일정", null]];
    const i = reasonIdx[name] = ((reasonIdx[name] ?? -1) + 1) % list.length;
    return { status: "absent", reason_tag: list[i][0], reason: list[i][1] };
  };
  for (let i = 0; i < sats.length; i++) {
    const d = sats[i], row = satRow[d];
    const pat = (name) => (MEETING_PATTERN[name] || "pppppppp")[i];
    // 팀모임: 테스트로 만든 토요일만 여부를 정함 (실제 토요일은 건드리지 않음)
    if (row.note === MEETING_NOTE) {
      const status = i === 4 ? "no" : "yes";
      await db.from("team_meetings").update({ meeting_status: status }).eq("id", row.id);
      row.meeting_status = status;
    }
    if (row.meeting_status !== "no") {
      MEMBERS.forEach(([name]) => {
        const c = pat(name);
        if (c === "a") att.push({ meeting_id: row.id, member_id: ids[name], kind: "meeting", ...absent(name) });
        else if (c === "p" || c === "l") att.push({ meeting_id: row.id, member_id: ids[name], kind: "meeting", status: c === "p" ? "present" : "late" });
      });
      if (traineeId && d >= addDays(nextSat(t), -21) && d <= t) att.push({ meeting_id: row.id, member_id: traineeId, kind: "meeting", status: "present" });
    }
    // 연습: 그 주 배치된 사람만
    const team = lineupOf[addDays(d, 1)] || [];
    team.forEach((name) => {
      const late = i >= sats.length - 4 && lateLeft[name] > 0;
      if (late) lateLeft[name]--;
      att.push({ meeting_id: row.id, member_id: ids[name], kind: "practice", status: late ? "late" : "present" });
      const rLate = i >= sats.length - 4 && rLateLeft[name] > 0;
      if (rLate) rLateLeft[name]--;
      att.push({ meeting_id: row.id, member_id: ids[name], kind: "rehearsal", status: rLate ? "late" : "present" });
    });
  }
  await db.from("member_notes").upsert({ member_id: ids["오평강(T)"], note: "10월부터 직장 일정으로 토요일 오후 2시 이후 도착 가능. 지각 사유 확인됨.", updated_by: me.id });
  if (att.length) {
    const { error } = await db.from("attendance").upsert(att.map((r) => ({ reason_tag: null, reason: null, ...r })));
    if (error) throw new HttpError(500, "테스트 출석을 만들지 못했습니다: " + error.message);
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
