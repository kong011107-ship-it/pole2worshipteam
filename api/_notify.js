// 푸시 알림 공용 — 받는 사람 계산 · 문구 채우기 · 알림함 저장 · 웹 푸시 발송
import webpush from "web-push";
import fs from "node:fs";

// ---------------------------------------------------------------- 날짜 (한국 시간)
export function kstNow(override) {
  const d = override ? new Date(override) : new Date();
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return { date: k.toISOString().slice(0, 10), hour: k.getUTCHours(), dow: k.getUTCDay() };
}
export const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const dowOf = (iso) => new Date(iso + "T00:00:00Z").getUTCDay();
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
export const md = (iso) => `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}`;
export const mdw = (iso) => `${md(iso)}(${DOW[dowOf(iso)]})`;
export const hm = (t) => (t ? String(t).slice(0, 5) : "");
export const monthLabel = (m) => `${+m.slice(5, 7)}월`;
export const sundaysOf = (month) => {
  const out = []; let d = month;
  while (dowOf(d) !== 0) d = addDays(d, 1);
  while (d.slice(0, 7) === month.slice(0, 7)) { out.push(d); d = addDays(d, 7); }
  return out;
};
export const RELDAY = ["오늘", "내일", "모레", "글피"];

// ---------------------------------------------------------------- 콘티 (022)
// 예배 이름: '10/25 주일' · '원스텝' · '수련회 예배 2'
export function serviceName(s, multi = false) {
  if (!s.ministry_id) return `${md(s.service_date)} 주일`;
  return `${s.ministries?.name || "사역"}${multi && s.label ? " " + s.label : ""}`;
}
export function deadlineLabel(iso) {
  const k = new Date(new Date(iso).getTime() + 9 * 3600e3);
  return `${mdw(k.toISOString().slice(0, 10))} ${hm(k.toISOString().slice(11, 16))}`;
}


// ---------------------------------------------------------------- 설정 · 문구
export const DEFAULTS = {
  open: { title: "{월} 섬김 응답을 받고 있어요", body: "{마감일}까지 토요 연습·주일 가능 여부를 체크해 주세요" },
  minopen: { title: "{사역} 섬김 응답을 받고 있어요", body: "{마감일}까지 가능 여부를 체크해 주세요" },
  poll: { title: "{사역} 연습 시간을 골라 주세요", body: "{마감일}까지 · 되는 칸을 눌러 주세요" },
  remind: { title: "[{마감일} 마감] {무엇}", body: "{남은 것}. 지금 체크해 주세요", schedule: [{ days: 1, hour: 18 }, { days: 0, hour: 10 }] },
  lineup: { title: "{월} 배치표가 나왔어요", body: "{내 섬김}" },
  practice: { title: "{사역} 연습 시간이 정해졌어요", body: "{연습 일시}" },
  apply: { title: "새 지원서가 들어왔어요", body: "{지원자} · {포지션} · 모집에서 확인하세요" },
  trainee: { title: "{수습생}님 수습 {주차}주차 기록을 남겨 주세요", body: "오늘 나눔 내용을 적어 주세요", schedule: { dow: 6, hour: 18 } },
  notice: { title: "[공지] {제목}", body: "{내용}" },
  prayer_new: { title: "이번 주 기도제목이 올라왔어요", body: "{인원}명의 기도제목을 함께 품어요", schedule: { dow: 6, hour: 21 } },
  prayer_remind: { title: "오늘 저녁, 함께 기도해요", body: "이번 주 기도제목 {개수}개를 함께 기도해요", schedule: { days: [2, 4], hour: 20 } },
  prayer_urgent: { title: "급한 기도제목이 올라왔어요", body: "{대상}님을 위해 함께 기도해 주세요" },
  birthday_soon: { title: "{생일자}님 생일이 {며칠} 남았어요", body: "{날짜} · {정산}", schedule: { days: 3, hour: 9 } },
  birthday_today: { title: "오늘은 {생일자}님 생일이에요", body: "{정산} · 축하 메시지를 보내 주세요", schedule: { hour: 9 } },
  conti_up: { title: "{예배} 콘티가 올라왔어요", body: "{곡}" },
  conti_edit: { title: "{예배} 콘티가 수정됐어요", body: "{바뀐 것}" },
  conti_open: { title: "{예배} 콘티를 준비해 주세요", body: "{마감}까지 올려 주세요 · 섬김자 {인원}명", schedule: { days: 7, hour: 18 } },
  conti_remind: { title: "[{마감일} 마감] {예배} 콘티", body: "아직 콘티가 올라오지 않았어요. {마감}까지 올려 주세요", schedule: [{ days: 1, hour: 18 }, { days: 0, hour: 18 }] },
};
// 생일 (016 · 양력): 그해 생일 날짜 — 2/29는 평년이면 2/28
export function birthdayIn(birth, year) {
  const md = birth.slice(5, 10), leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return `${year}-${md === "02-29" && !leap ? "02-28" : md}`;
}
export const GIFT_TEXT = (g) => (g === true ? "생일선물 정산 참여 · 선물 준비해요" : g === false ? "생일선물 정산 미참여" : "생일선물 정산 미정");
// 기도 주간: 그 주 토요일(팀모임) — 토요일은 그날, 주중은 지난 토요일 (DB prayer_week와 같음)
export const prayerWeekOf = (iso) => addDays(iso, -((dowOf(iso) + 1) % 7));
export async function settingOf(db, kind) {
  const { data } = await db.from("notify_settings").select("*").eq("kind", kind).maybeSingle();
  const d = DEFAULTS[kind];
  return { kind, enabled: data ? data.enabled : true, title: data?.title || d.title, body: data?.body ?? d.body, schedule: data?.schedule ?? d.schedule ?? null };
}
// {칸} 채우기. 값이 비면 칸과 바로 뒤 '까지'를 함께 지움
export function fill(t, vars) {
  return String(t || "").replace(/\{([^}]+)\}(까지)?/g, (m, k, kk) => {
    const v = vars[k];
    if (v === undefined) return m;
    if (v === null || v === "") return "\u0000";
    return v + (kk || "");
  }).replace(/\u0000\s*(·\s*)?/g, "").replace(/\s*·\s*$/, "").trim();
}

// ---------------------------------------------------------------- 사람
// trainees: 수습까지 모두(예배MC · 교역자 포함) · observers: 정식 + 예배MC · 교역자 (021: 배치표 공개 알림)
export async function activeMembers(db, { trainees = false, observers = false } = {}) {
  const { data } = await db.from("members").select("id, name, role, status, main_position, is_active").eq("is_active", true);
  return (data || []).filter((m) => trainees || m.status === "active" || (observers && (m.status === "mc" || m.status === "pastor")));
}
export async function admins(db) {
  const { data } = await db.from("members").select("id, name").eq("is_active", true).eq("role", "admin");
  return data || [];
}
export async function targetsOf(db, mi) {
  const all = await activeMembers(db);
  if (mi.target_mode !== "custom") return all;
  const { data } = await db.from("ministry_targets").select("member_id").eq("ministry_id", mi.id);
  const set = new Set((data || []).map((t) => t.member_id));
  return all.filter((m) => set.has(m.id));
}

// ---------------------------------------------------------------- 보내기
let vapidReady = null;
function setupVapid() {
  if (vapidReady !== null) return vapidReady;
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) { vapidReady = false; return false; }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:pole2worship@example.com", pub, priv);
  vapidReady = true; return true;
}

// items: [{ member_id, title, body }] — 사람마다 문구가 다를 수 있음
// url 안의 {id}는 저장한 알림 번호로 바뀜 (예: 공지 → /me.html#alerts/{id})
// 반환: { id, recipients, pushed }
export async function deliver(db, { kind, items, url, label, by = null, sentKey = null, push = true, ctxKey = null }) {
  const uniq = [];
  const seen = new Set();
  for (const it of items) if (it.member_id && !seen.has(it.member_id)) { seen.add(it.member_id); uniq.push(it); }
  if (!uniq.length) return { id: null, recipients: 0, pushed: 0 };
  const first = uniq[0];
  const { data: n, error } = await db.from("notifications").insert({
    kind, title: first.title.slice(0, 120), body: (first.body || "").slice(0, 600), url, target_label: label?.slice(0, 120) || null,
    recipients: uniq.length, created_by: by, ...(ctxKey ? { ctx_key: String(ctxKey).slice(0, 200) } : {}),
  }).select("id").single();
  if (error) throw new Error("알림을 저장하지 못했습니다: " + error.message);
  if (url && url.includes("{id}")) { url = url.replace("{id}", n.id); await db.from("notifications").update({ url }).eq("id", n.id); }
  await db.from("notification_inbox").insert(uniq.map((it) => ({ notification_id: n.id, member_id: it.member_id, title: it.title.slice(0, 120), body: (it.body || "").slice(0, 600) })));

  const { data: subs } = await db.from("push_subscriptions").select("*").in("member_id", uniq.map((x) => x.member_id));
  const byMember = new Map(uniq.map((x) => [x.member_id, x]));
  const pushedMembers = new Set();
  const sink = process.env.PUSH_SINK;
  const canSend = push && (sink || setupVapid());
  if (canSend) {
    await Promise.all((subs || []).map(async (s) => {
      const it = byMember.get(s.member_id);
      const payload = JSON.stringify({ title: it.title, body: it.body || "", url, tag: `${kind}-${n.id}`, id: n.id });
      try {
        if (sink) fs.appendFileSync(sink, JSON.stringify({ endpoint: s.endpoint, member_id: s.member_id, kind, title: it.title, body: it.body || "", url }) + "\n");
        else await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 24 });
        pushedMembers.add(s.member_id);
        await db.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).eq("endpoint", s.endpoint);
      } catch (e) {
        // 410/404: 구독이 끊긴 기기 → 지움
        if (e.statusCode === 404 || e.statusCode === 410) await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        else console.error("push", e.statusCode, e.body || e.message);
      }
    }));
  }
  await db.from("notifications").update({ pushed: pushedMembers.size }).eq("id", n.id);
  if (sentKey) await markSent(db, sentKey);
  return { id: n.id, recipients: uniq.length, pushed: pushedMembers.size, noPushReady: push && !canSend };
}

export async function wasSent(db, key) {
  const { data } = await db.from("notify_sent").select("key").eq("key", key).maybeSingle();
  return !!data;
}
export async function markSent(db, keys) {
  const list = [].concat(keys).filter(Boolean).map((key) => ({ key, sent_at: new Date().toISOString(), done: true }));
  if (list.length) await db.from("notify_sent").upsert(list);
}
// 020: 예약 알림은 보내기 '전에' 자리를 잡음 — 두 번 불려도 한 번만 보내요
//  잡으면 true. 이미 보냈거나 지금 다른 쪽이 보내는 중이면 false (10분 넘게 멈춘 자리는 다시 잡을 수 있어요)
export async function claim(db, key) {
  const { data, error } = await db.rpc("claim_notify", { p_key: key });
  if (error) throw new Error("알림 자리를 잡지 못했습니다: " + error.message);
  return data === true;
}
// 보내다 실패하면 잡은 자리를 풀어서 다음에 다시 보낼 수 있게
export async function release(db, keys) {
  const list = [].concat(keys).filter(Boolean);
  if (list.length) await db.from("notify_sent").delete().in("key", list).eq("done", false);
}
// 자리 잡기 → 보내기 → (실패하면) 풀기
export async function deliverOnce(db, key, opts) {
  if (!(await claim(db, key))) return null;
  try {
    const r = await deliver(db, { ...opts, sentKey: key });
    if (!r.id) await markSent(db, key);   // 받을 사람이 없어도 이번 차례는 끝난 것
    return r;
  } catch (e) {
    await release(db, key);
    throw e;
  }
}

// ---------------------------------------------------------------- 응답 남은 사람 (마감 임박)
// 월말 응답: 토 연습·주일 + 그 달 월말 응답 사역(대상만) + 정해진 사역 연습
export async function pendingForMonth(db, month, today) {
  const people = await activeMembers(db);
  const suns = sundaysOf(month);
  const from = addDays(suns[0], -1), to = suns[suns.length - 1];
  const [av, mis] = await Promise.all([
    db.from("availability").select("member_id, date, kind").gte("date", from).lte("date", to),
    db.from("ministries").select("*, services(id, service_date), ministry_practices(id, practice_date, service_id), ministry_targets(member_id)").eq("response_mode", "monthly"),
  ]);
  const mins = (mis.data || []).filter((mi) => mi.services.some((s) => s.service_date.slice(0, 7) === month.slice(0, 7) && s.service_date >= today));
  const sids = mins.flatMap((mi) => mi.services.map((s) => s.id));
  const pids = mins.filter((mi) => mi.practice_mode === "fixed").flatMap((mi) => mi.ministry_practices.filter((p) => p.practice_date >= today).map((p) => p.id));
  const [ma, pa] = await Promise.all([
    sids.length ? db.from("ministry_availability").select("service_id, member_id, available").in("service_id", sids) : { data: [] },
    pids.length ? db.from("practice_answers").select("practice_id, member_id").in("practice_id", pids) : { data: [] },
  ]);
  return people.map((m) => {
    const yes = (sid) => (ma.data || []).some((a) => a.member_id === m.id && a.service_id === sid && a.available);
    let total = suns.length * 2;
    let done = (av.data || []).filter((a) => a.member_id === m.id).length;
    for (const mi of mins) {
      if (mi.target_mode === "custom" && !mi.ministry_targets.some((t) => t.member_id === m.id)) continue;
      total += mi.services.length;
      done += (ma.data || []).filter((a) => a.member_id === m.id && mi.services.some((s) => s.id === a.service_id)).length;
      if (mi.practice_mode === "fixed") {
        // 정해진 연습은 본 섬김 '가능'인 예배의 것만 물어요 (014)
        const ps = mi.ministry_practices.filter((p) => p.practice_date >= today && (p.service_id ? yes(p.service_id) : mi.services.some((s) => yes(s.id))));
        total += ps.length;
        done += (pa.data || []).filter((a) => a.member_id === m.id && ps.some((p) => p.id === a.practice_id)).length;
      }
    }
    return { m, left: Math.max(0, total - done) };
  }).filter((x) => x.left > 0);
}
// 따로 받는 사역 응답
export async function pendingForMinistry(db, mi, today) {
  const people = await targetsOf(db, mi);
  const sids = (mi.services || []).map((s) => s.id);
  const ps = mi.practice_mode === "fixed" ? (mi.ministry_practices || []).filter((p) => p.practice_date >= today) : [];
  const [ma, pa] = await Promise.all([
    sids.length ? db.from("ministry_availability").select("service_id, member_id, available").in("service_id", sids) : { data: [] },
    ps.length ? db.from("practice_answers").select("practice_id, member_id").in("practice_id", ps.map((p) => p.id)) : { data: [] },
  ]);
  return people.map((m) => {
    const yes = (sid) => (ma.data || []).some((a) => a.member_id === m.id && a.service_id === sid && a.available);
    const mine = ps.filter((p) => (p.service_id ? yes(p.service_id) : sids.some(yes)));
    const total = sids.length + mine.length;
    const done = (ma.data || []).filter((a) => a.member_id === m.id).length + (pa.data || []).filter((a) => a.member_id === m.id && mine.some((p) => p.id === a.practice_id)).length;
    return { m, left: Math.max(0, total - done) };
  }).filter((x) => x.left > 0);
}
// 연습 가능 시간: 본 섬김 '가능'인데 아직 안 고른 사람
export async function pollPeople(db, mi) {
  const people = await targetsOf(db, mi);
  const sids = (mi.services || []).map((s) => s.id);
  const [ma, po] = await Promise.all([
    sids.length ? db.from("ministry_availability").select("member_id").in("service_id", sids).eq("available", true) : { data: [] },
    db.from("ministry_poll").select("member_id, slots").eq("ministry_id", mi.id),
  ]);
  const yes = new Set((ma.data || []).map((a) => a.member_id));
  const done = new Set((po.data || []).filter((p) => (p.slots || []).length).map((p) => p.member_id));
  const eligible = people.filter((m) => yes.has(m.id));
  return { eligible, pending: eligible.filter((m) => !done.has(m.id)) };
}

// 투표 (016): 공지를 받았는데 아직 투표하지 않은 활동 중인 사람
export async function votePending(db, poll) {
  const [ib, vs] = await Promise.all([
    db.from("notification_inbox").select("member_id").eq("notification_id", poll.notification_id),
    db.from("poll_votes").select("member_id").eq("poll_id", poll.id),
  ]);
  const done = new Set((vs.data || []).map((v) => v.member_id));
  const want = new Set((ib.data || []).map((i) => i.member_id).filter((id) => !done.has(id)));
  return (await activeMembers(db, { trainees: true })).filter((m) => want.has(m.id));
}

// ---------------------------------------------------------------- 수습 주차 (common.js 와 같은 계산)
export function traineeWeekSat(start, n, pps = []) {
  const shift = pps.filter((p) => p.from_week <= n).reduce((s, p) => s + p.weeks, 0);
  return addDays(start, 7 * (n - 1 + shift));
}
// today가 속한 수습 주차 (쉬는 중이거나 범위 밖이면 0)
export function traineeWeekOn(start, pps, today) {
  if (!start) return 0;
  for (let n = 5; n >= 1; n--) {
    const s = traineeWeekSat(start, n, pps);
    if (s <= today) return today < addDays(s, 7) ? n : 0;
  }
  return 0;
}
