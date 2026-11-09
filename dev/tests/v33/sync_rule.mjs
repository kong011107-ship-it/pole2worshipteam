// v33: 규칙 버전이 오르면 다음 cron에서 저장된 영상을 모두 다시 맞춤 (YouTube 안 부름) · 한 번만
//  v32 sync_video.mjs의 가짜 DB를 그대로 써요 (그 파일을 먼저 돌린 뒤 상태를 이어받지 않고 새로 만듦)
import { videoCron, RULE_VER } from "../../../api/_video.js";
let ok = 0, bad = 0;
const eq = (a, b, m) => { const s = JSON.stringify(a) === JSON.stringify(b); s ? ok++ : bad++; console.log(s ? "  ok " : "  BAD", m, s ? "" : `→ ${JSON.stringify(a)} (기대 ${JSON.stringify(b)})`); };
const T = { video_sync: [{ id: 1, pending: false, full_done: true, last_day: "2026-11-09", rule_ver: 32 }],
  worship_videos: [], video_songs: [], setlists: [], services: [], songs: [], song_aliases: [], setlist_items: [], song_refs: [], yt_videos: [] };
let fetched = 0;
globalThis.fetch = async () => { fetched++; throw new Error("YouTube를 부르면 안 돼요"); };
process.env.YOUTUBE_API_KEY = "k";
// 아주 작은 가짜 supabase (select · order · range · eq · in · maybeSingle · update · upsert · delete · insert)
const db = { from(t) {
  const q = { _t: t, _f: [], select() { return q; }, order() { return q; }, not() { return q; }, lte() { return q; },
    eq(c, v) { q._f.push((r) => r[c] === v); return q; }, in(c, vs) { q._f.push((r) => vs.includes(r[c])); return q; },
    range() { return Promise.resolve({ data: (T[t] || []).filter((r) => q._f.every((f) => f(r))), error: null }); },
    maybeSingle() { return Promise.resolve({ data: (T[t] || []).filter((r) => q._f.every((f) => f(r)))[0] || null, error: null }); },
    then(res, rej) { return Promise.resolve({ data: (T[t] || []).filter((r) => q._f.every((f) => f(r))), error: null }).then(res, rej); },
    update(v) { const u = { eq(c, x) { (T[t] || []).forEach((r) => { if (r[c] === x) Object.assign(r, v); }); return Promise.resolve({ error: null }); } }; return u; },
    upsert() { return Promise.resolve({ error: null }); }, insert() { return Promise.resolve({ error: null }); },
    delete() { return { in: () => Promise.resolve({ error: null }) }; } };
  return q;
} };
eq(RULE_VER, 33, "규칙 버전 33");
const r = await videoCron(db, { date: "2026-11-10", hour: 14 });
eq([!!r?.rematched, r?.rule, T.video_sync[0].rule_ver, fetched], [true, 33, 33, 0], "규칙이 바뀌면 YouTube 없이 전체 다시 맞추기 · 버전 표시");
eq(await videoCron(db, { date: "2026-11-10", hour: 15 }), null, "한 번만");
T.video_sync[0].rule_ver = 32; T.video_sync[0].pending = true;
const r2 = await videoCron(db, { date: "2026-11-10", hour: 16 }).catch((e) => ({ err: e.message }));
eq([!!r2?.rematched, T.video_sync[0].rule_ver], [false, 32], "처음 전체 맞추기가 덜 끝났으면 그쪽 먼저 (다시 맞추기는 미룸)");
console.log(`ok ${ok} bad ${bad}`);
process.exit(bad ? 1 : 0);
