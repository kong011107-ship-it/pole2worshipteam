// 콘티 (022)
//  { action: "notify", service_id }  — 콘티를 올린(다시 올린) 사람이 부름 → 그 예배 섬김자에게 '올라옴' / '수정됨'
//      올린 버전마다 한 번만 (setlists.notified_version). 알림 설정에서 꺼 두면 알림함에만 남지 않고 건너뜀
//      023: 다시 올렸는데 악보만 바뀌었으면 알림 없이 '악보 바뀜'(sheet_changes)만 남김
//  { action: "yt", ids: [...] }        — 레퍼런스 영상 길이 (YouTube Data API · 환경변수 YOUTUBE_API_KEY). 한 번 가져오면 저장
//  { action: "yt-fill" }               — 리더십: 지난 기록의 레퍼런스 영상 길이를 한 번에 채움
import { adminClient, requireAdmin, requireMember, handler, HttpError } from "./_lib.js";
import { settingOf, fill, deliverOnce, serviceName } from "./_notify.js";

export default handler(async (req, body) => {
  const db = adminClient();
  if (body.action === "notify") return notify(req, db, body);
  if (body.action === "yt") { await requireMember(req, db); return { ...(await ytLookup(db, body.ids)) }; }
  if (body.action === "yt-fill") { await requireAdmin(req, db); return ytFill(db); }
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
  const kind = sl.notified_version > 0 ? "conti_edit" : "conti_up";
  const st = await settingOf(db, kind);
  const done = async () => { await db.from("setlists").update({ notified_version: sl.version }).eq("id", sl.id).lt("notified_version", sl.version); };
  if (!st.enabled) { await done(); return { skipped: true, recipients: 0, pushed: 0, kind }; }
  // 023: 다시 올렸는데 악보만 바뀌었으면 알림 없이 '악보 바뀜'만
  const txt = [].concat(sl.changes?.text || []);
  if (kind === "conti_edit" && txt.length && txt.every((t) => t === "악보 PDF 교체")) {
    await db.from("setlists").update({ sheet_changes: { at: new Date().toISOString(), by: me.name } }).eq("id", sl.id);
    await done(); return { skipped: true, sheetOnly: true, recipients: 0, pushed: 0, kind };
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
