\set ON_ERROR_STOP 0
\set i1 '''backup/11111111-1111-1111-1111-111111111111.jpg'''
\set i2 '''backup/22222222-2222-2222-2222-222222222222.jpg'''
\set i3 '''backup/33333333-3333-3333-3333-333333333333.jpg'''
insert into members values ('00000000-0000-0000-0000-00000000000a','리더','admin'),('00000000-0000-0000-0000-00000000000b','인도자','member'),('00000000-0000-0000-0000-00000000000c','팀원','member');
insert into backup_books (label, active) values ('ver1', true);
insert into backup_songs (book_id, code, title, page) values (1, 'g40', '악보집 곡', 3);
insert into backup_songs (book_id, code, title, images) values (null, 'x1', '사진 곡', array[:i1, :i2]), (null, 'x2', '둘째 곡', array[:i3]);
insert into ink_extra (target, ver, page, cid) values ('b:x1','c2',1,'a1111111'),('b:x1','c2',2,'a2222222'),('b:x2','c3',1,'b1111111');
insert into backup_bpm values ('x1', 72), ('x2', 80);
update backup_live set candidates = '{2,3}', pub_candidates = '{2,3}';
\i /tmp/m031.sql
\i /tmp/m031.sql
set role authenticated;
set request.uid = '00000000-0000-0000-0000-00000000000c';
select '팀원 고치기(막힘)'; select backup_edit_custom(2, '새', null, null, null, null);
set request.uid = '00000000-0000-0000-0000-00000000000b';
select '악보집 곡(막힘)'; select backup_edit_custom(1, '새', null, null, null, null);
select '코드 겹침(막힘)'; select backup_edit_custom(2, '사진 곡', 'g', 4, 'g40', null);
select '빈 이름(막힘)'; select backup_edit_custom(2, '  ', null, null, null, null);
-- 이름 · 키 · 주제 · 코드 바꾸기 → 필기 · BPM이 g41로
select 'edit: ' || (backup_edit_custom(2, ' 사진 곡2 ', 'g', 4, 'G41', null) ->> 'code');
select 'ink moved = 2: ' || count(*) from ink_extra where target = 'b:g41' and ver = 'c2';
select 'bpm moved: ' || string_agg(code || '=' || bpm, ',' order by code) from backup_bpm;
-- 코드 비우면 그대로
select 'keep code: ' || (backup_edit_custom(2, '사진 곡2', 'g', 4, '', null) ->> 'code');
-- 뒤에 이어 붙이기 (앞 2쪽 사진 그대로) → 필기 2개 그대로
select 'append pages: ' || (backup_edit_custom(2, '사진 곡2', 'g', 4, null, array[:i1, :i2, :i3]) ->> 'pages');
select 'ink after append = 2: ' || count(*) from ink_extra where target = 'b:g41';
-- 2쪽만 바꾸기 → 2쪽 필기만 지워짐
select 'replace p2: ' || (backup_edit_custom(2, '사진 곡2', 'g', 4, null, array[:i1, :i3]) ->> 'pages');
select 'ink after replace = 1(page1): ' || string_agg(page::text, ',') from ink_extra where target = 'b:g41';
select '사진 13장(막힘)'; select backup_edit_custom(2, 'a', null, null, null, array_fill(:i1::text, array[13]));
select '잘못된 경로(막힘)'; select backup_edit_custom(2, 'a', null, null, null, array['other/x.jpg']);
-- 지우기: 기도회 중 후보면 막힘
reset role; update backup_live set active = true; set role authenticated;
select '기도회 중 지우기(막힘)'; select backup_delete_custom(3);
reset role; update backup_live set active = false; set role authenticated;
select 'delete: ' || (backup_delete_custom(3) ->> 'candidates');
select 'pub after delete = {2}: ' || pub_candidates::text from backup_live;
select 'song gone: ' || count(*) from backup_songs where id = 3;
select 'ink gone = 0: ' || count(*) from ink_extra where target = 'b:x2';
select 'bpm left: ' || string_agg(code, ',') from backup_bpm;
select '악보집 곡 지우기(막힘)'; select backup_delete_custom(1);
set request.uid = '00000000-0000-0000-0000-00000000000c';
select '팀원 지우기(막힘)'; select backup_delete_custom(2);

-- 예배 영상 (A) · 실연주 출처 (C)
reset role;
insert into songs values (1, '은혜'), (2, '주 품에');
insert into setlist_items (song_id, duration_src) values (1, 'live');
select 'live 출처 저장: ' || count(*) from setlist_items where duration_src = 'live';
insert into worship_videos (id, title, service_date, status, duration_sec, linked_at) values ('VID00000001', 'a', '2026-08-30', 'linked', 1200, now()), ('VID00000002', 'b', '2026-09-06', 'review', 900, null);
insert into video_songs values ('VID00000001', 1, 180, 510, false, true), ('VID00000001', 2, 510, null, false, false), ('VID00000002', 1, 0, null, false, false);
insert into song_aliases (norm, song_id, label) values ('amazinggrace', 1, 'Amazing Grace');
select '잘못된 상태(막힘)'; insert into worship_videos (id, status) values ('VID00000009', 'weird');
select '잘못된 id(막힘)'; insert into worship_videos (id) values ('short');
set role authenticated;
set request.uid = '00000000-0000-0000-0000-00000000000c';
select 'bundle videos(연결만 1): ' || json_array_length(video_bundle() -> 'videos');
select 'bundle songs(연결 영상 곡 2): ' || json_array_length(video_bundle() -> 'songs');
select '팀원 별칭 읽기(0): ' || count(*) from song_aliases;
select '팀원 sync 읽기(0): ' || count(*) from video_sync;
select '팀원 쓰기(막힘)'; insert into worship_videos (id) values ('VID00000003');
set request.uid = '00000000-0000-0000-0000-00000000000a';
select '리더 별칭 읽기(1): ' || count(*) from song_aliases;
select 'sync 기본: ' || playlist || ' pending=' || pending from video_sync;
set request.uid = '';
select 'anon bundle null: ' || coalesce(video_bundle()::text, 'null');
reset role;
delete from songs where id = 2;
select '곡 지우면 위치도(1): ' || count(*) from video_songs where video_id = 'VID00000001';
reset role;
insert into worship_videos (id, status, skip_why) values ('VID0000000S', 'skipped', 'sermon');
select '설교 skip_why 저장: ' || count(*) from worship_videos where skip_why = 'sermon';
select '이상한 skip_why(막힘)'; insert into worship_videos (id, status, skip_why) values ('VID0000000T', 'skipped', 'weird');
insert into worship_videos (id, status, skip_why, dismissed) values ('VID0000000U', 'skipped', 'other', true);
select '시그널 other · dismissed 저장: ' || count(*) from worship_videos where skip_why = 'other' and dismissed;
