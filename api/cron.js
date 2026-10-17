// 예약 알림 — Supabase pg_cron이 매시 정각에 부름 (cron_012.sql)
//  · 마감 임박: 월말 응답 · 따로 받는 사역 응답 · 연습 시간 취합 — 아직 안 끝낸 사람에게
//  · 수습 기록 차례: 그 주차 기록이 비어 있으면 나눔 리더(없으면 리더십)에게
//  보낼지는 '공지 · 알림 › 알림 설정'의 시간을 보고 정함. 같은 알림은 한 번만.
import { adminClient } from "./_lib.js";
import { settingOf, fill, deliver, wasSent, markSent, kstNow, addDays, mdw, monthLabel, RELDAY, admins, activeMembers, prayerWeekOf,
  pendingForMonth, pendingForMinistry, pollPeople, votePending, traineeWeekOn } from "./_notify.js";

export default async function cron(req, res) {
  try {
    const secret = process.env.CRON_SECRET;
    const key = req.headers?.["x-cron-key"] || req.query?.key || "";
    if (!secret) return res.status(500).json({ error: "CRON_SECRET 환경변수가 없어요." });
    if (key !== secret) return res.status(401).json({ error: "unauthorized" });
    // 로컬 테스트에서만 시간을 바꿔 볼 수 있음
    const override = process.env.PUSH_SINK ? (req.query?.now || req.body?.now) : null;
    const now = kstNow(override);
    const db = adminClient();
    const out = { at: `${now.date} ${now.hour}:00 KST`, sent: [] };

    // ---------- 마감 임박
    const rm = await settingOf(db, "remind");
    const plan = rm.enabled ? [].concat(rm.schedule || []).slice(0, 2).filter((x) => Number.isInteger(x?.days) && Number.isInteger(x?.hour) && x.hour === now.hour) : [];
    if (plan.length) {
      const deadlines = [];
      const [mo, sep, pol] = await Promise.all([
        db.from("availability_months").select("*").eq("is_open", true).not("deadline", "is", null),
        db.from("ministries").select("*, services(id, service_date), ministry_practices(id, practice_date, service_id)").eq("response_mode", "separate").eq("response_open", true).not("response_deadline", "is", null),
        db.from("ministries").select("*, services(id, service_date)").eq("poll_open", true).not("poll_deadline", "is", null),
      ]);
      (mo.data || []).forEach((x) => deadlines.push({ type: "month", id: x.month, dl: x.deadline, what: `${monthLabel(x.month)} 섬김 응답`, x }));
      (sep.data || []).forEach((x) => deadlines.push({ type: "min", id: x.id, dl: x.response_deadline, what: `${x.name} 섬김 응답`, x }));
      (pol.data || []).forEach((x) => deadlines.push({ type: "poll", id: x.id, dl: x.poll_deadline, what: `${x.name} 연습 시간`, x }));
      // 016: 공지 투표 — 아직 안 끝난 것만 (마감 시각이 지나면 보내지 않음)
      const at = override ? new Date(override) : new Date();
      const { data: vts } = await db.from("polls").select("id, question, deadline, closed_at, notification_id").is("closed_at", null).not("notification_id", "is", null).gt("deadline", at.toISOString());
      (vts || []).forEach((x) => deadlines.push({ type: "vote", id: x.id, dl: kstNow(x.deadline).date, what: `투표 '${x.question.length > 20 ? x.question.slice(0, 20) + "…" : x.question}'`, x }));
      for (const d of deadlines) for (const p of plan) {
        if (addDays(d.dl, -p.days) !== now.date) continue;
        const sentKey = `remind:${d.type}:${d.id}:${d.dl}:${p.days}`;
        if (await wasSent(db, sentKey)) continue;
        let list;
        if (d.type === "month") list = (await pendingForMonth(db, d.id, now.date)).map(({ m, left }) => ({ m, left: `${left}개 남았어요` }));
        else if (d.type === "min") list = (await pendingForMinistry(db, d.x, now.date)).map(({ m, left }) => ({ m, left: `${left}개 남았어요` }));
        else if (d.type === "vote") list = (await votePending(db, d.x)).map((m) => ({ m, left: "아직 투표하지 않았어요" }));
        else list = (await pollPeople(db, d.x)).pending.map((m) => ({ m, left: "연습 시간을 아직 안 골랐어요" }));
        const vars = { "마감일": RELDAY[p.days] || mdw(d.dl), "무엇": d.what };
        const r = await deliver(db, { kind: "remind", sentKey,
          items: list.map(({ m, left }) => { const v = { ...vars, "남은 것": left, "이름": m.name }; return { member_id: m.id, title: fill(rm.title, v), body: fill(rm.body, v) }; }),
          url: d.type === "vote" ? `/me.html#alerts/${d.x.notification_id}` : `/me.html#respond/${d.type === "poll" ? "poll:all" : d.type + ":" + d.id}`, label: `${d.what} 마감 ${p.days ? p.days + "일 전" : "당일"} · 미완료 ${list.length}명` });
        if (!list.length) await markSent(db, sentKey);
        out.sent.push({ kind: "remind", what: d.what, days: p.days, recipients: r.recipients, pushed: r.pushed });
      }
    }

    // ---------- 수습 기록 차례
    const tr = await settingOf(db, "trainee");
    const ts = tr.schedule || {};
    if (tr.enabled && ts.hour === now.hour && ts.dow === now.dow) {
      const [apps, pps, weeks, lead] = await Promise.all([
        db.from("applications").select("id, name, trainee_start").eq("stage", "trainee"),
        db.from("trainee_postpones").select("application_id, from_week, weeks"),
        db.from("trainee_weeks").select("application_id, week, leader_id, note"),
        admins(db),
      ]);
      for (const a of apps.data || []) {
        const w = traineeWeekOn(a.trainee_start, (pps.data || []).filter((p) => p.application_id === a.id), now.date);
        if (!w) continue;
        const row = (weeks.data || []).find((x) => x.application_id === a.id && x.week === w);
        if (row?.note && row.note.trim()) continue;
        const sentKey = `trainee:${a.id}:${w}`;
        if (await wasSent(db, sentKey)) continue;
        const to = row?.leader_id ? lead.filter((m) => m.id === row.leader_id) : lead;
        const vars = { "수습생": a.name, "주차": String(w) };
        const r = await deliver(db, { kind: "trainee", sentKey,
          items: to.map((m) => ({ member_id: m.id, title: fill(tr.title, { ...vars, "이름": m.name }), body: fill(tr.body, { ...vars, "이름": m.name }) })),
          url: `/admin.html#app/${a.id}/week${w}`, label: `${a.name} ${w}주차 · ${row?.leader_id ? "나눔 리더" : "리더십"}` });
        out.sent.push({ kind: "trainee", who: a.name, week: w, recipients: r.recipients, pushed: r.pushed });
      }
    }
    // ---------- 기도 (015)
    const week = prayerWeekOf(now.date);
    let prayers = null;
    const weekPrayers = async () => prayers || (prayers = (await db.from("prayers").select("member_id").eq("week_of", week)).data || []);
    //  · 이번 주 기도제목이 올라왔어요: 정한 요일·시각부터 하루 안에, 기도제목이 있으면 한 번
    const pn = await settingOf(db, "prayer_new");
    const ps = pn.schedule || { dow: 6, hour: 21 };
    if (pn.enabled && Number.isInteger(ps.dow) && Number.isInteger(ps.hour)) {
      const day = addDays(week, (ps.dow - 6 + 7) % 7);
      const due = (now.date === day && now.hour >= ps.hour) || (now.date === addDays(day, 1) && now.hour < ps.hour);
      const key = `prayer_new:${week}`;
      if (due && (await weekPrayers()).length && !(await wasSent(db, key))) {
        const vars = { "인원": String(new Set(prayers.map((p) => p.member_id)).size), "개수": String(prayers.length) };
        const people = await activeMembers(db, { trainees: true });
        const r = await deliver(db, { kind: "prayer", sentKey: key, url: "/me.html#pray", label: `이번 주 기도제목 ${vars["개수"]}개 · 팀원 전체`,
          items: people.map((m) => ({ member_id: m.id, title: fill(pn.title, { ...vars, "이름": m.name }), body: fill(pn.body, { ...vars, "이름": m.name }) })) });
        out.sent.push({ kind: "prayer_new", recipients: r.recipients, pushed: r.pushed });
      }
    }
    //  · 주중 함께 기도: 정한 요일·시각에 이번 주 기도제목이 있으면
    const pr = await settingOf(db, "prayer_remind");
    const rs = pr.schedule || { days: [2, 4], hour: 20 };
    if (pr.enabled && [].concat(rs.days || []).includes(now.dow) && rs.hour === now.hour) {
      const key = `prayer_remind:${now.date}`;
      if ((await weekPrayers()).length && !(await wasSent(db, key))) {
        const vars = { "인원": String(new Set(prayers.map((p) => p.member_id)).size), "개수": String(prayers.length) };
        const people = await activeMembers(db, { trainees: true });
        const r = await deliver(db, { kind: "prayer", sentKey: key, url: "/me.html#pray", label: `함께 기도 · 기도제목 ${vars["개수"]}개 · 팀원 전체`,
          items: people.map((m) => ({ member_id: m.id, title: fill(pr.title, { ...vars, "이름": m.name }), body: fill(pr.body, { ...vars, "이름": m.name }) })) });
        out.sent.push({ kind: "prayer_remind", recipients: r.recipients, pushed: r.pushed });
      }
    }
    res.status(200).json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
}
