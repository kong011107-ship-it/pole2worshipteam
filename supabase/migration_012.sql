-- =====================================================================
--  012 — 앱(홈 화면에 추가) · 푸시 알림 · 공지 (v13)
--  · push_subscriptions : 팀원 기기별 알림 구독 (이 기기 알림 켜기)
--  · notifications      : 보낸 알림 한 건 (공지 · 응답 열림 · 배치표 공개 등)
--  · notification_inbox : 사람별 알림함 (읽음 표시) — 알림을 꺼도 여기엔 쌓임
--  · notify_settings    : 알림 종류별 켜기/끄기 · 제목 · 내용 · 보내는 때
--  · notify_sent        : 같은 알림을 두 번 보내지 않도록 남기는 기록
--  migration_011 다음에 SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 괜찮아요.
--  예약 알림(마감 임박 · 수습 기록)을 쓰려면 이어서 cron_012.sql도 실행하세요.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 기기별 알림 구독
-- ---------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  endpoint      text primary key check (length(endpoint) <= 1000),
  member_id     uuid not null references public.members(id) on delete cascade,
  p256dh        text not null check (length(p256dh) <= 200),
  auth          text not null check (length(auth) <= 100),
  user_agent    text check (length(user_agent) <= 300),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);
create index if not exists push_subscriptions_member_idx on public.push_subscriptions (member_id);

-- 구독 저장: 같은 기기를 다른 계정이 쓰던 경우에도 지금 로그인한 사람으로 바꿔 저장
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_member() then raise exception '로그인한 팀원만 알림을 켤 수 있어요.'; end if;
  insert into public.push_subscriptions (endpoint, member_id, p256dh, auth, user_agent)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(p_ua, 300))
  on conflict (endpoint) do update
    set member_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now();
end;
$$;

create or replace function public.remove_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and member_id = auth.uid();
$$;

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.remove_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.remove_push_subscription(text) to authenticated;


-- ---------------------------------------------------------------------
-- 2. 알림 · 알림함
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id            bigint generated always as identity primary key,
  kind          text not null check (kind in ('open', 'minopen', 'poll', 'remind', 'lineup', 'practice', 'apply', 'trainee', 'notice')),
  title         text not null check (length(title) <= 120),
  body          text check (length(body) <= 600),
  url           text check (length(url) <= 300),
  target_label  text check (length(target_label) <= 120),
  recipients    int not null default 0,
  pushed        int not null default 0,
  created_by    uuid references public.members(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists notifications_created_idx on public.notifications (created_at desc);

create table if not exists public.notification_inbox (
  notification_id  bigint not null references public.notifications(id) on delete cascade,
  member_id        uuid not null references public.members(id) on delete cascade,
  title            text not null check (length(title) <= 120),
  body             text check (length(body) <= 600),
  read_at          timestamptz,
  primary key (notification_id, member_id)
);
create index if not exists notification_inbox_member_idx on public.notification_inbox (member_id, notification_id desc);

-- 읽음 표시 (본인 것만)
create or replace function public.mark_notifications_read(p_ids bigint[] default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notification_inbox
     set read_at = now()
   where member_id = auth.uid() and read_at is null
     and (p_ids is null or notification_id = any (p_ids));
$$;
revoke all on function public.mark_notifications_read(bigint[]) from public, anon;
grant execute on function public.mark_notifications_read(bigint[]) to authenticated;


-- ---------------------------------------------------------------------
-- 3. 알림 설정 (종류별)
--    schedule: 마감 임박 = [{"days":1,"hour":18}, {"days":0,"hour":10}] (최대 2번)
--              수습 기록 = {"dow":6,"hour":18}  (dow: 0 주일 ~ 6 토)
--    문구 안의 {이름} 같은 칸은 보낼 때 채워져요.
-- ---------------------------------------------------------------------
create table if not exists public.notify_settings (
  kind        text primary key check (kind in ('open', 'minopen', 'poll', 'remind', 'lineup', 'practice', 'apply', 'trainee', 'notice')),
  enabled     boolean not null default true,
  title       text not null check (length(trim(title)) between 1 and 80),
  body        text not null default '' check (length(body) <= 300),
  schedule    jsonb,
  updated_at  timestamptz not null default now()
);

drop trigger if exists notify_settings_touch on public.notify_settings;
create trigger notify_settings_touch
  before update on public.notify_settings
  for each row execute function public.touch_updated_at();

insert into public.notify_settings (kind, title, body, schedule) values
  ('open',     '{월} 섬김 응답을 받고 있어요',      '{마감일}까지 토요 연습·주일 가능 여부를 체크해 주세요', null),
  ('minopen',  '{사역} 섬김 응답을 받고 있어요',    '{마감일}까지 가능 여부를 체크해 주세요', null),
  ('poll',     '{사역} 연습 시간을 골라 주세요',    '{마감일}까지 · 되는 칸을 눌러 주세요', null),
  ('remind',   '[{마감일} 마감] {무엇}',            '{남은 것}. 지금 체크해 주세요', '[{"days":1,"hour":18},{"days":0,"hour":10}]'),
  ('lineup',   '{월} 배치표가 나왔어요',            '{내 섬김}', null),
  ('practice', '{사역} 연습 시간이 정해졌어요',     '{연습 일시}', null),
  ('apply',    '새 지원서가 들어왔어요',            '{지원자} · {포지션} · 모집에서 확인하세요', null),
  ('trainee',  '{수습생}님 수습 {주차}주차 기록을 남겨 주세요', '오늘 나눔 내용을 적어 주세요', '{"dow":6,"hour":18}'),
  ('notice',   '[공지] {제목}',                     '{내용}', null)
on conflict (kind) do nothing;


-- ---------------------------------------------------------------------
-- 4. 보낸 기록 (중복 방지 · '처음 보내기' 판단)
-- ---------------------------------------------------------------------
create table if not exists public.notify_sent (
  key      text primary key check (length(key) <= 200),
  sent_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 5. RLS
--    알림 보내기·알림함 쓰기는 서버(service_role)만
-- ---------------------------------------------------------------------
alter table public.push_subscriptions  enable row level security;
alter table public.notifications       enable row level security;
alter table public.notification_inbox  enable row level security;
alter table public.notify_settings     enable row level security;
alter table public.notify_sent         enable row level security;

drop policy if exists push_subs_read on public.push_subscriptions;
drop policy if exists push_subs_delete on public.push_subscriptions;
create policy push_subs_read on public.push_subscriptions for select
  using (member_id = auth.uid() or public.is_admin());
create policy push_subs_delete on public.push_subscriptions for delete
  using (member_id = auth.uid());

drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select
  using (public.is_admin()
      or exists (select 1 from public.notification_inbox i where i.notification_id = notifications.id and i.member_id = auth.uid()));

drop policy if exists inbox_read on public.notification_inbox;
create policy inbox_read on public.notification_inbox for select
  using (member_id = auth.uid() or public.is_admin());

drop policy if exists notify_settings_admin on public.notify_settings;
create policy notify_settings_admin on public.notify_settings for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists notify_sent_read on public.notify_sent;
create policy notify_sent_read on public.notify_sent for select
  using (public.is_admin());
