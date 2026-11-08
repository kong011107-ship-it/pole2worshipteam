// v32: 재생목록 읽기 · 저장 · 다시 맞추기 · 리더십 action (가짜 DB + 가짜 YouTube) — api/_video.js · api/conti.js
import { syncPlaylist, rematch, videoCron, loadCtx } from "../../../api/_video.js";
let ok = 0, bad = 0;
const eq = (a, b, m) => { const s = JSON.stringify(a) === JSON.stringify(b); s ? ok++ : bad++; console.log(s ? "  ok " : "  BAD", m, s ? "" : `→ ${JSON.stringify(a)} (기대 ${JSON.stringify(b)})`); };

// ---- 아주 작은 가짜 supabase (쓰는 것만)
function fakeDb(T) {
  const pk = { worship_videos: ["id"], video_songs: ["video_id", "song_id"], song_aliases: ["norm"], video_sync: ["id"] };
  return { from(t) {
    const st = { f: [], op: "select", p: null, maybe: false, rg: null };
    const api = {
      select() { return api; }, order() { return api; },
      eq(k, v) { st.f.push((r) => r[k] === v); return api; }, in(k, vs) { st.f.push((r) => vs.includes(r[k])); return api; },
      lte(k, v) { st.f.push((r) => r[k] <= v); return api; }, range(a, b) { st.rg = [a, b]; return api; }, maybeSingle() { st.maybe = true; return api; },
      upsert(p) { st.op = "upsert"; st.p = [].concat(p); return api; }, insert(p) { st.op = "insert"; st.p = [].concat(p); return api; },
      update(p) { st.op = "update"; st.p = p; return api; }, delete() { st.op = "delete"; return api; },
      then(res) {
        T[t] = T[t] || [];
        const hit = (r) => st.f.every((f) => f(r));
        if (st.op === "upsert") st.p.forEach((x) => { const k = pk[t] || ["id"]; const i = T[t].findIndex((r) => k.every((c) => r[c] === x[c])); if (i >= 0) T[t][i] = { ...T[t][i], ...x }; else T[t].push({ ...x }); });
        if (st.op === "insert") st.p.forEach((x) => T[t].push({ ...x }));
        if (st.op === "update") T[t].forEach((r, i) => { if (hit(r)) T[t][i] = { ...r, ...st.p }; });
        if (st.op === "delete") T[t] = T[t].filter((r) => !hit(r));
        let rows = st.op === "select" ? T[t].filter(hit).map((r) => ({ ...r })) : null;
        if (rows && st.rg) rows = rows.slice(st.rg[0], st.rg[1] + 1);
        return Promise.resolve({ data: st.maybe ? rows?.[0] || null : rows, error: null }).then(res);
      } };
    return api;
  } };
}
// ---- 가짜 YouTube: 재생목록 3쪽(쪽마다 2개)
const VIDS = [
  ["V0000000001", "2026년 8월 30일 온누리교회 Pole2 대학부 주일예배 찬양", "00:00 : 찬양 List\n03:00 : 놀라우신 은혜\n08:30 : 주 품에\n찬양 인도자 : 김철수", "PT20M"],
  ["V0000000002", "25. 10.26 Pole2 대학부(온누리교회)_주일예배 찬양_놀라우신 은혜", "", "PT25M"],
  ["V0000000003", "Pole2 대학부 주일예배 찬양", "", "PT15M"],
  ["V0000000004", "2023년 1월 1일 주일예배", "", "PT10M"],
  ["V0000000005", "2026년 9월 6일 주일예배", "02:00 : 처음 듣는 곡\n06:00 : 놀라우신 은혜", "PT12M"],
  ["V0000000006", "Private video", "", ""],
];
let calls = [];
globalThis.fetch = async (url) => {
  calls.push(url);
  const u = new URL(url);
  if (u.pathname.endsWith("/playlistItems")) {
    const page = +(u.searchParams.get("pageToken") || 0), part = VIDS.slice(page * 2, page * 2 + 2);
    return { ok: true, json: async () => ({ items: part.map(([id, title, d]) => ({ snippet: { title, description: d, resourceId: { videoId: id } }, contentDetails: { videoId: id, videoPublishedAt: "2026-09-01T03:00:00Z" } })), nextPageToken: page < 2 ? String(page + 1) : undefined }) };
  }
  if (u.pathname.endsWith("/videos")) {
    const ids = u.searchParams.get("id").split(",");
    return { ok: true, json: async () => ({ items: VIDS.filter((v) => ids.includes(v[0])).map(([id, title, d, dur]) => ({ id, contentDetails: { duration: dur }, snippet: { title, description: d } })) }) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};
process.env.YOUTUBE_API_KEY = "k";
const T = {
  setlists: [{ id: 1, service_date: "2025-10-26", leaders: ["박민수"], service_id: null, status: "published" },
             { id: 2, service_date: "2026-08-30", leaders: ["김철수 전도사님"], service_id: null, status: "published" },
             { id: 3, service_date: "2026-09-06", leaders: ["이영희"], service_id: "m1", status: "published" },
             { id: 4, service_date: "2026-09-06", leaders: ["이영희"], service_id: "s1", status: "published" }],
  services: [{ id: "m1", ministry_id: 9 }, { id: "s1", ministry_id: null }],
  songs: [{ id: 1, title: "놀라우신 은혜" }, { id: 2, title: "주 품에" }, { id: 3, title: "새 곡" }],
  setlist_items: [{ setlist_id: 1, ord: 1, song_id: 1 }, { setlist_id: 2, ord: 1, song_id: 1 }, { setlist_id: 2, ord: 2, song_id: 2 },
                  { setlist_id: 4, ord: 1, song_id: 3 }, { setlist_id: 4, ord: 2, song_id: 1 }],
  song_aliases: [], worship_videos: [], video_songs: [], video_sync: [{ id: 1, playlist: "PL", page_token: null, pending: true, full_done: false }],
};
const db = fakeDb(T);
const ctx = await loadCtx(db);
eq(ctx.dates, ["2025-10-26", "2026-08-30", "2026-09-06"], "콘티 날짜 (사역 예배 콘티는 빼고)");
eq(ctx.setlists.get("2026-09-06").items.map((x) => x.song_id), [3, 1], "같은 날 주일 콘티를 씀");

// 시간 제한 0 → 한 쪽만 읽고 멈춤
let r = await syncPlaylist(db, { budgetMs: -1 });
eq([r.pages, r.added, r.done, T.video_sync[0].pending, T.video_sync[0].page_token], [1, 2, false, true, "1"], "나눠서: 한 쪽 읽고 다음 자리 남김");
r = await syncPlaylist(db, { budgetMs: 60000 });
eq([r.pages, r.added, r.done, T.video_sync[0].pending, T.video_sync[0].full_done], [2, 3, true, false, true], "이어서 끝까지 (Private video 빼고)");
const V = (id) => T.worship_videos.find((x) => x.id === id);
eq([V("V0000000001").status, V("V0000000001").duration_sec], ["linked", 1200], "제목 날짜 → 연결 · 길이");
eq(T.video_songs.filter((x) => x.video_id === "V0000000001").map((x) => [x.song_id, x.start_sec, x.end_sec]).sort(), [[1, 180, 510], [2, 510, 1200]], "곡 위치 저장");
eq([V("V0000000002").status, V("V0000000003").status, V("V0000000004").status], ["linked", "review", "skipped"], "제목 곡 확인 · 날짜 없음 → 확인 · 기간 밖 → 건너뜀");
eq([V("V0000000005").status, V("V0000000005").reasons], ["linked", ["songs"]], "못 맞춘 곡 → 연결 + 확인");
eq(!!V("V0000000006"), false, "비공개 영상은 저장 안 함");
const before = calls.length;
r = await syncPlaylist(db, { budgetMs: 60000, restart: true });
eq([r.added, calls.slice(before).some((u) => u.includes("/videos?"))], [0, false], "다시 읽어도 새 영상만 길이를 물어봄");

// 별칭 → 다시 맞추기 (YouTube를 다시 부르지 않음)
T.song_aliases.push({ norm: "처음듣는곡", song_id: 3 });
const n0 = calls.length;
r = await rematch(db, { recent: 36500 });
eq([V("V0000000005").reasons, calls.length - n0], [[], 0], "별칭 저장 뒤 다시 맞춤 · API 안 부름");
eq(T.video_songs.find((x) => x.video_id === "V0000000005" && x.song_id === 3)?.start_sec, 120, "별칭으로 곡 위치");
// 리더십이 날짜를 정함
Object.assign(V("V0000000003"), { pinned: true, service_date: "2026-08-30", status: "review" });
await rematch(db, { ids: ["V0000000003"] });
eq([V("V0000000003").status, V("V0000000003").date_src], ["linked", "manual"], "직접 정한 날짜 → 연결");
const la = V("V0000000001").linked_at;
await rematch(db, {});
eq(V("V0000000001").linked_at, la, "다시 맞춰도 처음 연결된 때는 그대로");

// cron: 5시가 아니면 · 이미 오늘 확인했으면 건너뜀
T.video_sync[0] = { ...T.video_sync[0], pending: false, last_day: null };
eq(await videoCron(db, { date: "2026-11-08", hour: 4 }), null, "cron: 5시 전에는 안 함");
r = await videoCron(db, { date: "2026-11-08", hour: 5 });
eq([!!r?.done, T.video_sync[0].last_day, !!r?.rematched], [true, "2026-11-08", true], "cron: 5시 · 하루 1번 · 끝나면 다시 맞춤");
eq(await videoCron(db, { date: "2026-11-08", hour: 6 }), null, "cron: 같은 날 다시 안 함");
T.video_sync[0].pending = true;
eq(!!(await videoCron(db, { date: "2026-11-08", hour: 7 })), true, "cron: 덜 끝났으면 다음 시간에 이어서");
delete process.env.YOUTUBE_API_KEY;
eq(await videoCron(db, { date: "2026-11-09", hour: 5 }), null, "cron: API 키가 없으면 조용히 건너뜀");
console.log(`ok ${ok} bad ${bad}`);
