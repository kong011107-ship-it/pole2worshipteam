// 리더십이 보내는 알림: 응답 열림 · 사역 응답 열림 · 연습 시간 요청 · 배치표 공개 · 연습 확정 · 공지 · 테스트
import { adminClient, requireAdmin, requireMember, handler, HttpError } from "./_lib.js";
import { settingOf, fill, deliver, activeMembers, targetsOf, pollPeople, wasSent, claim, release, markSent, md, mdw, hm, monthLabel } from "./_notify.js";

// 알림을 누르면 열리는 곳 (015: 그 항목을 바로 처리할 수 있는 화면)
export const ME_URL = /^\/me\.html(#[a-z]+(\/[A-Za-z0-9:_.-]{1,80})?)?$/;

const SAMPLE = {
  "월": "11월", "마감일": "10/31(토)", "사역": "원스텝", "무엇": "11월 섬김 응답", "남은 것": "3개 남았어요", "이름": "",
  "내 섬김": "11/8 싱어 리더 · 11/15 섬겨요", "연습 일시": "11/10(화) 19:00–21:00", "지원자": "이도현", "포지션": "싱어",
  "수습생": "이도현", "주차": "3", "제목": "공지 제목", "내용": "공지 내용",
  "인원": "12", "개수": "12", "대상": "김하늘",
  "생일자": "김하늘", "며칠": "3일", "날짜": "10/23(금)", "정산": "생일선물 정산 참여 · 선물 준비해요",
};

export default handler(async (req, body) => {
  const db = adminClient();
  const kind = body.kind;
  if (kind === "prayer_urgent") return prayerUrgent(req, db, body);
  const user = await requireAdmin(req, db);

  // ---------- 리더십이 직접 보내는 안내 · 독촉 (보내기 창, 014)
  //  { kind: "message", title, body, member_ids, url, ctx_key, label }
  if (kind === "message") {
    const title = String(body.title || "").trim(), text = String(body.body || "").trim();
    if (!title) throw new HttpError(400, "알림 제목을 적어 주세요.");
    if (title.length > 80 || text.length > 500) throw new HttpError(400, "제목은 80자, 내용은 500자까지예요.");
    const ids = new Set([].concat(body.member_ids || []));
    const people = (await activeMembers(db, { trainees: true })).filter((m) => ids.has(m.id));
    if (!people.length) throw new HttpError(400, "받는 사람이 없어요.");
    const url = ME_URL.test(body.url || "") ? body.url : "/me.html#respond";
    const items = people.map((m) => ({ member_id: m.id, title: fill(title, { "이름": m.name }), body: fill(text, { "이름": m.name }) }));
    return deliver(db, { kind, items, url, label: `${String(body.label || "안내").slice(0, 80)} · ${people.length}명`, by: user.id, ctxKey: body.ctx_key || null });
  }

  const st = await settingOf(db, kind === "test" ? body.test_kind : kind);
  if (!st.kind || !st.title) throw new HttpError(400, "알 수 없는 알림이에요.");
  if (kind !== "test" && kind !== "notice" && !st.enabled) return { skipped: true, recipients: 0, pushed: 0 };

  // ---------- 나에게 테스트 (설정 화면에서 아직 저장 안 한 문구로)
  if (kind === "test") {
    const vars = { ...SAMPLE, "이름": user.email };
    const t = fill(body.title ?? st.title, vars), b = fill(body.body ?? st.body, vars);
    return deliver(db, { kind: String(body.test_kind).startsWith("prayer") ? "prayer" : String(body.test_kind).startsWith("birthday") ? "birthday" : body.test_kind, items: [{ member_id: user.id, title: t, body: b }], url: "/me.html#alerts", label: "테스트 · 나에게", by: user.id });
  }

  // ---------- 월말 응답 열림
  if (kind === "open") {
    const { data: mo } = await db.from("availability_months").select("*").eq("month", body.month).maybeSingle();
    if (!mo?.is_open) throw new HttpError(400, "응답이 열려 있지 않아요.");
    const vars = { "월": monthLabel(body.month), "마감일": mo.deadline ? mdw(mo.deadline) : "" };
    const people = await activeMembers(db);
    return deliver(db, { kind, items: people.map((m) => ({ member_id: m.id, title: fill(st.title, { ...vars, "이름": m.name }), body: fill(st.body, { ...vars, "이름": m.name }) })),
      url: `/me.html#respond/month:${body.month}`, label: `${monthLabel(body.month)} 응답 · 팀원 전체`, by: user.id, sentKey: `open:${body.month}` });
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
      url: kind === "poll" ? "/me.html#respond/poll:all" : `/me.html#respond/min:${mi.id}`, label: `${mi.name} · ${kind === "poll" ? "'가능' 응답자" : "응답 대상"} ${people.length}명`, by: user.id, sentKey: `${kind}:${mi.id}` });
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
    return deliver(db, { kind, items, url: `/me.html#lineup/${month}`, label: `${label} 배치표 · 팀원 전체 (배치 ${mine.size}명)`, by: user.id, sentKey: pub.map((s) => `lineup:${s.id}`) });
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
      url: `/me.html#practice/${p.id}`, label: `${vars["사역"]} 연습 · ${who} ${ids.length}명`, by: user.id, sentKey: `practice:${p.id}` });
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
    // 016: 투표 붙이기 — 투표를 먼저 만들고, 공지를 보낸 뒤 공지에 연결 (대상 = 공지를 받은 사람)
    const poll = body.poll ? checkPoll(body.poll) : null;
    let pollId = null;
    if (poll) {
      const { data: p, error } = await db.from("polls").insert({ question: title, multi: poll.multi, anonymous: poll.anonymous, deadline: poll.deadline, created_by: user.id }).select("id").single();
      if (error) throw new HttpError(500, "투표를 만들지 못했어요: " + error.message);
      pollId = p.id;
      const { error: e2 } = await db.from("poll_options").insert(poll.options.map((label, i) => ({ poll_id: pollId, label, sort_order: i })));
      if (e2) { await db.from("polls").delete().eq("id", pollId); throw new HttpError(500, "투표 선택지를 저장하지 못했어요: " + e2.message); }
    }
    const vars = { "제목": title, "내용": poll ? [text, `투표 · ${dlLabel(poll.deadline)} 마감`].filter(Boolean).join("\n") : text };
    // 공지는 알림 설정에서 꺼도 알림함에는 남기고, 푸시는 보내지 않음
    const head = (t) => (poll ? t.replace(/^\[공지\]/, "[투표]") : t);
    const items = people.map((m) => ({ member_id: m.id, title: head(fill(st.title, { ...vars, "이름": m.name })), body: fill(st.body, { ...vars, "이름": m.name }) }));
    let r;
    try {
      r = await deliver(db, { kind, items, url: "/me.html#alerts/{id}", label: `${poll ? "투표 · " : ""}${label} ${people.length}명`, by: user.id, push: st.enabled });
    } catch (e) {
      if (pollId) await db.from("polls").delete().eq("id", pollId);
      throw e;
    }
    if (pollId) await db.from("polls").update({ notification_id: r.id }).eq("id", pollId);
    return { ...r, poll_id: pollId };
  }

  throw new HttpError(400, "알 수 없는 알림이에요.");
});

// ---------- 투표 (016): { options: [..2~10], multi, anonymous, deadline: ISO }
const KDOW = ["일", "월", "화", "수", "목", "금", "토"];
export function dlLabel(iso) {
  const k = new Date(new Date(iso).getTime() + 9 * 3600e3);
  const h = k.getUTCHours(), mi = k.getUTCMinutes();
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()}(${KDOW[k.getUTCDay()]}) ${h < 12 ? "오전" : "오후"} ${h % 12 || 12}시${mi ? " " + mi + "분" : ""}`;
}
function checkPoll(p) {
  const options = [].concat(p.options || []).map((x) => String(x ?? "").trim()).filter(Boolean);
  if (options.length < 2) throw new HttpError(400, "투표 선택지를 두 개 이상 적어 주세요.");
  if (options.length > 10) throw new HttpError(400, "투표 선택지는 10개까지예요.");
  if (options.some((x) => x.length > 40)) throw new HttpError(400, "선택지는 40자까지예요.");
  if (new Set(options).size !== options.length) throw new HttpError(400, "같은 선택지가 두 번 있어요.");
  const t = Date.parse(p.deadline || "");
  if (!t) throw new HttpError(400, "투표 마감 일시를 골라 주세요.");
  if (t < Date.now() + 10 * 60e3) throw new HttpError(400, "투표 마감은 지금부터 10분 뒤 이후로 골라 주세요.");
  if (t > Date.now() + 60 * 864e5) throw new HttpError(400, "투표 마감은 60일 안으로 골라 주세요.");
  return { options, multi: !!p.multi, anonymous: !!p.anonymous, deadline: new Date(t).toISOString() };
}

// ---------- 급한 기도 (015): 올린 사람이 바로 부름. 올린 지 30분 안, 한 번만, 하루 3번까지
async function prayerUrgent(req, db, body) {
  const { me } = await requireMember(req, db);
  const ids = [...new Set([].concat(body.prayer_ids || []).map(Number))].filter(Boolean).slice(0, 20);
  if (!ids.length) throw new HttpError(400, "기도제목을 찾을 수 없어요.");
  const { data: ps } = await db.from("prayers").select("id, member_id, author_id, urgent, created_at").in("id", ids).is("hidden_at", null);
  const mine = (ps || []).filter((p) => p.author_id === me.id && p.urgent && Date.now() - new Date(p.created_at).getTime() < 30 * 60 * 1000);
  const fresh = [];
  for (const p of mine) if (!(await wasSent(db, `prayer_urgent:${p.id}`))) fresh.push(p);
  if (!fresh.length) return { skipped: true, recipients: 0, pushed: 0 };
  const st = await settingOf(db, "prayer_urgent");
  if (!st.enabled) return { skipped: true, recipients: 0, pushed: 0 };
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await db.from("notifications").select("id", { count: "exact", head: true })
    .eq("kind", "prayer").eq("created_by", me.id).like("ctx_key", "urgent:%").gte("created_at", since);
  if ((count || 0) >= 3) throw new HttpError(429, "급한 기도 알림은 하루 3번까지 보낼 수 있어요. 기도제목은 올라갔어요.");
  // 020: 보내기 전에 기도제목마다 자리를 잡음 — 두 번 눌러도(두 기기) 한 번만
  const got = [];
  for (const p of fresh) if (await claim(db, `prayer_urgent:${p.id}`)) got.push(p);
  if (!got.length) return { skipped: true, recipients: 0, pushed: 0 };
  const keys = got.map((p) => `prayer_urgent:${p.id}`);
  const { data: who } = await db.from("members").select("id, name").in("id", got.map((p) => p.member_id));
  const names = [...new Set(got.map((p) => (who || []).find((m) => m.id === p.member_id)?.name).filter(Boolean))];
  const target = names.length > 2 ? `${names.slice(0, 2).join("·")} 외 ${names.length - 2}명` : names.join("·");
  const people = (await activeMembers(db, { trainees: true })).filter((m) => m.id !== me.id);
  const vars = { "대상": target };
  try {
    const r = await deliver(db, { kind: "prayer", by: me.id, ctxKey: `urgent:${got[0].id}`, sentKey: keys,
      url: `/me.html#pray/${got[0].id}`, label: `급한 기도 · ${target} · ${people.length}명`,
      items: people.map((m) => ({ member_id: m.id, title: fill(st.title, { ...vars, "이름": m.name }), body: fill(st.body, { ...vars, "이름": m.name }) })) });
    if (!r.id) await markSent(db, keys);
    return r;
  } catch (e) {
    await release(db, keys);
    throw e;
  }
}
