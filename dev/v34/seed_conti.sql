-- 11/15 주일 콘티 (올라옴) + 데모 팀원 김하늘(T)을 라인업에 보장
with s as (select id from services where service_date='2026-11-15' and ministry_id is null limit 1),
ins as (insert into setlists(service_date, leaders, source, service_id, status, version, notified_version, published_at, updated_at, target_sec, pages)
  select '2026-11-15', array['정사랑(T)'], 'platform', s.id, 'published', 1, 1, now() - interval '1 day', now() - interval '1 day', 1500, 14 from s returning id)
insert into setlist_items(setlist_id, ord, song_id, key, duration_sec, bpm, meter, join_prev, page_from, page_to)
select ins.id, v.ord, v.song, v.k, v.dur, v.bpm, '4/4', v.jp, v.pf, v.pt from ins, (values
 (1, 36, 'G', 245, 72, false, 1, 3), (2, 24, 'A', 210, 120, false, 4, 6), (3, 7, 'A', 190, 120, true, 7, 8), (4, 273, 'D', 310, 68, false, 9, 12), (5, 85, 'E', 275, null::int, false, 13, 14)) v(ord, song, k, dur, bpm, jp, pf, pt);
