// v31 단위 시험: 부분 지우개(cutStroke) · 처음 채워진 악보 알림(tellFilled)
import fs from "fs";
let ok = 0, bad = 0; const check = (c, m) => { c ? ok++ : bad++; console.log(c ? "  ok " : "  BAD", m); };
const root = new URL("../../../", import.meta.url).pathname;
// ---- ink.js 함수 꺼내기
const ink = fs.readFileSync(root + "assets/ink.js", "utf8");
const grab = (src, start, endMark) => { const i = src.indexOf(start); const j = src.indexOf(endMark, i); return src.slice(i, j); };
const code = grab(ink, "  const segDist", "\n  // 한 쪽(PDF") ;
const f = new Function(code + "; return { cutStroke, hits };")();
console.log("== 부분 지우개");
const st = { t: "p", c: "#000", w: 2, p: [0, 0, 100, 0, 200, 0], cid: "x", author: "a" };
const r1 = f.cutStroke(st, 100, 0, 10);
check(r1 && r1.length === 2, "가운데를 지우면 두 조각 " + JSON.stringify(r1?.map((q) => q.p)));
check(r1[0].p[0] === 0 && r1[0].p.at(-2) < 90 && r1[1].p[0] > 110 && r1[1].p.at(-2) === 200, "앞 조각은 0~89쯤, 뒤 조각은 111쯤~200");
check(r1.every((q) => q.t === "p" && q.c === "#000" && q.w === 2 && !("cid" in q) && !("author" in q)), "색 · 굵기 그대로, cid · 쓴 사람은 빼고");
check(r1[0].p.length <= 6 && r1[1].p.length <= 6, "점이 불어나지 않음 (원래 꼭짓점 + 끝점만)");
check(f.cutStroke(st, 100, 50, 10) === null, "안 닿으면 그대로(null)");
const r2 = f.cutStroke(st, 0, 0, 10);
check(r2.length === 1 && r2[0].p[0] > 10, "끝을 지우면 한 조각 (앞이 짧아짐)");
check(f.cutStroke({ ...st, p: [5, 5] }, 5, 5, 4).length === 0, "점 하나짜리 획은 통째로");
const big = f.cutStroke(st, 100, 0, 500);
check(big.length === 0, "다 덮으면 남는 것 없음");
const line = { t: "p", c: "#000", w: 2, p: [0, 0, 300, 300] };
const r3 = f.cutStroke(line, 150, 150, 10);
check(r3.length === 2, "직선(점 2개)도 가운데가 잘림");

// ---- api/conti.js tellFilled / sheetSongs
console.log("== 처음 채워진 악보 알림");
const api = fs.readFileSync(root + "api/conti.js", "utf8");
const body = grab(api, "function sheetSongs", "//  { action: \"sheet-notify\"");
const sent = [], updates = [];
const kstToday = () => "2026-11-07";
const settingOf = async () => ({ enabled: true, title: "{예배} 콘티가 수정됐어요", body: "{바뀐 것}" });
const fill = (t, v) => t.replace(/\{([^}]+)\}/g, (_, k) => v[k] ?? "");
const serviceName = () => "11월 15일 주일";
const deliverOnce = async (db, key, o) => { sent.push({ key, ...o }); return { recipients: o.items.length, pushed: o.items.length }; };
const db = { from(t) { const q = { _t: t, select() { return q; }, eq() { return q; }, in() { return q; }, update(v) { updates.push([t, v]); return q; },
  then(res) { return Promise.resolve(t === "members" ? { data: [{ id: "u2", name: "김밴드" }, { id: "u3", name: "이싱어" }] } : { data: null, count: 1 }).then(res); } }; return q; } };
const g = new Function("kstToday", "settingOf", "fill", "serviceName", "deliverOnce", body + "; return { sheetSongs, tellFilled };")(kstToday, settingOf, fill, serviceName, deliverOnce);
const s = { id: "s1", service_date: "2026-11-15", assignments: [{ member_id: "u1" }, { member_id: "u2" }, { member_id: "u3" }] };
const me = { id: "u1", name: "공준혁" };
const items = [{ ord: 1, song_id: 10, sheet_id: 5, join_prev: false, songs: { title: "은혜" } }, { ord: 2, song_id: 11, sheet_id: null, page_from: null, join_prev: false, songs: { title: "주님의 마음" } },
  { ord: 3, song_id: 12, sheet_id: null, page_from: 3, join_prev: false, songs: { title: "예수 피" } }, { ord: 4, song_id: 13, sheet_id: 9, join_prev: true, songs: { title: "메들리 뒷곡" } }];
const have = g.sheetSongs({ setlist_items: items });
check(JSON.stringify(have.map((x) => x.song_id)) === "[10,12]", "악보 있는 곡 = 저장된 악보 · 통합본 쪽 (메들리 뒷곡 빼고)");
let r = await g.tellFilled(db, s, { id: 9, sheet_told: [10], setlist_items: items }, have, me);
check(r && r.filled.join() === "예수 피" && r.recipients === 2, "새로 채워진 곡만 알림 · 올린 사람 빼고 " + JSON.stringify(r));
check(sent[0]?.items[0].body === "악보 올라옴: 예수 피" && sent[0].key === "conti-sheet:9:12", "알림 문구 · 중복 막는 키");
check(updates.some(([t, v]) => t === "setlists" && JSON.stringify(v.sheet_told) === "[10,12]"), "알린 곡 기록");
r = await g.tellFilled(db, s, { id: 9, sheet_told: [10, 12], setlist_items: items }, have, me);
check(r === null, "이미 알린 곡뿐이면 알림 없음 (악보만 바꾼 경우)");
updates.length = 0; sent.length = 0;
r = await g.tellFilled(db, s, { id: 9, sheet_told: null, setlist_items: items }, have, me);
check(r === null && !sent.length && updates.length === 1, "기록이 없던 예전 콘티는 지금 것을 기준으로 삼고 알리지 않음");
r = await g.tellFilled(db, { ...s, service_date: "2026-11-01" }, { id: 9, sheet_told: [], setlist_items: items }, have, me);
check(r && r.past && !sent.length, "지난 예배는 알림 없음");
console.log(`ok ${ok} bad ${bad}`);
