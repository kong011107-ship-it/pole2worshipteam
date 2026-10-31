\set ON_ERROR_STOP 0
insert into members values ('00000000-0000-0000-0000-00000000000a','관리자','admin','leader',true),
 ('00000000-0000-0000-0000-000000000001','일렉','member','e_guitar',true),
 ('00000000-0000-0000-0000-000000000002','드럼','member','drum',true),
 ('00000000-0000-0000-0000-000000000003','건반','member','key_main',true),
 ('00000000-0000-0000-0000-000000000004','인도','member','leader',true);
insert into member_extra_positions values ('00000000-0000-0000-0000-000000000003','e_guitar');
insert into services values ('11111111-1111-1111-1111-111111111111','2026-11-08');
insert into songs values (1,'A'),(2,'B');
insert into setlists(service_id,status,leaders) values ('11111111-1111-1111-1111-111111111111','draft','인도');
insert into perm values ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000004',true,true),('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000002',false,true);
grant select, insert, update on sheet_versions, ink_extra to authenticated;
set role authenticated;
\echo == my_parts
set request.uid = '00000000-0000-0000-0000-000000000003'; select my_parts();
set request.uid = '00000000-0000-0000-0000-00000000000a'; select my_parts();
set request.uid = '00000000-0000-0000-0000-000000000001'; select my_parts();
\echo == insert part sheet (elec user) ok, drum part by elec user denied
insert into part_sheets(song_id,part,name,pages,path) values (2,'e_guitar','일렉 B',2,'parts/2/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf') returning id, created_by, by_name;
insert into part_sheets(song_id,part,name,pages,path) values (2,'drum','드럼 B',1,'parts/2/bbbbbbbb-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf');
\echo == wrong song in path rejected
insert into part_sheets(song_id,part,name,pages,path) values (1,'e_guitar','x',1,'parts/2/cccccccc-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf');
\echo == visibility: drum sees 0, key(extra elec) sees 1, admin 1
set request.uid = '00000000-0000-0000-0000-000000000002'; select count(*) drum_sees from part_sheets;
set request.uid = '00000000-0000-0000-0000-000000000003'; select count(*) key_sees from part_sheets;
\echo == key user (not owner) cannot delete; update no rows
delete from part_sheets; select count(*) still from part_sheets;
\echo == ink_put t: by key user ok, page 3 rejected, drum rejected
select ink_put('11111111-1111-1111-1111-111111111111', 't:' || (select id from part_sheets limit 1), null, '{"add":[{"cid":"c1","page":2,"stroke":{"t":"p","c":"#000000","w":30,"p":[0.1,0.1,0.2,0.2]}}]}');
select ink_put('11111111-1111-1111-1111-111111111111', 't:' || (select id from part_sheets limit 1), null, '{"add":[{"cid":"c2","page":3,"stroke":{"t":"p","c":"#000000","w":30,"p":[0.1,0.1,0.2,0.2]}}]}');
set request.uid = '00000000-0000-0000-0000-000000000002';
select ink_put('11111111-1111-1111-1111-111111111111', 't:1', null, '{"add":[{"cid":"c3","page":1,"stroke":{"t":"p","c":"#000000","w":30,"p":[0.1,0.1,0.2,0.2]}}]}');
\echo == picks own row
set request.uid = '00000000-0000-0000-0000-000000000003';
insert into part_picks(service_id,song_id,part_sheet_id) values ('11111111-1111-1111-1111-111111111111',2,1) on conflict (member_id,service_id,song_id) do update set part_sheet_id=excluded.part_sheet_id;
select member_id, song_id from part_picks;
\echo == add_song_sheet: drum(band) on draft denied, leader ok, bad path denied
set request.uid = '00000000-0000-0000-0000-000000000002';
select add_song_sheet('11111111-1111-1111-1111-111111111111',1,null,'x','G','sheets/1/dddddddd-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf',1,100,null);
set request.uid = '00000000-0000-0000-0000-000000000004';
select add_song_sheet('11111111-1111-1111-1111-111111111111',1,null,'인도 G','G','sheets/1/dddddddd-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf',1,100,null)::jsonb ->> 'id' as new_id;
select add_song_sheet('11111111-1111-1111-1111-111111111111',1,null,'x','G','sheets/2/eeeeeeee-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf',1,100,null);
\echo == sheet_in_service: leader true (draft, added), drum false on draft
select sheet_in_service('11111111-1111-1111-1111-111111111111', (select max(id) from sheet_versions)) leader;
set request.uid = '00000000-0000-0000-0000-000000000002';
select sheet_in_service('11111111-1111-1111-1111-111111111111', (select max(id) from sheet_versions)) drum_draft;
reset role; update setlists set status='published'; set role authenticated; set request.uid = '00000000-0000-0000-0000-000000000002';
select sheet_in_service('11111111-1111-1111-1111-111111111111', (select max(id) from sheet_versions)) drum_pub_added;
select add_song_sheet('11111111-1111-1111-1111-111111111111',1,null,'밴드','G','sheets/1/ffffffff-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf',1,100,null)::jsonb ->> 'name' band_pub_add;
\echo == storage
select can_upload_object('parts/2/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaab.pdf') drum_upload_parts;
\echo == delete by owner cascades ink
set request.uid = '00000000-0000-0000-0000-000000000001'; delete from part_sheets where id=1; reset role; select count(*) ink_left from ink_extra where target='t:1';
