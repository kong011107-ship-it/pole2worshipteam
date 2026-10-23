// 콘티 (022)
//  { action: "notify", service_id }  — 콘티를 올린(다시 올린) 사람이 부름 → 그 예배 섬김자에게 '올라옴' / '수정됨'
//      올린 버전마다 한 번만 (setlists.notified_version). 알림 설정에서 꺼 두면 알림함에만 남지 않고 건너뜀
//      023: 다시 올렸는데 악보만 바뀌었으면 알림 없이 '악보 바뀜'(sheet_changes)만 남김
//  { action: "yt", ids: [...] }        — 레퍼런스 영상 길이 (YouTube Data API · 환경변수 YOUTUBE_API_KEY). 한 번 가져오면 저장
//  { action: "yt-fill" }               — 리더십: 지난 기록의 레퍼런스 영상 길이를 한 번에 채움
//  025: 지난 예배 콘티를 고치면 알림 없음 · BPM만 바뀌면 알림 없음
//  { action: "share", t }              — 섬김이 팀 공유 링크 (로그인 없음): 다가오는 예배 콘티 · 악보(서명된 주소) · 적용찬양 · 예배 진행곡 · 공유 필기 · 백업찬양
//  { action: "share-live", t }         — 공유 링크: 백업찬양 지금 · 다음 곡과 콘티 버전만 (몇 초마다)
import { adminClient, requireAdmin, requireMember, handler, HttpError } from "./_lib.js";
import { settingOf, fill, deliverOnce, serviceName } from "./_notify.js";

export default handler(async (req, body) => {
  const db = adminClient();
  if (body.action === "notify") return notify(req, db, body);
  if (body.action === "yt") { await requireMember(req, db); return { ...(await ytLookup(db, body.ids)) }; }
  if (body.action === "yt-fill") { await requireAdmin(req, db); return ytFill(db); }
  if (body.action === "share") return share(db, body);
  if (body.action === "share-live") return shareLive(db, body);
  throw new HttpError(400, "알 수 없는 요청이에요.");
});

async function notify(req, db, body) {
  const { me } = await requireMember(req, db);
  const sid = String(body.service_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(sid)) throw new HttpError(400, "예배를 찾을 수 없어요.");
  const { data: s } = await db.from("services").select("id, service_date, ministry_id, label, status, ministries(name), assignments(member_id, position_code, is_band_master)").eq("id", sid).maybeSingle();
  if (!s) throw new HttpError(404, "예배를 찾을 수 없어요.");
  const mine = (s.assignments || []).some((a) => a.member_id === me.id && (a.position_code === "leader" || a.is_band_master));
  if (me.role !== "admin" && !mine) throw new HttpError(403, "이 예배의 콘티를 올린 사람이 아니에요.");
  const { data: sl } = await db.from("setlists").select("id, status, version, notified_version, changes, setlist_items(ord, songs(title))").eq("service_id", sid).maybeSingle();
  if (!sl || sl.status !== "published") throw new HttpError(400, "아직 올라온 콘티가 없어요.");
  if (sl.version <= sl.notified_version) return { skipped: true, recipients: 0, pushed: 0 };
  // 025: 지난 예배는 고쳐도 알림 없음 (기록 바로잡기)
  if (s.service_date < kstToday()) { await db.from("setlists").update({ notified_version: sl.version }).eq("id", sl.id).lt("notified_version", sl.version); return { skipped: true, past: true, recipients: 0, pushed: 0 }; }
  const kind = sl.notified_version > 0 ? "conti_edit" : "conti_up";
  const st = await settingOf(db, kind);
  const done = async () => { await db.from("setlists").update({ notified_version: sl.version }).eq("id", sl.id).lt("notified_version", sl.version); };
  if (!st.enabled) { await done(); return { skipped: true, recipients: 0, pushed: 0, kind }; }
  // 023: 다시 올렸는데 악보만 바뀌었으면 알림 없이 '악보 바뀜'만
  const txt = [].concat(sl.changes?.text || []);
  //  025: BPM만 바뀐 때도 알림 없음
  if (kind === "conti_edit" && txt.length && txt.every((t) => t === "악보 PDF 교체" || t === "BPM 수정")) {
    if (txt.includes("악보 PDF 교체")) await db.from("setlists").update({ sheet_changes: { at: new Date().toISOString(), by: me.name } }).eq("id", sl.id);
    await done(); return { skipped: true, sheetOnly: txt.includes("악보 PDF 교체"), bpmOnly: !txt.includes("악보 PDF 교체"), recipients: 0, pushed: 0, kind };
  }
  const { count: sibs } = s.ministry_id ? await db.from("services").select("id", { count: "exact", head: true }).eq("ministry_id", s.ministry_id) : { count: 1 };
  const name = serviceName(s, (sibs || 1) > 1);
  const songs = (sl.setlist_items || []).sort((a, b) => a.ord - b.ord).map((x) => x.songs?.title).filter(Boolean);
  const changed = [].concat(sl.changes?.text || []).join(" · ") || "콘티가 바뀌었어요";
  const ids = [...new Set((s.assignments || []).map((a) => a.member_id).filter((id) => id && id !== me.id))];
  const { data: people } = ids.length ? await db.from("members").select("id, name").in("id", ids).eq("is_active", true) : { data: [] };
  const vars = { "예배": name, "곡": songs.join(" · "), "바뀐 것": changed, "올린 사람": me.name };
  const r = await deliverOnce(db, `conti:${sl.id}:${sl.version}`, {
    kind: "conti", by: me.id, url: `/me.html#worship/${sid}`, label: `${name} 콘티 ${kind === "conti_edit" ? "수정" : "올림"} · 섬김자 ${people?.length || 0}명`,
    items: (people || []).map((m) => ({ member_id: m.id, title: fill(st.title, { ...vars, "이름": m.name }), body: fill(st.body, { ...vars, "이름": m.name }) })),
  });
  await done();
  return r ? { ...r, kind } : { skipped: true, recipients: 0, pushed: 0, kind };
}

// ---------------------------------------------------------------- YouTube 영상 길이
const YT = /^[A-Za-z0-9_-]{11}$/;
const isoSec = (d) => { const m = String(d || "").match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/); return m ? (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+(m[3] || 0)) * 60 + (+(m[4] || 0)) : null; };
async function fetchYT(ids) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key || !ids.length) return [];
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet&id=${part.join(",")}&key=${encodeURIComponent(key)}`);
    if (!r.ok) throw new HttpError(502, `YouTube에서 영상 정보를 가져오지 못했어요 (${r.status}). API 키를 확인해 주세요.`);
    const j = await r.json();
    const got = new Map((j.items || []).map((v) => [v.id, v]));
    // 지워졌거나 비공개인 영상도 '없음'으로 저장해서 다시 묻지 않음
    part.forEach((id) => { const v = got.get(id); out.push({ id, duration_sec: v ? isoSec(v.contentDetails?.duration) : null, title: v?.snippet?.title?.slice(0, 200) || null, fetched_at: new Date().toISOString() }); });
  }
  return out;
}
async function ytLookup(db, ids) {
  ids = [...new Set([].concat(ids || []).map(String))].filter((x) => YT.test(x)).slice(0, 50);
  const configured = !!process.env.YOUTUBE_API_KEY;
  if (!ids.length) return { videos: {}, configured };
  const { data: have } = await db.from("yt_videos").select("id, duration_sec, title").in("id", ids);
  const map = Object.fromEntries((have || []).map((v) => [v.id, v]));
  const missing = ids.filter((id) => !map[id]);
  if (missing.length && configured) {
    const rows = await fetchYT(missing);
    if (rows.length) await db.from("yt_videos").upsert(rows);
    rows.forEach((v) => (map[v.id] = v));
  }
  return { videos: map, configured };
}
async function ytFill(db) {
  if (!process.env.YOUTUBE_API_KEY) throw new HttpError(400, "YouTube API 키(YOUTUBE_API_KEY)가 아직 설정되지 않았어요. Vercel 환경변수에 넣은 뒤 다시 눌러 주세요.");
  const ids = new Set();
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from("setlist_items").select("refs").range(from, from + 999);
    (data || []).forEach((r) => (r.refs || []).forEach((x) => YT.test(x?.[0] || "") && ids.add(x[0])));
    if (!data || data.length < 1000) break;
  }
  const { data: sr } = await db.from("song_refs").select("youtube_id");
  (sr || []).forEach((r) => ids.add(r.youtube_id));
  const all = [...ids];
  const { data: have } = await db.from("yt_videos").select("id");
  const known = new Set((have || []).map((v) => v.id));
  const missing = all.filter((id) => !known.has(id)).slice(0, 1000);
  const rows = await fetchYT(missing);
  for (let i = 0; i < rows.length; i += 200) await db.from("yt_videos").upsert(rows.slice(i, i + 200));
  return { total: all.length, fetched: rows.length, found: rows.filter((r) => r.duration_sec !== null).length, left: Math.max(0, all.length - known.size - rows.length) };
}

// ---------------------------------------------------------------- 025: 섬김이 팀 공유 링크 (로그인 없음 · 보기만)
//  라인업 · 멤버 정보 · 내 메모 · 고치기는 보내지 않아요
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const addDaysISO = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
const PROC_ORDER = ["blessing", "communion", "communion2", "offering", "benediction", "entrance"];
async function linkOf(db, t) {
  if (!TOKEN.test(String(t || ""))) throw new HttpError(404, "링크를 찾을 수 없어요.");
  const { data } = await db.from("share_links").select("id, label, active, last_seen_at").eq("token", t).maybeSingle();
  if (!data || !data.active) throw new HttpError(404, "끊긴 링크예요. 리더십에게 새 링크를 받아 주세요.");
  if (!data.last_seen_at || Date.now() - Date.parse(data.last_seen_at) > 10 * 60e3) await db.from("share_links").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id);
  return data;
}
const fileOf = (p) => String(p || "").split("#")[0];
async function signAll(db, paths) {
  const list = [...new Set(paths.filter(Boolean).map(fileOf))];
  if (!list.length) return {};
  const { data, error } = await db.storage.from("sheets").createSignedUrls(list, 6 * 3600);
  if (error) throw new HttpError(502, "악보 주소를 만들지 못했어요.");
  return Object.fromEntries((data || []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]));
}
async function share(db, body) {
  const link = await linkOf(db, body.t);
  const today = kstToday();
  const { data: svs } = await db.from("services").select("id, service_date, ministry_id, label, start_time, end_time, communion, sort_order, ministries(name)")
    .eq("status", "published").gte("service_date", today).lte("service_date", addDaysISO(today, 13))
    .order("service_date").order("start_time", { nullsFirst: true }).order("sort_order").limit(6);
  const ids = (svs || []).map((s) => s.id);
  const [sls, aps, procs] = await Promise.all([
    ids.length ? db.from("setlists").select("id, service_id, version, changes, sheet_changes, published_at, updated_at, status").in("service_id", ids).eq("status", "published") : { data: [] },
    ids.length ? db.from("applied_songs").select("id, service_id, ord, title, key, note, images").in("service_id", ids).order("ord") : { data: [] },
    db.from("worship_proc").select("id, kind, title, key, path, pages, images, start_date").order("start_date", { ascending: false }).order("id", { ascending: false }),
  ]);
  const slIds = (sls.data || []).map((x) => x.id);
  const { data: items } = slIds.length ? await db.from("setlist_items").select("setlist_id, ord, key, bpm, meter, medley, diff_key, join_prev, memo, sheet_id, songs(title, team_bpm, team_meter), sheet_versions(id, path, pages)").in("setlist_id", slIds).order("ord") : { data: [] };
  const sheetIds = [...new Set((items || []).map((x) => x.sheet_id).filter(Boolean))];
  const { data: inks } = sheetIds.length ? await db.from("sheet_ink").select("sheet_id, page, stroke, valid_from, deleted_from").in("sheet_id", sheetIds).order("id") : { data: [] };
  const procFor = (date, communion, special) => {
    const out = [];
    for (const k of PROC_ORDER) {
      if ((k === "communion" || k === "communion2") && !communion) continue;
      if (k === "entrance" && !special) continue;
      const x = (procs.data || []).find((p) => p.kind === k && p.start_date <= date);
      if (x) out.push(x);
    }
    return out;
  };
  const list = (svs || []).map((s) => {
    const communion = !s.ministry_id && (s.communion ?? +s.service_date.slice(8, 10) <= 7);
    const sl = (sls.data || []).find((x) => x.service_id === s.id);
    const its = sl ? (items || []).filter((x) => x.setlist_id === sl.id).map((x) => ({
      ord: x.ord, title: x.songs?.title || "", key: x.key, bpm: x.bpm ?? null, meter: x.meter || (x.bpm ? "4/4" : null), medley: x.medley, diff_key: !!x.diff_key, join_prev: !!x.join_prev, memo: x.memo,
      sheet: x.sheet_versions ? { id: x.sheet_versions.id, path: fileOf(x.sheet_versions.path), pages: x.sheet_versions.pages,
        ink: (inks || []).filter((k) => k.sheet_id === x.sheet_id && k.valid_from <= s.service_date && (!k.deleted_from || k.deleted_from > s.service_date)).map((k) => ({ page: k.page, ...k.stroke })) } : null,
    })) : [];
    return {
      id: s.id, date: s.service_date, title: s.ministry_id ? `${s.ministries?.name || "사역"}${s.label ? " · " + s.label : ""}` : "주일", ministry: !!s.ministry_id, start_time: s.start_time, communion,
      setlist: sl ? { version: sl.version, changes: sl.changes ? { text: sl.changes.text || [], at: sl.changes.at } : null, sheet_changes: sl.sheet_changes ? { at: sl.sheet_changes.at } : null, published_at: sl.published_at, updated_at: sl.updated_at, items: its } : null,
      applied: (aps.data || []).filter((a) => a.service_id === s.id).map((a) => ({ title: a.title, key: a.key, note: a.note, images: a.images })),
      proc: procFor(s.service_date, communion, !!s.ministry_id).map((p) => ({ kind: p.kind, title: p.title, key: p.key, path: p.path, pages: p.pages, images: p.images })),
    };
  });
  const backup = await backupFor(db);
  const urls = await signAll(db, [
    ...list.flatMap((s) => [...(s.setlist?.items || []).map((x) => x.sheet?.path), ...s.applied.flatMap((a) => a.images || []), ...s.proc.flatMap((p) => [p.path, ...(p.images || [])])]),
    backup.book?.path, ...backup.songs.flatMap((x) => x.images || []),
  ]);
  return { label: link.label, today, services: list, backup, urls };
}
async function backupFor(db) {
  const [{ data: lv }, { data: bk }] = await Promise.all([
    db.from("backup_live").select("active, candidates, now_ref, next_ref, seq, updated_at").eq("id", 1).maybeSingle(),
    db.from("backup_books").select("id, label, path, pages").eq("active", true).maybeSingle(),
  ]);
  const cands = (lv?.candidates || []).map(Number);
  const refs = [lv?.now_ref, lv?.next_ref].filter((r) => r && r.startsWith("b:")).map((r) => +r.slice(2));
  const want = [...new Set([...cands, ...refs])];
  const { data: songs } = want.length ? await db.from("backup_songs").select("id, book_id, code, title, key, page, pages, images").in("id", want) : { data: [] };
  return { active: !!lv?.active, now: lv?.active ? lv.now_ref : null, next: lv?.active ? lv.next_ref : null, seq: lv?.seq || 0, candidates: cands,
    book: bk ? { label: bk.label, path: bk.path, pages: bk.pages } : null, songs: (songs || []).filter((x) => !x.book_id || x.book_id === bk?.id) };
}
async function shareLive(db, body) {
  await linkOf(db, body.t);
  const today = kstToday();
  const [{ data: lv }, { data: svs }] = await Promise.all([
    db.from("backup_live").select("active, now_ref, next_ref, seq, candidates").eq("id", 1).maybeSingle(),
    db.from("services").select("id, setlists(version, status, sheet_changes)").eq("status", "published").gte("service_date", today).lte("service_date", addDaysISO(today, 13)),
  ]);
  const ver = (svs || []).map((s) => `${s.id}:${[].concat(s.setlists || []).filter((x) => x.status === "published").map((x) => `${x.version}${x.sheet_changes?.at || ""}`).join("")}`).sort().join(",");
  return { active: !!lv?.active, now: lv?.active ? lv.now_ref : null, next: lv?.active ? lv.next_ref : null, seq: lv?.seq || 0, candidates: (lv?.candidates || []).map(Number), ver };
}
