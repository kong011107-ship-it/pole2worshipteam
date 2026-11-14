// v36: 양육 출석 등급 가져오기 — 폴투 양육 플랫폼 /api/grades → 전화번호(숫자만)로 팀원과 맞춰서 nurture_grades에
//  · 환경변수: NURTURE_GRADES_URL (예: https://양육주소/api/grades) · NURTURE_SHARE_KEY (양육 쪽 GRADE_SHARE_KEY와 같은 값)
//  · 부르는 곳: api/cron.js (매일 새벽 5시) · api/members-bulk.js { action: "nurture-sync" } (리더십이 '지금 가져오기')
//  · 활동 중인 팀원(수습 포함)만 · 같은 번호에 등급이 둘 이상 다르면 맞추지 않고 '못 찾은 팀원'에 이유와 함께
export const nurtureReady = () => !!(String(process.env.NURTURE_GRADES_URL || "").trim() && String(process.env.NURTURE_SHARE_KEY || "").trim());
const digits = (v) => String(v || "").replace(/\D/g, "");
const ORDER = ["A", "B", "C", "D", "E"];

export async function nurtureSync(db, { by = null } = {}) {
  const url = String(process.env.NURTURE_GRADES_URL || "").trim(), key = String(process.env.NURTURE_SHARE_KEY || "").trim();
  const log = (o) => db.from("nurture_sync").upsert({ id: 1, synced_at: new Date().toISOString(), by_name: by, ...o });
  try {
    if (!url || !key) throw new Error("NURTURE_GRADES_URL · NURTURE_SHARE_KEY 환경변수가 없어요.");
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 15000);
    let r;
    try { r = await fetch(url, { headers: { "x-share-key": key }, signal: ac.signal }); }
    catch (e) { throw new Error(e.name === "AbortError" ? "양육 플랫폼이 15초 안에 답하지 않았어요." : "양육 플랫폼에 연결하지 못했어요."); }
    finally { clearTimeout(t); }
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) throw new Error("양육 플랫폼이 키를 받지 않았어요. 양쪽 키 값이 같은지 확인해 주세요.");
    if (!r.ok) throw new Error(`양육 플랫폼 오류(${r.status}): ${j.error || "알 수 없음"}`);
    // 번호 → 등급들
    const byPhone = new Map();
    for (const p of [].concat(j.people || [])) {
      const ph = digits(p.phone), g = String(p.grade || "").toUpperCase();
      if (ph.length < 9 || !ORDER.includes(g)) continue;
      if (!byPhone.has(ph)) byPhone.set(ph, new Set());
      byPhone.get(ph).add(g);
    }
    const [{ data: ms, error: e1 }, { data: old, error: e2 }] = await Promise.all([
      db.from("members").select("id, name, phone").eq("is_active", true),
      db.from("nurture_grades").select("member_id, grade, prev_grade, changed_at"),
    ]);
    if (e1 || e2) throw new Error((e1 || e2).message);
    const O = new Map((old || []).map((x) => [x.member_id, x]));
    const now = new Date().toISOString(), rows = [], missing = [];
    for (const m of ms || []) {
      const gs = byPhone.get(digits(m.phone));
      if (!gs) { missing.push({ id: m.id, name: m.name }); continue; }
      if (gs.size > 1) { missing.push({ id: m.id, name: m.name, why: "같은 번호에 등급이 여럿" }); continue; }
      const g = [...gs][0], o = O.get(m.id);
      rows.push(!o ? { member_id: m.id, grade: g, prev_grade: null, changed_at: now, synced_at: now }
        : o.grade === g ? { member_id: m.id, grade: g, prev_grade: o.prev_grade, changed_at: o.changed_at, synced_at: now }
        : { member_id: m.id, grade: g, prev_grade: o.grade, changed_at: now, synced_at: now });
    }
    if (rows.length) { const { error } = await db.from("nurture_grades").upsert(rows); if (error) throw new Error(error.message); }
    // 이번에 못 맞춘 사람의 예전 등급은 지워요 (번호가 바뀌었거나 양육 명단에서 빠졌으면 낡은 등급이라)
    const keep = new Set(rows.map((x) => x.member_id)), drop = (old || []).map((x) => x.member_id).filter((id) => !keep.has(id));
    if (drop.length) await db.from("nurture_grades").delete().in("member_id", drop);
    missing.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    await log({ ok: true, matched: rows.length, missing, error: null });
    return { ok: true, matched: rows.length, missing: missing.length, changed: rows.filter((x) => x.changed_at === now && x.prev_grade).length };
  } catch (e) {
    try { await log({ ok: false, error: e.message || String(e) }); } catch {}
    throw e;
  }
}
