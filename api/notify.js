// 리더십이 보내는 알림: 응답 열림 · 사역 응답 열림 · 연습 시간 요청 · 배치표 공개 · 연습 확정 · 공지 · 테스트
import { adminClient, requireAdmin, handler, HttpError } from "./_lib.js";
import { settingOf, fill, deliver, activeMembers, targetsOf, pollPeople, md, mdw, hm, monthLabel } from "./_notify.js";

const SAMPLE = {
  "월": "11월", "마감일": "10/31(토)", "사역": "원스텝", "무엇": "11월 섬김 응답", "남은 것": "3개 남았어요", "이름": "",
  "내 섬김": "11/8 싱어 리더 · 11/15 섬겨요", "연습 일시": "11/10(화) 19:00–21:00", "지원자": "이도현", "포지션": "싱어",
  "수습생": "이도현", "주차": "3", "제목": "공지 제목", "내용": "공지 내용",
};

export default handler(async (req, body) => {
  const db = adminClient();
  const user = await requireAdmin(req, db);
  const kind = body.kind;
  const st = await settingOf(db, kind === "test" ? body.test_kind : kind);
  if (!st.kind || !st.title) throw new HttpError(400, "알 수 없는 알림이에요.");
  if (kind !== "test" && kind !== "notice" && !st.enabled) return { skipped: true, recipients: 0, pushed: 0 };

  // ---------- 나에게 테스트 (설정 화면에서 아직 저장 안 한 문구로)
  if (kind === "test") {
    const vars = { ...SAMPLE, "이름": user.email };
    const t = fill(body.title ?? st.title, vars), b = fill(body.body ?? st.body, vars);
    return deliver(db, { kind: body.test_kind, items: [{ member_id: user.id, title: t, body: b }], url: "/me.html#alerts", label: "테스트 · 나에게", by: user.id });
  }

  // ---------- 월말 응답 열림
  if (kind === "open") {
    const { data: mo } = await db.from("availability_months").select("*").eq("month", body.month).maybeSingle();
    if (!mo?.is_open) throw new HttpError(400, "응답이 열려 있지 않아요.");
    const vars = { "월": monthLabel(body.month), "마감일": mo.deadline ? mdw(mo.deadline) : "" };
    const people = await activeMembers(db);
    return deliver(db, { kind, items: people.map((m) => ({ member_id: m.id, title: fill(st.title, { ...vars, "이름": m.name }), body: fill(st.body, { ...vars, "이름": m.name }) })),
      url: "/me.html#respond", label: `${monthLabel(body.month)} 응답 · 팀원 전체`, by: user.id, sentKey: `open:${body.month}` });
  }

  // ---------- 사역 응답 열림 · 연습 시간 요청
  if (kind === "minopen" || kind === "poll") {
    const { data: mi } = await db.from("ministries").select("*, services(id, service_date)").eq("id", body.ministry_id).maybeSingle();
    if (!mi) throw new HttpError(404, "사역을 찾을 수 없어요.");
    let people, dl;
    if (kind === "minopen") {
      if (mi.response_mode !== "separate" || !mi.response_open) throw new HttpError(400, "따로 받는 응답이 열려 있지 않아요.");
      people = await targetsOf(db, mi); dl = mi.response_deadline;
    } else {
      if (!mi.poll_open) throw new HttpError(400, "연습 시간 취합이 열려 있지 않아요.");
      people = (await pollPeople(db, mi)).eligible; dl = mi.poll_deadline;
    }
    const vars = { "사역": mi.name, "마감일": dl ? mdw(dl) : "" };
    return deliver(db, { kind, items: people.map((m) => ({ member_id: m.id, title: fill(st.title, { ...vars, "이름": m.name }), body: fill(st.body, { ...vars, "이름": m.name }) })),
      url: "/me.html#respond", label: `${mi.name} · ${kind === "poll" ? "'가능' 응답자" : "응답 대상"} ${people.length}명`, by: user.id, sentKey: `${kind}:${mi.id}` });
  }

  // ---------- 배치표 공개: 팀원 전체, 배치된 사람은 내 섬김 포함
  if (kind === "lineup") {
    const ids = [].concat(body.service_ids || []);
    if (!ids.length) throw new HttpError(400, "공개한 예배가 없어요.");
    const { data: svs } = await db.from("services").select("id, service_date, status, label, ministry_id, ministries(name), assignments(member_id, position_code, is_singer_leader, is_band_master)").in("id", ids);
    const pub = (svs || []).filter((s) => s.status === "published").sort((a, b) => a.service_date.localeCompare(b.service_date));
    if (!pub.length) throw new HttpError(400, "공개된 예배가 없어요.");
    const multi = new Set(pub.filter((s) => s.ministry_id).map((s) => s.ministry_id).filter((id, i, arr) => arr.indexOf(id) !== i));
    const mine = new Map();
    for (const s of pub) for (const a of s.assignments || []) {
      if (!a.member_id) continue;
      const role = a.position_code === "leader" ? " 인도" : a.is_singer_leader ? " 싱어 리더" : a.is_band_master ? " 밴드 마스터" : "";
      const what = s.ministry_id ? ` ${s.ministries?.name || ""}${multi.has(s.ministry_id) && s.label ? " " + s.label : ""}` : "";
      if (!mine.has(a.member_id)) mine.set(a.member_id, []);
      mine.get(a.member_id).push(`${md(s.service_date)}${what}${role}`);
    }
    const month = body.month || pub[0].service_date.slice(0, 8) + "01";
    const label = body.label || monthLabel(month);
    const people = await activeMembers(db);
    const items = people.map((m) => {
      const list = mine.get(m.id);
      const vars = { "월": label, "이름": m.name, "내 섬김": list ? `${list.join(" · ")} 섬겨요` : "배치표를 확인해 보세요" };
      return { member_id: m.id, title: fill(st.title, vars), body: fill(st.body, vars) };
    });
    return deliver(db, { kind, items, url: "/me.html#lineup", label: `${label} 배치표 · 팀원 전체 (배치 ${mine.size}명)`, by: user.id, sentKey: pub.map((s) => `lineup:${s.id}`) });
  }

  // ---------- 연습 확정: 그 예배에 배치된 사람
  if (kind === "practice") {
    const { data: p } = await db.from("ministry_practices").select("*, ministries(id, name, services(id, label, assignments(member_id)))").eq("id", body.practice_id).maybeSingle();
    if (!p) throw new HttpError(404, "연습을 찾을 수 없어요.");
    const svs = p.ministries.services || [];
    const target = svs.filter((s) => !p.service_id || s.id === p.service_id);
    let ids = [...new Set(target.flatMap((s) => (s.assignments || []).map((a) => a.member_id)).filter(Boolean))];
    let who = "배치된 사람";
    if (!ids.length) { ids = (await targetsOf(db, { id: p.ministry_id, target_mode: "all" })).map((m) => m.id); who = "아직 배치 전 · 팀원 전체"; }
    const svc = svs.find((s) => s.id === p.service_id);
    const vars = { "사역": `${p.ministries.name}${svs.length > 1 && svc?.label ? " " + svc.label : ""}`, "연습 일시": `${mdw(p.practice_date)} ${hm(p.start_time)}–${hm(p.end_time)}` };
    return deliver(db, { kind, items: ids.map((id) => ({ member_id: id, title: fill(st.title, vars), body: fill(st.body, vars) })),
      url: "/me.html#home", label: `${vars["사역"]} 연습 · ${who} ${ids.length}명`, by: user.id, sentKey: `practice:${p.id}` });
  }

  // ---------- 공지
  if (kind === "notice") {
    const title = String(body.title || "").trim(), text = String(body.body || "").trim();
    if (!title) throw new HttpError(400, "제목을 적어 주세요.");
    if (title.length > 60 || text.length > 500) throw new HttpError(400, "제목은 60자, 내용은 500자까지예요.");
    const t = body.target || { type: "all" };
    let people = [], label = "";
    const all = await activeMembers(db, { trainees: true });
    if (t.type === "all") { people = all; label = "전체"; }
    else if (t.type === "lead") { people = all.filter((m) => m.role === "admin"); label = "리더십"; }
    else if (t.type === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date || "")) throw new HttpError(400, "날짜를 골라 주세요.");
      const { data: svs } = await db.from("services").select("id, ministry_id, ministries(name), assignments(member_id)").eq("service_date", t.date);
      const ids = new Set((svs || []).flatMap((s) => (s.assignments || []).map((a) => a.member_id)).filter(Boolean));
      people = all.filter((m) => ids.has(m.id)); label = `${mdw(t.date)} 섬김자`;
    } else if (t.type === "pick") {
      const ids = new Set([].concat(t.ids || []));
      people = all.filter((m) => ids.has(m.id)); label = "직접 고른";
    }
    if (!people.length) throw new HttpError(400, "받는 사람이 없어요.");
    const vars = { "제목": title, "내용": text };
    // 공지는 알림 설정에서 꺼도 알림함에는 남기고, 푸시는 보내지 않음
    const items = people.map((m) => ({ member_id: m.id, title: fill(st.title, { ...vars, "이름": m.name }), body: fill(st.body, { ...vars, "이름": m.name }) }));
    return deliver(db, { kind, items, url: "/me.html#alerts", label: `${label} ${people.length}명`, by: user.id, push: st.enabled });
  }

  throw new HttpError(400, "알 수 없는 알림이에요.");
});
