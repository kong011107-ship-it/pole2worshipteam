-- =====================================================================
--  002 — 임시 비밀번호 방식 + 새 신청서 실시간 알림
--  schema.sql 실행 후, SQL Editor에서 이 파일을 한 번 실행하세요.
-- =====================================================================

-- 승인 시 발급한 임시 비밀번호는 첫 로그인 때 반드시 변경
alter table public.members
  add column if not exists must_change_password boolean not null default true;

-- 지금 이미 있는 계정(대시보드에서 직접 만든 관리자)은 변경 불필요
update public.members set must_change_password = false;

-- 새 신청서가 들어오면 관리자 화면에 바로 표시 (Realtime)
alter publication supabase_realtime add table public.applications;
