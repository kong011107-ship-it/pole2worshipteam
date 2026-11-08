-- =====================================================================
--  031 (v32) — 예배 영상 자동 연결 · 실제 연주 시간 · 백업찬양 직접 더한 곡 고치기
--  migration_030 다음에 SQL Editor에서 한 번 실행하세요. (다시 실행해도 안전)
--
--  A. 예배 영상 (YouTube 재생목록 'Pole2대학부' → 기록 탭 콘티)
--     · worship_videos : 영상 1개 = 그 주일 콘티 1개. 제목 · 설명란 원문 · 읽은 날짜 · 상태(linked | review | skipped)
--     · video_songs    : 영상 안 곡 위치 (설명란 마커 '03:51 : 놀라우신 은혜'). 마커 없는 영상은 located = false
--     · song_aliases   : 리더십이 직접 연결한 마커 이름 → 곡 (다음부터 자동으로 맞음)
--     · video_sync     : 마지막 확인 · 처음 전체 맞추기 진행 상태
--     읽기 · 맞추기는 서버(api/_video.js · 매시 cron 하루 1번)가 하고, 화면은 video_bundle()로 읽어요
--
--  B. 백업찬양: 직접 더한 곡 고치기 · 지우기
--  · backup_edit_custom: 곡 이름 · 키 · 주제 · 코드 · 악보 사진
--      코드를 바꾸면 그 곡의 공유 필기 · BPM도 새 코드로 옮겨요
--      사진을 바꾸면 같은 사진이 같은 자리에 남은 쪽의 필기만 남겨요 (뒤에 이어 붙이면 앞쪽 필기는 그대로)
--  · backup_delete_custom: 후보 · 확정 후보에서 빼고, 그 곡 공유 필기 · BPM과 함께 지워요
--      기도회 중 후보에 든 곡은 먼저 후보에서 빼야 지울 수 있어요
--  권한은 곡 더하기와 같아요: 리더십 · 어제부터 7일 안 예배의 인도자 (can_lead_backup)
--  악보집(PDF)에서 읽은 곡은 지금처럼 '곡 목록 고치기'에서 이름 · 숨기기만 해요
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. 예배 영상
-- ---------------------------------------------------------------------
create table if not exists public.worship_videos (
  id            text primary key check (id ~ '^[A-Za-z0-9_-]{11}$'),
  title         text not null default '' check (length(title) <= 300),
  description   text not null default '' check (length(description) <= 8000),
  published_at  timestamptz,                      -- 영상을 올린 때 (videoPublishedAt)
  duration_sec  int check (duration_sec between 0 and 86400),
  service_date  date,                             -- 맞춘 주일 (linked) · 추정 날짜 (review)
  date_src      text check (date_src in ('title', 'title-short', 'title-md', 'upload', 'manual')),
  status        text not null default 'review' check (status in ('linked', 'review', 'skipped')),
  reasons       text[] not null default '{}',     -- 확인할 것: date(날짜 애매) · songs(곡 이름 못 맞춤) · noconti(그날 콘티 없음) · kind(찬양 영상인지) · leader(인도자 다름, 참고용)
  skip_why      text,                             -- outside(콘티 기록 기간 밖) · noconti · manual(리더십이 넘김) · sermon(설교 영상) · other(시그널 · 특순 · 광고 등)
  marks         jsonb not null default '[]'::jsonb check (jsonb_typeof(marks) = 'array'),   -- [{t, label, songs:[id], skip}] 설명란에서 읽은 마커 + 맞춘 결과
  leaders_said  text[] not null default '{}',     -- 설명란 '찬양 인도자 : 이름 & 이름'
  pinned        boolean not null default false,   -- 리더십이 직접 날짜 · 상태를 정함 → 다시 맞출 때 날짜는 그대로
  dismissed     boolean not null default false,   -- 연결된 영상에서 '넘기기' → 못 맞춘 곡 이름을 다시 묻지 않음
  linked_at     timestamptz,                      -- 처음 연결된 때 ('예배 영상이 올라왔어요')
  checked_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
-- 다시 실행해도 최신 규칙으로 (설교 영상 'sermon' · 시그널 · 특순 등 'other' · 넘기기 dismissed)
alter table public.worship_videos add column if not exists dismissed boolean not null default false;
alter table public.worship_videos drop constraint if exists worship_videos_skip_why_check;
alter table public.worship_videos add constraint worship_videos_skip_why_check check (skip_why in ('outside', 'manual', 'noconti', 'sermon', 'other'));
create index if not exists worship_videos_date_idx on public.worship_videos (service_date) where status = 'linked';
create index if not exists worship_videos_status_idx on public.worship_videos (status);

create table if not exists public.video_songs (
  video_id   text not null references public.worship_videos(id) on delete cascade,
  song_id    bigint not null references public.songs(id) on delete cascade,
  start_sec  int not null default 0 check (start_sec between 0 and 86400),
  end_sec    int check (end_sec between 1 and 86400),
  medley     boolean not null default false,     -- 메들리 · 여러 곡이 한 마커 → 곡 시간 통계에서 빼요
  located    boolean not null default true,      -- false: 마커가 없어 곡 위치를 모름 (영상 처음부터)
  primary key (video_id, song_id),
  check (end_sec is null or end_sec > start_sec)
);
create index if not exists video_songs_song_idx on public.video_songs (song_id);

create table if not exists public.song_aliases (
  norm        text primary key check (length(norm) between 1 and 120),
  song_id     bigint not null references public.songs(id) on delete cascade,
  label       text check (length(label) <= 120),
  created_by  uuid references public.members(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.video_sync (
  id           int primary key default 1 check (id = 1),
  playlist     text not null default 'PLH1dfOmrHoct-UOzuYzLZiBOAyBiyycIj',
  page_token   text,                 -- 처음 전체 맞추기 · 하루 확인을 나눠서 할 때 이어 갈 자리
  pending      boolean not null default true,   -- 아직 끝까지 못 읽었으면 다음 시간에 이어서
  full_done    boolean not null default false,  -- 처음 전체 맞추기를 끝냈는지
  last_run     timestamptz,
  last_day     date,                 -- 하루 1번 확인한 날 (KST)
  last_result  jsonb
);
insert into public.video_sync (id) values (1) on conflict do nothing;

alter table public.worship_videos enable row level security;
alter table public.video_songs    enable row level security;
alter table public.song_aliases   enable row level security;
alter table public.video_sync     enable row level security;
drop policy if exists worship_videos_read on public.worship_videos;
drop policy if exists video_songs_read on public.video_songs;
drop policy if exists song_aliases_read on public.song_aliases;
drop policy if exists video_sync_read on public.video_sync;
create policy worship_videos_read on public.worship_videos for select using (public.is_member());
create policy video_songs_read on public.video_songs for select using (public.is_member());
create policy song_aliases_read on public.song_aliases for select using (public.is_admin());
create policy video_sync_read on public.video_sync for select using (public.is_admin());
grant select on public.worship_videos, public.video_songs, public.song_aliases, public.video_sync to authenticated;
-- 쓰기는 서버(service role)만: api/conti.js · api/cron.js

-- 화면용: 연결된 영상과 곡 위치를 한 번에
--   videos: [id, 주일, 길이, 제목, 처음 연결된 때, 마커 있음]
--   songs : [영상 id, 곡 id, 시작 초, 끝 초, 메들리, 위치 앎]
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
    'songs', coalesce((select json_agg(json_build_array(x.video_id, x.song_id, x.start_sec, x.end_sec, x.medley, x.located))
               from public.video_songs x join public.worship_videos v on v.id = x.video_id and v.status = 'linked'), '[]'::json)
  ) end;
$$;
revoke all on function public.video_bundle() from public, anon;
grant execute on function public.video_bundle() to authenticated;

-- 콘티 쓰기 예상 RT: 곡 시간 출처에 '실연주'(예배 영상 마커로 잰 중간값)를 더해요
alter table public.setlist_items drop constraint if exists setlist_items_duration_src_check;
alter table public.setlist_items add constraint setlist_items_duration_src_check check (duration_src in ('manual', 'team', 'video', 'medley', 'live'));

-- ---------------------------------------------------------------------
-- B. 백업찬양: 직접 더한 곡 고치기 · 지우기
-- ---------------------------------------------------------------------

-- 이 코드를 다른 곡(지금 악보집 곡 · 직접 더한 곡, 숨긴 곡 빼고)이 쓰고 있나
create or replace function public.backup_code_used(p_code text, p_except bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.backup_songs s left join public.backup_books b on b.id = s.book_id
                  where s.code = p_code and s.id <> coalesce(p_except, 0) and not s.hidden and (s.book_id is null or b.active));
$$;
revoke all on function public.backup_code_used(text, bigint) from public, anon, authenticated;

create or replace function public.backup_edit_custom(p_id bigint, p_title text, p_key text, p_topic int, p_code text, p_images text[] default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare o public.backup_songs; r public.backup_songs; c text := lower(trim(coalesce(p_code, '')));
        k text := nullif(lower(trim(coalesce(p_key, ''))), ''); imgs text[];
begin
  if not public.can_lead_backup() then raise exception '이번 주 인도자 · 리더십만 곡을 고칠 수 있어요.'; end if;
  select * into o from public.backup_songs where id = p_id for update;
  if o.id is null or o.book_id is not null then raise exception '직접 더한 곡을 찾을 수 없어요. 새로고침해 주세요.'; end if;
  if length(trim(coalesce(p_title, ''))) < 1 then raise exception '곡 이름을 적어 주세요.'; end if;
  if length(trim(p_title)) > 80 then raise exception '곡 이름은 80자까지예요.'; end if;
  if k is not null and k !~ '^[a-g]$' then raise exception '키를 다시 골라 주세요.'; end if;
  if p_topic is not null and (p_topic < 0 or p_topic > 9) then raise exception '주제를 다시 골라 주세요.'; end if;
  if c = '' then c := o.code; end if;
  if c !~ '^[a-z0-9+]{1,6}$' then raise exception '코드는 영문 소문자 · 숫자 6자까지예요.'; end if;
  if c <> o.code and public.backup_code_used(c, o.id) then raise exception '이미 있는 코드예요 (%).', c; end if;
  imgs := coalesce(p_images, o.images);
  if not public.paths_ok(imgs, 'backup/') then raise exception '악보 사진은 1~12장이에요.'; end if;

  update public.backup_songs set title = trim(p_title), key = k, topic = p_topic, code = c, images = imgs, pages = cardinality(imgs)
   where id = o.id returning * into r;

  -- 사진이 바뀐 쪽의 공유 필기는 지워요 (같은 사진이 같은 자리에 남은 쪽은 그대로)
  if imgs is distinct from o.images then
    delete from public.ink_extra x where x.target = 'b:' || o.code and x.ver = 'c' || o.id
       and (x.page > cardinality(imgs) or imgs[x.page] is distinct from o.images[x.page]);
  end if;
  -- 코드가 바뀌면 공유 필기 · BPM을 새 코드로 (BPM은 옛 코드를 다른 곡이 안 쓰고 새 코드에 아직 없을 때만)
  if c <> o.code then
    update public.ink_extra set target = 'b:' || c where target = 'b:' || o.code and ver = 'c' || o.id;
    if not public.backup_code_used(o.code, o.id) and not exists (select 1 from public.backup_bpm where code = c) then
      update public.backup_bpm set code = c where code = o.code;
    end if;
  end if;
  return row_to_json(r);
end;
$$;

create or replace function public.backup_delete_custom(p_id bigint)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare o public.backup_songs; L public.backup_live;
begin
  if not public.can_lead_backup() then raise exception '이번 주 인도자 · 리더십만 곡을 지울 수 있어요.'; end if;
  select * into o from public.backup_songs where id = p_id for update;
  if o.id is null or o.book_id is not null then raise exception '직접 더한 곡을 찾을 수 없어요. 새로고침해 주세요.'; end if;
  select * into L from public.backup_live where id = 1 for update;
  if L.active and (o.id = any (L.candidates) or L.now_ref = 'b:' || o.id or L.next_ref = 'b:' || o.id) then
    raise exception '기도회 중인 후보예요. 먼저 후보에서 빼 주세요.';
  end if;
  if L.id is not null and (o.id = any (L.candidates) or o.id = any (L.pub_candidates)) then
    update public.backup_live set candidates = array_remove(candidates, o.id), pub_candidates = array_remove(pub_candidates, o.id),
           seq = seq + 1, updated_at = now() where id = 1;
  end if;
  delete from public.ink_extra where target = 'b:' || o.code and ver = 'c' || o.id;
  if not public.backup_code_used(o.code, o.id) then delete from public.backup_bpm where code = o.code; end if;
  delete from public.backup_songs where id = o.id;
  return public.backup_state_live();
end;
$$;

revoke all on function public.backup_edit_custom(bigint, text, text, int, text, text[]) from public, anon;
revoke all on function public.backup_delete_custom(bigint) from public, anon;
grant execute on function public.backup_edit_custom(bigint, text, text, int, text, text[]) to authenticated;
grant execute on function public.backup_delete_custom(bigint) to authenticated;

-- 확인: select proname from pg_proc where proname in ('backup_edit_custom', 'backup_delete_custom', 'video_bundle');  → 3줄
--       select * from video_sync;  → 1줄 (pending = true · 다음 정시 cron부터 영상을 읽어요)
