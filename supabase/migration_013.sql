-- =====================================================================
--  013 — 보내기(푸시 + 문구 복사) · 발송 기록 · 다시 보내기 경고 · 초기화 (v14)
--  · notifications.kind 에 'message'(리더십이 직접 보낸 안내·독촉) 추가
--  · notifications.ctx_key : 어떤 안내인지 (예: 'nudge:2026-11-01') — 같은 대상에게
--    다시 보낼 때 경고하고, 보낸 기록을 그 자리에서 보여 주는 데 써요
--  · team_settings.resend_warn_hours : 다시 보내기 경고 기준 (기본 24시간, 0이면 경고 안 함)
--  · reset_team_data() : 설정 › 초기화 (서버 API 전용)
--  migration_012 다음에 SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 괜찮아요.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 보내기 기록
-- ---------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('open', 'minopen', 'poll', 'remind', 'lineup', 'practice', 'apply', 'trainee', 'notice', 'message'));

alter table public.notifications
  add column if not exists ctx_key text check (length(ctx_key) <= 200);
create index if not exists notifications_ctx_idx on public.notifications (ctx_key, created_at desc);

alter table public.team_settings
  add column if not exists resend_warn_hours int not null default 24
    check (resend_warn_hours between 0 and 168);


-- ---------------------------------------------------------------------
-- 2. 초기화: 정식 운영 전에 테스트 데이터를 한 번에 비움
--    지우는 것: 일정·사역·응답·출석·배치·객원·알림 기록·지원서(관리자 본인 것 제외)·탈퇴 기록
--    남기는 것: 관리자 계정과 그 정보, 설정, 안내 문구·서약서, 알림 설정
--    관리자가 아닌 계정은 서버 API가 먼저 지운 뒤 이 함수를 불러요.
-- ---------------------------------------------------------------------
create or replace function public.reset_team_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.notification_inbox where true;
  delete from public.notifications where true;
  delete from public.notify_sent where true;

  delete from public.practice_attendance where true;
  delete from public.practice_answers where true;
  delete from public.ministry_poll where true;
  delete from public.ministry_availability where true;
  delete from public.ministry_practices where true;
  delete from public.ministry_targets where true;
  delete from public.assignments where true;
  delete from public.services where true;
  delete from public.ministries where true;
  delete from public.guests where true;

  delete from public.availability where true;
  delete from public.availability_notes where true;
  delete from public.availability_months where true;
  delete from public.attendance where true;
  delete from public.team_meetings where true;

  -- 지원서: 남아 있는 관리자 본인의 지원서·서약만 남김
  delete from public.applications a
   where a.user_id is null
      or not exists (select 1 from public.members m where m.id = a.user_id);
  delete from public.alumni where true;
end;
$$;

revoke all on function public.reset_team_data() from public, anon, authenticated;
grant execute on function public.reset_team_data() to service_role;
