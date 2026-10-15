-- =====================================================================
--  012-2 — 예약 알림 (마감 임박 · 수습 기록 차례)
--  매시 정각에 사이트의 /api/cron 을 불러요. 실제로 보낼지는 사이트가
--  '공지 · 알림 › 알림 설정'의 시간을 보고 정해요.
--  migration_012 다음에 SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 괜찮아요.
--
--  먼저 Supabase › Database › Extensions 에서 pg_cron, pg_net 을 켜 주세요
--  (아래 create extension 이 대신 켜 주기도 해요).
--  아래 주소와 키는 Vercel 환경변수 CRON_SECRET 과 같아야 해요.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 같은 이름이 있으면 지우고 다시 등록
select cron.unschedule(jobid) from cron.job where jobname = 'pole2-notify';

select cron.schedule(
  'pole2-notify',
  '0 * * * *',
  $$ select net.http_get(
       url := 'https://pole2worshipteam.vercel.app/api/cron',
       headers := jsonb_build_object('x-cron-key', 'fzPDwXMIjzWeyfgKlvfhnPJNRKX7K6FA'),
       timeout_milliseconds := 20000
     ) $$
);

-- 확인: select jobname, schedule, active from cron.job;
-- 실행 기록: select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
