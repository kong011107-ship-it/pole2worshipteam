-- v36 DB 시험 (스택: reset_stack.sh + migration_035) — psql -d wt -f db.sql
\set ON_ERROR_STOP 0
\pset footer off
-- 사람: A 관리자(기존 admin@x.com) · 일렉 E · 드럼 D · 싱어 S
insert into auth.users(id,email,password) values ('00000000-0000-0000-0000-0000000000e1','e1@x.com','x'),('00000000-0000-0000-0000-0000000000d1','d1@x.com','x'),('00000000-0000-0000-0000-0000000000c1','c1@x.com','x');
insert into members(id,name,email,role,main_position,must_change_password,phone) values
 ('00000000-0000-0000-0000-0000000000e1','일렉맨','e1@x.com','member','e_guitar',false,'010-1111-0001'),
 ('00000000-0000-0000-0000-0000000000d1','드럼맨','d1@x.com','member','drum',false,'010-1111-0002'),
 ('00000000-0000-0000-0000-0000000000c1','싱어맨','c1@x.com','member','singer',false,'010-1111-0003');
insert into services(id, service_date) values ('22222222-2222-2222-2222-222222222222', '2026-11-22') on conflict do nothing;
insert into worship_proc(kind,title,key) values ('blessing','축복송 테스트','G');
insert into service_extras(service_id,title) values ('22222222-2222-2222-2222-222222222222','특송');
select id as proc from worship_proc order by id desc limit 1 \gset
select id as extra from service_extras order by id desc limit 1 \gset
select id as song from songs order by id limit 1 \gset
select json_build_object('sub',id,'role','authenticated')::text as admjwt from members where email='admin@x.com' \gset

set role authenticated;
\echo == [1] 일렉: 진행곡 · 특별순서 · 곡 파트 악보 올리기
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}',false);
insert into part_sheets(proc_id,part,name,pages,path) values (:proc,'e_guitar','일렉 축복',1,'parts/p' || :proc || '/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.pdf') returning 'ok proc' r;
insert into part_sheets(extra_id,part,name,pages,path) values (:extra,'e_guitar','일렉 특송',1,'parts/x' || :extra || '/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2.pdf') returning 'ok extra' r;
insert into part_sheets(song_id,part,name,pages,path) values (:song,'e_guitar','일렉 곡',1,'parts/' || :song || '/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3.pdf') returning 'ok song' r;
\echo == [2] 거부: 두 곳 동시 · 경로가 다른 곳 · 남의 파트
insert into part_sheets(song_id,proc_id,part,name,pages,path) values (:song,:proc,'e_guitar','x',1,'parts/p' || :proc || '/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaab1.pdf');
insert into part_sheets(proc_id,part,name,pages,path) values (:proc,'e_guitar','x',1,'parts/x' || :proc || '/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaab2.pdf');
insert into part_sheets(proc_id,part,name,pages,path) values (:proc,'e_guitar','x',1,'parts/' || :proc || '/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaab3.pdf');
insert into part_sheets(proc_id,part,name,pages,path) values (:proc,'drum','x',1,'parts/p' || :proc || '/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaab4.pdf');
\echo == [3] 업로드 경로 권한 (true true true false)
select can_upload_object('parts/p12/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.pdf'), can_upload_object('parts/x3/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.pdf'), can_upload_object('parts/5/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.pdf'), can_upload_object('parts/q5/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.pdf');
\echo == [4] 고른 악보: 진행곡 · 곡 · 같은 곳 다시(upsert) → 2줄
insert into part_picks(service_id,proc_id,part_sheet_id) values ('22222222-2222-2222-2222-222222222222',:proc,(select id from part_sheets where proc_id=:proc limit 1)) on conflict (member_id,service_id,tgt) do update set part_sheet_id=excluded.part_sheet_id;
insert into part_picks(service_id,song_id,part_sheet_id) values ('22222222-2222-2222-2222-222222222222',:song,(select id from part_sheets where song_id=:song limit 1)) on conflict (member_id,service_id,tgt) do update set part_sheet_id=excluded.part_sheet_id;
insert into part_picks(service_id,proc_id,part_sheet_id) values ('22222222-2222-2222-2222-222222222222',:proc,(select id from part_sheets where proc_id=:proc limit 1)) on conflict (member_id,service_id,tgt) do update set part_sheet_id=excluded.part_sheet_id;
select tgt from part_picks order by tgt;
\echo == [5] 드럼은 일렉 파트 악보 0개, 일렉 3개
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}',false);
select count(*) drum_sees from part_sheets;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}',false);
select count(*) elec_sees from part_sheets;
\echo == [6] 진행곡을 지우면 그 파트 악보도 (관리자 아님 → postgres로)
reset role;
delete from worship_proc where id = :proc;
select count(*) left_after_proc_delete from part_sheets;   -- 2

\echo == [7] 익명 기도제목: 일렉이 자기 것 익명 · 드럼 것 대신 익명 · 싱어 것 이름으로
set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}',false);
insert into prayers(member_id,author_id,body,anon) values ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000e1','내 기도 익명',true),
 ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000e1','드럼 대신 익명',true),
 ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000e1','싱어 이름으로',false) returning id;
\echo == [8] 싱어가 표를 직접: member_id 거부 · id/body는 됨 · select * 거부
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}',false);
select member_id from prayers;
select count(*) n, count(*) filter (where anon) anon_n from prayers;
select * from prayers;
\echo == [9] 싱어 prayer_rows: 익명 둘은 member_id 비어 있고 mine=f, 자기 것은 보이고 mine=t
select body, member_id is not null shown, author_id is not null author_shown, mine from prayer_rows(null) order by id;
\echo == [10] 드럼: 대신 올린 익명(자기 것)은 보임
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}',false);
select body, member_id is not null shown, mine from prayer_rows(null) order by id;
\echo == [11] 일렉(올린 사람): 고치기 · 지우기 됨, 익명 바꾸기 거부
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}',false);
update prayers set body = '내 기도 익명 (고침)' where body = '내 기도 익명' returning id;
update prayers set anon = false where body = '드럼 대신 익명';
\echo == [12] 싱어: 남의 익명 글 고치기 0줄
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}',false);
update prayers set body = 'x' where anon returning id;
delete from prayers where anon returning id;
\echo == [13] 관리자: 모두 보임 · 숨기기 → 싱어에게 안 보임
select set_config('request.jwt.claims', :'admjwt', false);
select body, member_id is not null shown from prayer_rows(null) order by id;
update prayers set hidden_at = now() where body = '싱어 이름으로' returning id;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}',false);
select count(*) singer_sees_after_hide from prayer_rows(null);
\echo == [14] 양육 등급: 팀원 0줄 · 쓰기 거부, 관리자 읽기
reset role;
insert into nurture_grades(member_id, grade) values ('00000000-0000-0000-0000-0000000000c1','D');
set role authenticated;
select count(*) member_sees_grades from nurture_grades;
insert into nurture_grades(member_id, grade) values ('00000000-0000-0000-0000-0000000000d1','A');
select set_config('request.jwt.claims', :'admjwt', false);
select grade admin_sees from nurture_grades;
update nurture_grades set grade = 'A';
reset role;
select grade still_d from nurture_grades;
