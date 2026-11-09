-- =====================================================================
--  032 — v33: 실연주 구간 기준 정리 (메들리를 편집자마다 다르게 나눠서 생기는 오차)
--  · video_songs.seg     : solo(그 곡만) · medley(한 구간에 여러 곡) · split(메들리를 곡마다 나눈 구간)
--                          · unsure(콘티 다음 곡이 이 구간에 섞였을 수 있음) · odd(레퍼런스 길이의 0.5배 미만 · 1.5배 초과)
--                          → 곡 실연주 시간에는 solo만 써요. 재생 위치는 그대로
--  · video_songs.grp     : 메들리 묶음 (콘티 순서대로 '곡id+곡id')
--  · video_songs.grp_sec : 그 묶음 전체 시간 (첫 곡 시작 ~ 마지막 곡 끝) → 메들리 실연주
--  · video_sync.rule_ver : 맞추기 규칙 버전. 새 규칙이면 다음 cron에서 저장된 영상을 모두 다시 맞춰요
--  migration_031 다음에 SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 괜찮아요.
-- =====================================================================

alter table public.video_songs add column if not exists seg text not null default 'solo';
alter table public.video_songs add column if not exists grp text;
alter table public.video_songs add column if not exists grp_sec int;
alter table public.video_songs drop constraint if exists video_songs_seg_check;
alter table public.video_songs add constraint video_songs_seg_check check (seg in ('solo', 'medley', 'split', 'unsure', 'odd'));
alter table public.video_songs drop constraint if exists video_songs_grp_check;
alter table public.video_songs add constraint video_songs_grp_check check (grp is null or grp ~ '^[0-9]+(\+[0-9]+)+$');
alter table public.video_songs drop constraint if exists video_songs_grp_sec_check;
alter table public.video_songs add constraint video_songs_grp_sec_check check (grp_sec is null or grp_sec between 1 and 86400);
-- 예전 규칙으로 저장된 메들리 행은 일단 medley로 (다시 맞추기 전에도 곡 시간에서 빠지게)
update public.video_songs set seg = 'medley' where medley and seg = 'solo';

alter table public.video_sync add column if not exists rule_ver int not null default 0;

-- 화면용: songs 끝에 구간 종류 · 메들리 묶음 · 묶음 시간을 더해요
--   songs : [영상 id, 곡 id, 시작 초, 끝 초, 메들리, 위치 앎, 구간 종류, 묶음, 묶음 시간]
create or replace function public.video_bundle()
returns json
language sql
stable
security invoker
set search_path = public
as $$
  select case when not public.is_member() then null else json_build_object(
    'videos', coalesce((select json_agg(json_build_array(v.id, v.service_date, v.duration_sec, v.title, v.linked_at,
                 exists (select 1 from public.video_songs x where x.video_id = v.id and x.located)) order by v.service_date)
               from public.worship_videos v where v.status = 'linked' and v.service_date is not null), '[]'::json),
    'songs', coalesce((select json_agg(json_build_array(x.video_id, x.song_id, x.start_sec, x.end_sec, x.medley, x.located, x.seg, x.grp, x.grp_sec))
               from public.video_songs x join public.worship_videos v on v.id = x.video_id and v.status = 'linked'), '[]'::json)
  ) end;
$$;
revoke all on function public.video_bundle() from public, anon;
grant execute on function public.video_bundle() to authenticated;
