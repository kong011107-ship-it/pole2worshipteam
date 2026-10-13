-- =====================================================================
--  003 — 모집·수습 파이프라인
--  지원 → 면접 → 수습 5주 → 정식 전환 (+ 종료: 미선발·보류·재지원 권유)
--  migration_002 다음에 SQL Editor에서 한 번 실행하세요.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 모집 중 포지션 (신청서에는 모집 중인 포지션만 보임)
-- ---------------------------------------------------------------------
alter table public.positions
  add column if not exists is_recruiting boolean not null default true;


-- ---------------------------------------------------------------------
-- 2. 신청서 → 지원자 파이프라인
-- ---------------------------------------------------------------------
alter table public.applications
  add column stage text not null default 'applied'
    check (stage in ('applied', 'interview', 'trainee', 'member', 'closed')),
  add column closed_reason text
    check (closed_reason in ('not_selected', 'hold', 'reapply', 'withdrawn')),
  add column closed_from text,
  -- 지원 자격 3항목
  add column q_practice boolean not null default false,   -- 토요 연습·팀모임 참석
  add column q_sunday   boolean not null default false,   -- 주일 예배 참여
  add column q_group    boolean not null default false,   -- 주일 순모임 소속
  add column small_group text check (length(small_group) <= 30),
  add column goal        text check (length(goal) <= 1000), -- 찬양팀을 통해 이루고 싶은 것
  -- 면접
  add column interview_at        timestamptz,
  add column interview_place     text check (length(interview_place) <= 100),
  add column interview_result    text check (interview_result in ('pass', 'pass_cond', 'hold', 'reapply')),
  add column interview_condition text check (length(interview_condition) <= 500),
  -- 수습 · 전환
  add column trainee_start    date,
  add column converted_at     timestamptz,
  add column stage_changed_at timestamptz not null default now();

-- 기존(002까지) 데이터 옮기기
update public.applications set
  stage = case status when 'approved' then 'member' when 'rejected' then 'closed' else 'applied' end,
  closed_reason = case when status = 'rejected' then 'not_selected' end,
  q_practice = true, q_sunday = true, q_group = true;

-- 이전 승인 방식 제거 (수습 시작 시 계정 발급으로 바뀜)
drop function if exists public.approve_application(uuid, uuid, text);
alter table public.applications drop column status;

create index if not exists applications_stage_idx on public.applications (stage, created_at desc);

-- 신청서 저장 시: 서약 스냅샷 + 자격·모집 포지션 확인 + 상태 강제
create or replace function public.applications_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.pledge_versions;
begin
  if not (new.q_practice and new.q_sunday and new.q_group) then
    raise exception '지원 자격 3항목을 모두 확인해 주세요.';
  end if;
  if not exists (select 1 from public.positions where code = new.applied_position and is_recruiting) then
    raise exception '지금 모집 중인 포지션이 아닙니다.';
  end if;

  select * into v from public.pledge_versions where is_active limit 1;
  if v.id is null then
    raise exception '활성화된 서약서가 없습니다.';
  end if;

  new.pledge_version_id := v.id;
  new.pledge_title      := v.title;
  new.pledge_content    := v.content;
  new.pledged_at        := now();
  new.created_at        := now();
  new.stage             := 'applied';
  new.stage_changed_at  := now();
  new.closed_reason     := null;
  new.closed_from       := null;
  new.interview_at      := null;
  new.interview_place   := null;
  new.interview_result  := null;
  new.interview_condition := null;
  new.trainee_start     := null;
  new.converted_at      := null;
  new.admin_memo        := null;
  new.reviewed_at       := null;
  new.user_id           := null;
  return new;
end;
$$;

-- 단계(stage)는 전환 함수로만 바꿀 수 있음 (직접 UPDATE 차단)
create or replace function public.applications_guard_stage()
returns trigger
language plpgsql
as $$
begin
  if (new.stage is distinct from old.stage
      or new.closed_reason is distinct from old.closed_reason
      or new.user_id is distinct from old.user_id
      or new.converted_at is distinct from old.converted_at)
     and coalesce(current_setting('app.stage_change', true), '') <> 'on' then
    raise exception '지원 단계는 단계 이동 기능으로만 바꿀 수 있습니다.';
  end if;
  if new.stage is distinct from old.stage then
    new.stage_changed_at := now();
  end if;
  return new;
end;
$$;

create trigger applications_guard_stage
  before update on public.applications
  for each row execute function public.applications_guard_stage();


-- ---------------------------------------------------------------------
-- 3. 멤버: 수습생 / 정식 구분
-- ---------------------------------------------------------------------
alter table public.members
  add column if not exists status text not null default 'active'
    check (status in ('trainee', 'active'));

create or replace function public.members_guard_update()
returns trigger
language plpgsql
as $$
begin
  if not public.is_admin() and auth.role() <> 'service_role' then
    if new.role is distinct from old.role
       or new.status is distinct from old.status
       or new.main_position is distinct from old.main_position
       or new.is_active is distinct from old.is_active
       or new.application_id is distinct from old.application_id
       or new.name is distinct from old.name then
      raise exception '이 항목은 관리자만 수정할 수 있습니다.';
    end if;
  end if;
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 4. 면접 평가표 (면접관별 각자 입력)
-- ---------------------------------------------------------------------
create table public.eval_items (
  code        text primary key,
  area        text not null,
  label       text not null,
  sort_order  int  not null
);

insert into public.eval_items (code, area, label, sort_order) values
  ('rhythm',      '실기',        '박자·리듬 유지력',          1),
  ('chords',      '실기',        '코드 진행 이행',            2),
  ('listening',   '실기',        '합주 시 타 파트 청취',      3),
  ('recovery',    '실기',        '실수 회복력',               4),
  ('sincerity',   '신앙·인성',   '지원 동기의 진정성',        5),
  ('belonging',   '신앙·인성',   '공동체 소속감',             6),
  ('feedback',    '신앙·인성',   '피드백 수용 태도',          7),
  ('serving',     '신앙·인성',   '섬김에 대한 이해',          8),
  ('saturday',    '헌신 가능성', '토요 연습 참석 가능성',     9),
  ('practice',    '헌신 가능성', '주중 개인 연습 가능 여부', 10);

create table public.interview_evaluations (
  application_id  uuid not null references public.applications(id) on delete cascade,
  interviewer_id  uuid not null references public.members(id) on delete cascade,
  scores          jsonb not null default '{}'::jsonb,   -- {"rhythm":"ok","listening":"weak",...}
  note            text check (length(note) <= 1000),
  updated_at      timestamptz not null default now(),
  primary key (application_id, interviewer_id)
);

-- 점수 값 검사: 항목 코드는 eval_items에 있어야 하고 값은 ok / mid / weak
create or replace function public.interview_evaluations_validate()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  k text; v text;
begin
  if jsonb_typeof(new.scores) <> 'object' then
    raise exception '평가 형식이 올바르지 않습니다.';
  end if;
  for k, v in select key, value #>> '{}' from jsonb_each(new.scores) loop
    if not exists (select 1 from public.eval_items where code = k) then
      raise exception '알 수 없는 평가 항목입니다: %', k;
    end if;
    if v not in ('ok', 'mid', 'weak') then
      raise exception '평가는 충분 / 보완 필요 / 미흡 중 하나여야 합니다.';
    end if;
  end loop;
  new.updated_at := now();
  return new;
end;
$$;

create trigger interview_evaluations_validate
  before insert or update on public.interview_evaluations
  for each row execute function public.interview_evaluations_validate();


-- ---------------------------------------------------------------------
-- 5. 수습 주간 기록 (나눔을 맡은 리더가 3줄로)
-- ---------------------------------------------------------------------
create table public.trainee_weeks (
  application_id  uuid not null references public.applications(id) on delete cascade,
  week            int  not null check (week between 1 and 5),
  leader_id       uuid references public.members(id) on delete set null,
  sat_attended    boolean,   -- 토요 연습 (null = 기록 전)
  sun_attended    boolean,   -- 주일 오전 9시 참관
  note            text check (length(note) <= 500),
  updated_by      uuid references public.members(id) on delete set null,
  updated_at      timestamptz not null default now(),
  primary key (application_id, week)
);

create trigger trainee_weeks_touch
  before update on public.trainee_weeks
  for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------
-- 6. 안내 문구 (표준 ①~⑦) + 발송 기록
-- ---------------------------------------------------------------------
create table public.message_templates (
  code        text primary key,
  title       text not null,
  timing      text not null,   -- 언제 / 누구에게 / 누가
  sensitive   boolean not null default false,   -- 전화 먼저
  body        text not null,
  sort_order  int  not null,
  updated_at  timestamptz not null default now()
);

create trigger message_templates_touch
  before update on public.message_templates
  for each row execute function public.touch_updated_at();

insert into public.message_templates (code, title, timing, sensitive, sort_order, body) values
('1', '① 접수 확인', '지원서 제출 직후 · 전체 지원자 · 담당자', false, 1,
E'안녕하세요, [이름]님.\n폴투공동체 찬양팀장입니다.\n\n우선 폴투공동체 찬양팀에 지원해주셔서 감사합니다.\n[이름]님의 마음이 담긴 지원서는 접수되었습니다.\n\n해당 지원서는 리더십이 검토한 이후 개별적으로 [날짜]까지 안내드릴 예정입니다.\n다만, 내부 일정으로 인해 지연될 수 있다는 점 참고 부탁드리며, 지연될 경우 별도로 안내드리도록 하겠습니다.\n\n지원해주셔서 다시 한번 감사드리며, 곧 만나게 될 날들을 기대하며 기도하겠습니다.\n오늘 하루도 주와 함께 동행하는 날 되기를 소망합니다.\n\n감사합니다.\n폴투공동체 찬양팀장 드림'),
('2', '② 면접 일정 안내', '서류 확인 후 · 면접 대상자 · 담당자', false, 2,
E'안녕하세요, [이름]님.\n폴투공동체 찬양팀장입니다.\n\n보내주신 지원서를 리더십이 함께 읽었습니다. 아래 일정으로 면접을 진행하려고 합니다.\n\n· 일시: [면접 일시]\n· 장소: [면접 장소]\n· 준비: 지정곡 [곡명], 자유곡 1곡\n\n실기는 무대 수준이 아니라 팀 합주를 함께 따라올 수 있는지를 봅니다. 편하게 준비해 주세요. 일정이 어려우면 미리 말씀 부탁드립니다.\n\n만나서 나눌 이야기를 기대하며 기도하겠습니다.\n\n폴투공동체 찬양팀장 드림'),
('2-1', '②-1 결과 안내 (미해당·미선발)', '서류 확인 후 · 미해당·미선발자 · 담당자 · 전화 먼저', true, 3,
E'안녕하세요, [이름]님.\n폴투공동체 찬양팀장입니다.\n\n찬양팀에 마음을 내어 지원해 주셔서 감사합니다. 리더십이 함께 검토한 결과, 이번 모집에서는 함께하기 어렵게 되었습니다. [사유]\n\n다음 모집 때 다시 만날 수 있기를 기대합니다. 공동체 안에서의 [이름]님의 걸음을 응원하며 기도하겠습니다.\n\n폴투공동체 찬양팀장 드림'),
('3-hold', '③ 면접 결과 (보류)', '면접 후 2일 내 · 면접 응시자 · 담당자 · 전화 먼저', true, 4,
E'안녕하세요, [이름]님.\n폴투공동체 찬양팀장입니다.\n\n통화로 나눈 내용을 정리해 드립니다. 이번에는 수습 전환을 잠시 보류하고, [보완할 부분]을 함께 준비한 뒤 [시점]에 다시 이야기 나누려고 합니다.\n\n[이름]님의 마음과 시간을 귀하게 여깁니다. 함께 기도하겠습니다.\n\n폴투공동체 찬양팀장 드림'),
('3-reapply', '③ 면접 결과 (추후 재지원 권유)', '면접 후 2일 내 · 면접 응시자 · 담당자 · 전화 먼저', true, 5,
E'안녕하세요, [이름]님.\n폴투공동체 찬양팀장입니다.\n\n통화로 나눈 내용을 정리해 드립니다. 이번 모집에서는 함께하기 어렵지만, [시점] 이후 다시 지원해 주시기를 권합니다.\n\n지원해 주셔서 감사하고, [이름]님의 걸음을 응원하며 기도하겠습니다.\n\n폴투공동체 찬양팀장 드림'),
('4', '③ 합격 + ④ 수습 시작 안내', '면접 후 2일 내 · 수습 전환자 · 담당자 · 계정 정보 포함', false, 6,
E'안녕하세요, [이름]님.\n폴투공동체 찬양팀장입니다.\n\n면접에 함께해 주셔서 감사합니다. 리더십이 함께 논의한 결과, [이름]님과 수습 5주를 시작하게 되었습니다.\n\n· 수습 시작: [수습 시작일] 토요 연습부터\n· 주일에는 오전 9시까지 와서 세팅을 함께 지켜봐 주세요\n· 1~2주는 참관, 3주차부터 연습에 함께해요\n\n로그인해서 수습 일정을 확인할 수 있어요.\n· 주소: [사이트 주소]\n· 아이디: [아이디]\n· 임시 비밀번호: [임시 비밀번호]\n(첫 로그인 때 비밀번호를 바꿔 주세요)\n\n새로운 걸음을 축복하며 기도하겠습니다.\n\n폴투공동체 찬양팀장 드림'),
('5', '⑤ 3주차 실전 투입 예고', '3주차 시작 전 · 수습생 · 담당자', false, 7,
E'안녕하세요, [이름]님.\n폴투공동체 찬양팀장입니다.\n\n수습 2주 동안 함께해 주셔서 감사합니다. 이번 주부터는 연습 시간에 직접 함께해요.\n\n· 3주차: 축도·봉헌송 연습 시간에 연주로 참여\n· 4주차: 지정곡 1곡을 맡아 연습 시간에 투입 (곡: [곡명])\n\n부담 갖지 않으셔도 괜찮아요. 함께 맞춰 가는 시간입니다.\n\n[이름]님의 걸음을 응원하며 기도하겠습니다.\n\n폴투공동체 찬양팀장 드림'),
('6', '⑥ 인터뷰 일정 안내', '5주차 시작 전 · 수습생 · 담당자', false, 8,
E'안녕하세요, [이름]님.\n폴투공동체 찬양팀장입니다.\n\n어느덧 수습 마지막 주가 되었습니다. 5주 동안의 이야기를 리더십과 함께 나누는 시간을 가지려고 해요.\n\n· 일시: [날짜·시간]\n· 장소: [장소]\n\n평가 자리가 아니라 지난 5주를 함께 돌아보는 커피챗이에요. 편하게 와 주세요.\n\n함께 걸어온 시간에 감사하며 기도하겠습니다.\n\n폴투공동체 찬양팀장 드림'),
('7', '⑦ 전환 통보·환영', '인터뷰 직후 · 전환 확정자 · 리더십', false, 9,
E'안녕하세요, [이름]님.\n\n5주 동안 함께 걸어 주셔서 감사합니다. 커피챗에서 나눈 이야기를 바탕으로, [이름]님을 폴투공동체 찬양팀의 정식 팀원으로 맞이하게 되었습니다.\n\n[날짜] 팀모임에서 팀 앞에 소개하고 함께 기도로 환영하려고 합니다.\n\n합격 통보가 아니라, 공동체로 함께 걸어가는 시작이기를 소망합니다.\n\n폴투공동체 찬양팀 리더십 드림');

create table public.message_log (
  id              bigint generated always as identity primary key,
  application_id  uuid not null references public.applications(id) on delete cascade,
  template_code   text not null references public.message_templates(code),
  sent_by         uuid references public.members(id) on delete set null default auth.uid(),
  sent_at         timestamptz not null default now(),
  note            text check (length(note) <= 200)
);

create index message_log_app_idx on public.message_log (application_id, sent_at);


-- ---------------------------------------------------------------------
-- 7. 단계 이동 (관리자)
--    applied → interview   : 면접 일정 기록
--    trainee → member      : 정식 전환 (멤버 상태 '정식')
--    (모든 진행 단계) → closed : 종료 (미선발·보류·재지원 권유·중도 하차)
--    interview → trainee 는 계정 발급이 필요해 서버 API(/api/start-trainee)로만
-- ---------------------------------------------------------------------
create or replace function public.advance_application(
  p_id               uuid,
  p_to               text,
  p_reason           text default null,
  p_interview_at     timestamptz default null,
  p_interview_place  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.applications;
begin
  if not public.is_admin() then
    raise exception '관리자만 할 수 있습니다.';
  end if;

  select * into a from public.applications where id = p_id for update;
  if a.id is null then raise exception '지원서를 찾을 수 없습니다.'; end if;

  perform set_config('app.stage_change', 'on', true);

  if a.stage = 'applied' and p_to = 'interview' then
    update public.applications
       set stage = 'interview', interview_at = p_interview_at, interview_place = p_interview_place
     where id = a.id;

  elsif a.stage = 'trainee' and p_to = 'member' then
    update public.members set status = 'active' where id = a.user_id;
    update public.applications set stage = 'member', converted_at = now() where id = a.id;

  elsif a.stage in ('applied', 'interview', 'trainee') and p_to = 'closed' then
    if p_reason not in ('not_selected', 'hold', 'reapply', 'withdrawn') then
      raise exception '종료 사유를 골라 주세요.';
    end if;
    if a.stage = 'trainee' and a.user_id is not null then
      update public.members set is_active = false where id = a.user_id;
    end if;
    update public.applications
       set stage = 'closed', closed_reason = p_reason, closed_from = a.stage,
           interview_result = case when a.stage = 'interview' and p_reason in ('hold', 'reapply')
                                   then p_reason else interview_result end
     where id = a.id;

  else
    raise exception '이 단계로는 이동할 수 없습니다.';
  end if;

  perform set_config('app.stage_change', '', true);
end;
$$;

revoke all on function public.advance_application(uuid, text, text, timestamptz, text) from public, anon;
grant execute on function public.advance_application(uuid, text, text, timestamptz, text) to authenticated;

-- 면접 → 수습 (서버 API가 계정을 만든 뒤 service_role로 호출)
create or replace function public.start_trainee(
  p_application_id uuid,
  p_user_id        uuid,
  p_main_position  text,
  p_start          date,
  p_result         text,
  p_condition      text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.applications;
begin
  select * into a from public.applications where id = p_application_id for update;
  if a.id is null then raise exception '지원서를 찾을 수 없습니다.'; end if;
  if a.stage <> 'interview' then raise exception '면접 단계의 지원자만 수습을 시작할 수 있습니다.'; end if;
  if p_result not in ('pass', 'pass_cond') then raise exception '면접 결과가 합격이어야 합니다.'; end if;

  insert into public.members (id, application_id, name, phone, email, main_position, status, must_change_password)
  values (p_user_id, a.id, a.name, a.phone, a.email,
          coalesce(p_main_position, a.applied_position), 'trainee', true);

  insert into public.trainee_weeks (application_id, week)
  select a.id, w from generate_series(1, 5) w
  on conflict do nothing;

  perform set_config('app.stage_change', 'on', true);
  update public.applications
     set stage = 'trainee', user_id = p_user_id, trainee_start = p_start,
         interview_result = p_result, interview_condition = p_condition, reviewed_at = now()
   where id = a.id;
  perform set_config('app.stage_change', '', true);
end;
$$;

revoke all on function public.start_trainee(uuid, uuid, text, date, text, text) from public, anon, authenticated;
grant execute on function public.start_trainee(uuid, uuid, text, date, text, text) to service_role;


-- ---------------------------------------------------------------------
-- 8. RLS
-- ---------------------------------------------------------------------
alter table public.eval_items            enable row level security;
alter table public.interview_evaluations enable row level security;
alter table public.trainee_weeks         enable row level security;
alter table public.message_templates     enable row level security;
alter table public.message_log           enable row level security;

create policy eval_items_admin on public.eval_items for all
  using (public.is_admin()) with check (public.is_admin());

-- 평가표: 관리자는 모두 열람, 수정은 본인이 쓴 것만
create policy evals_read on public.interview_evaluations for select
  using (public.is_admin());
create policy evals_write_own on public.interview_evaluations for insert
  with check (public.is_admin() and interviewer_id = auth.uid());
create policy evals_update_own on public.interview_evaluations for update
  using (public.is_admin() and interviewer_id = auth.uid())
  with check (public.is_admin() and interviewer_id = auth.uid());
create policy evals_delete_own on public.interview_evaluations for delete
  using (public.is_admin() and interviewer_id = auth.uid());

-- 수습 기록·안내 문구·발송 기록: 리더십(관리자)만
create policy trainee_weeks_admin on public.trainee_weeks for all
  using (public.is_admin()) with check (public.is_admin());
create policy templates_admin on public.message_templates for all
  using (public.is_admin()) with check (public.is_admin());
create policy message_log_read on public.message_log for select
  using (public.is_admin());
create policy message_log_insert on public.message_log for insert
  with check (public.is_admin() and sent_by = auth.uid());

-- 새 지원서도 실시간으로 (이미 등록돼 있으면 건너뜀)
do $$ begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'applications') then
    alter publication supabase_realtime add table public.applications;
  end if;
exception when undefined_object then null;
end $$;
