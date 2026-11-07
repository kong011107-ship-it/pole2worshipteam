\set ON_ERROR_STOP 0
insert into members values ('00000000-0000-0000-0000-00000000000a','리더','admin'),('00000000-0000-0000-0000-00000000000b','밴드','member'),('00000000-0000-0000-0000-00000000000c','다른','member');
insert into setlists (status) values ('published'),('draft'),('published');
insert into sheet_versions (song_id, kind, name, path, created_by) values
 (10,'sheet','A','sheets/10/a.pdf','00000000-0000-0000-0000-00000000000a'),
 (11,'original','원본 B','originals/11/b.pdf','00000000-0000-0000-0000-00000000000b'),
 (12,'original','원본 C','originals/12/c.pdf','00000000-0000-0000-0000-00000000000b'),
 (12,'sheet','필기본 C','originals/12/c.pdf','00000000-0000-0000-0000-00000000000a');
update sheet_versions set base_id = 3 where id = 4;
-- 1번 콘티(올라옴): 10 악보, 11 없음, 12 통합본 쪽, 13 메들리 뒷곡 / 2번(임시): 원본 B 고름
insert into setlist_items values (1,1,10,1,null,false),(1,2,11,null,null,false),(1,3,12,null,3,false),(1,4,13,1,null,true),(2,1,11,2,null,false);
\i /tmp/m030.sql
\i /tmp/m030.sql
select 'sheet_told 1번 = {10,12}: ' || (select sheet_told::text from setlists where id = 1);
select 'sheet_told 2번(임시) = null: ' || coalesce((select sheet_told::text from setlists where id = 2), 'null');
select 'sheet_told 3번(곡 없음) = {}: ' || (select sheet_told::text from setlists where id = 3);
set role authenticated;
-- 다른 사람은 못 지움
set request.uid = '00000000-0000-0000-0000-00000000000c';
select public.edit_sheet(2, null, true);
-- 올린 사람(밴드): 임시 콘티에서만 고른 원본 B → 지워지고 그 칸은 악보 없이
set request.uid = '00000000-0000-0000-0000-00000000000b';
select 'B 지우기: ' || public.edit_sheet(2, null, true)::text;
-- 리더: 올라온 콘티에 쓰인 악보 A는 못 지움
set request.uid = '00000000-0000-0000-0000-00000000000a';
select public.edit_sheet(1, null, true);
-- 리더: 원본 C (필기본의 바탕) → 지우면 필기본은 남고 연결만 끊김
select 'C 지우기: ' || public.edit_sheet(3, null, true)::text;
select public.edit_sheet(4, '  ', false);
select 'rename: ' || public.edit_sheet(4, '새 이름', false)::text;
reset role;
select '남은 악보: ' || string_agg(id || ':' || name || ':base=' || coalesce(base_id::text,'-'), ', ' order by id) from sheet_versions;
select '임시 콘티 칸: sheet_id=' || coalesce(sheet_id::text, 'null') from setlist_items where setlist_id = 2;
