-- =====================================================================
--  019 — 변경 기록 · 되살리기 · 동시 수정 보호 · 예약 알림 중복 방지 · 백업 기록 (v20)
--  · audit_log        : 누가 언제 무엇을 바꿨는지 (리더십만 봐요)
--      멤버 · 메모 · 숙련도 · 추가 포지션 · 지원서 · 면접 평가 · 수습 기록 · 출석 · 배치 · 일정 · 설정
--      바뀐 칸만 남기고, 지운 것은 통째로 남겨서 '되살리기'를 할 수 있어요
--      탈퇴·삭제된 멤버, 지워진 지원서의 기록은 함께 지워요 (개인정보 파기). 멤버는 이름 한 줄만 남겨요
--      1년이 지난 기록은 예약 알림(cron)이 매일 새벽에 지워요
--  · restore_audit()  : 지운 것 되살리기 · 바꾼 것 되돌리기 (리더십)
--  · save_member()    : 멤버 정보 수정 — 내가 바꾼 칸만 저장하고, 그 사이 다른 리더가 같은 칸을 고쳤으면 멈춤
--  · save_fields()    : 지원서 관리자 메모 · 수습 주간 기록도 같은 방식
--  · claim_notify()   : 예약 알림을 보내기 전에 먼저 '보냄' 자리를 잡아서 두 번 보내지 않게
--  · backup_log       : 자동 백업(GitHub Actions)이 끝날 때마다 한 줄 — 설정 화면에서 마지막 백업을 봐요
--  migration_018 다음에 SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 괜찮아요.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 변경 기록
-- ---------------------------------------------------------------------
create table if not exists public.audit_log (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  actor        uuid,                    -- 바꾼 사람 (서버 · SQL Editor 작업이면 비어 있음)
  actor_name   text,
  tbl          text not null,
  op           text not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
  row_key      jsonb not null default '{}'::jsonb,
  member_ref   uuid,                    -- 어느 멤버에 관한 기록인지 (탈퇴하면 함께 지움)
  app_ref      uuid,                    -- 어느 지원서에 관한 기록인지 (지원서를 지우면 함께 지움)
  label        text,                    -- 화면에 보일 대상 (이름 · 날짜)
  old_row      jsonb,                   -- 바꾼 것: 바뀐 칸의 이전 값 / 지운 것: 지운 줄 전체
  new_row      jsonb,                   -- 바꾼 것: 바뀐 칸의 새 값 / 넣은 것: 넣은 줄 전체
  changed      text[],
  restored_at  timestamptz,
  restored_by  uuid
);
create index if not exists audit_log_at_idx     on public.audit_log (at desc);
create index if not exists audit_log_tbl_idx    on public.audit_log (tbl, at desc);
create index if not exists audit_log_member_idx on public.audit_log (member_ref) where member_ref is not null;
create index if not exists audit_log_app_idx    on public.audit_log (app_ref) where app_ref is not null;

alter table public.audit_log enable row level security;
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log for select using (public.is_admin());
-- 쓰기 정책 없음 = 화면에서 직접 쓰거나 지울 수 없음 (트리거 · 함수로만)

-- 기록 트리거
--   인자: 1 기본 키 칸(쉼표) · 2 멤버 칸 · 3 지원서 칸 · 4 바뀌어도 기록하지 않는 칸(쉼표) · 5 부모 칸:표(쉼표)
--   다른 트리거가 일으킨 변경(트리거 안의 트리거)과 연쇄 삭제(부모가 지워지면서 함께 지워지거나 비워진 줄)는
--   기록하지 않아요 — 원래 작업 한 줄이면 충분하고, 탈퇴한 사람의 기록이 다시 생기지 않게
create or replace function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  keys    text[] := string_to_array(nullif(tg_argv[0], ''), ',');
  mcol    text := nullif(tg_argv[1], '');
  acol    text := nullif(tg_argv[2], '');
  skip    text[] := coalesce(string_to_array(nullif(tg_argv[3], ''), ','), '{}') || array['updated_at', 'created_at'];
  o jsonb; n jsonb; r jsonb; k text;
  ch text[] := '{}'; oc jsonb := '{}'; nc jsonb := '{}';
  parents text[] := coalesce(string_to_array(nullif(tg_argv[4], ''), ','), '{}');
  pc text; pcol text; ptbl text; pv text; alive boolean;
  mref uuid; aref uuid; lbl text; who uuid := auth.uid(); whon text;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op <> 'INSERT' then o := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then n := to_jsonb(new); end if;
  r := coalesce(n, o);
  -- 연쇄 삭제 · 연쇄로 비워진 칸: 부모 줄이 이미 없으면 건너뜀
  if tg_op <> 'INSERT' then
    foreach pc in array parents loop
      pcol := split_part(pc, ':', 1); ptbl := split_part(pc, ':', 2); pv := o ->> pcol;
      if pv is null or (tg_op = 'UPDATE' and n ->> pcol is not null) then continue; end if;
      execute format('select exists (select 1 from public.%I where id::text = $1)', ptbl) into alive using pv;
      if not alive then return null; end if;
    end loop;
  end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if k <> all (skip) and (n -> k) is distinct from (o -> k) then
        ch := ch || k; oc := oc || jsonb_build_object(k, o -> k); nc := nc || jsonb_build_object(k, n -> k);
      end if;
    end loop;
    if cardinality(ch) = 0 then return null; end if;
  end if;
  if mcol is not null then mref := nullif(r ->> mcol, '')::uuid; end if;
  if acol is not null then aref := nullif(r ->> acol, '')::uuid; end if;
  -- 대상 이름
  if mref is not null then
    select name into lbl from public.members where id = mref;
    if lbl is null and tg_table_name = 'members' then lbl := r ->> 'name'; end if;
  end if;
  if lbl is null and aref is not null then select name into lbl from public.applications where id = aref; end if;
  if lbl is null and tg_table_name = 'assignments' then lbl := r ->> 'former_name'; end if;
  if lbl is null and tg_table_name in ('ministries', 'guests') then lbl := r ->> 'name'; end if;
  -- 날짜 붙이기
  if tg_table_name = 'assignments' then
    lbl := concat_ws(' · ', lbl, (select to_char(service_date, 'FMMM/FMDD') from public.services where id = (r ->> 'service_id')::uuid));
  elsif tg_table_name = 'attendance' then
    lbl := concat_ws(' · ', lbl, (select to_char(meeting_date, 'FMMM/FMDD') from public.team_meetings where id = (r ->> 'meeting_id')::uuid));
  elsif tg_table_name = 'services' then
    lbl := concat_ws(' · ', (select name from public.ministries where id = (r ->> 'ministry_id')::uuid), to_char((r ->> 'service_date')::date, 'FMMM/FMDD'));
  elsif tg_table_name = 'team_meetings' then
    lbl := to_char((r ->> 'meeting_date')::date, 'FMMM/FMDD');
  elsif tg_table_name = 'trainee_weeks' then
    lbl := concat_ws(' · ', lbl, (r ->> 'week') || '주차');
  elsif tg_table_name = 'positions' then
    lbl := r ->> 'name';
  end if;
  if who is not null then select name into whon from public.members where id = who; end if;
  insert into public.audit_log (actor, actor_name, tbl, op, row_key, member_ref, app_ref, label, old_row, new_row, changed)
  values (who, whon, tg_table_name, tg_op,
          coalesce((select jsonb_object_agg(x, r -> x) from unnest(keys) x), '{}'::jsonb),
          mref, aref, lbl,
          case tg_op when 'UPDATE' then oc when 'DELETE' then o end,
          case tg_op when 'UPDATE' then nc when 'INSERT' then n end,
          case when tg_op = 'UPDATE' then ch end);
  return null;
end;
$$;

-- 트리거 걸기 (여러 번 실행해도 괜찮게 지우고 다시)
do $$
declare t record;
begin
  for t in select * from (values
    -- 표,                     키,                              멤버 칸,       지원서 칸,         기록 안 하는 칸,                 지울 때도, 부모 칸:표
    ('members',                'id',                            'id',          'application_id', 'must_change_password',           false, ''),
    ('member_notes',           'member_id',                     'member_id',   '',               'updated_by',                     true,  'member_id:members'),
    ('member_skills',          'member_id,position_code',       'member_id',   '',               '',                               true,  'member_id:members'),
    ('member_extra_positions', 'member_id,position_code',       'member_id',   '',               '',                               true,  'member_id:members'),
    ('applications',           'id',                            'user_id',     'id',             'stage_changed_at,reviewed_at',   false, 'user_id:members'),
    ('interview_evaluations',  'application_id,interviewer_id', '',            'application_id', '',                               true,  'application_id:applications,interviewer_id:members'),
    ('trainee_weeks',          'application_id,week',           '',            'application_id', 'updated_by',                     true,  'application_id:applications,leader_id:members'),
    ('trainee_postpones',      'id',                            '',            'application_id', '',                               true,  'application_id:applications'),
    ('attendance',             'meeting_id,member_id,kind',     'member_id',   '',               'updated_by',                     true,  'meeting_id:team_meetings,member_id:members'),
    ('practice_attendance',    'practice_id,member_id',         'member_id',   '',               'updated_by',                     true,  'practice_id:ministry_practices,member_id:members'),
    ('assignments',            'id',                            'member_id',   '',               '',                               true,  'service_id:services,member_id:members,guest_id:guests'),
    ('services',               'id',                            '',            '',               'published_at',                   true,  'ministry_id:ministries'),
    ('team_meetings',          'id',                            '',            '',               '',                               true,  ''),
    ('ministries',             'id',                            '',            '',               '',                               true,  ''),
    ('guests',                 'id',                            '',            '',               '',                               true,  ''),
    ('positions',              'code',                          '',            '',               '',                               true,  ''),
    ('team_settings',          'id',                            '',            '',               '',                               true,  ''),
    ('forecast_exits',         'id',                            'member_id',   '',               '',                               true,  'member_id:members'),
    ('forecast_heirs',         'role_title,member_id',          'member_id',   '',               '',                               true,  'member_id:members')
  ) v(tbl, keys, mcol, acol, skip, on_delete, parents) loop
    execute format('drop trigger if exists audit_row on public.%I', t.tbl);
    execute format('create trigger audit_row after insert or update %s on public.%I for each row execute function public.audit_row(%L, %L, %L, %L, %L)',
                   case when t.on_delete then 'or delete' else '' end, t.tbl, t.keys, t.mcol, t.acol, t.skip, t.parents);
  end loop;
end $$;

-- 멤버가 지워지면(탈퇴 · 삭제 · 초기화) 그 사람에 관한 기록을 지우고 이름 한 줄만 남김
create or replace function public.audit_forget_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare who uuid := auth.uid();
begin
  delete from public.audit_log where member_ref = old.id;
  insert into public.audit_log (actor, actor_name, tbl, op, row_key, label, old_row)
  values (who, (select name from public.members where id = who), 'members', 'DELETE',
          jsonb_build_object('id', old.id), old.name, jsonb_build_object('name', old.name, 'main_position', old.main_position));
  return null;
end;
$$;
drop trigger if exists audit_forget_member on public.members;
create trigger audit_forget_member after delete on public.members
  for each row execute function public.audit_forget_member();

-- 지원서가 지워지면(탈퇴 · 3개월 지난 종료 지원서 파기) 그 지원서에 관한 기록도 지움 (한 줄도 남기지 않음)
create or replace function public.audit_forget_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.audit_log where app_ref = old.id;
  return null;
end;
$$;
drop trigger if exists audit_forget_application on public.applications;
create trigger audit_forget_application after delete on public.applications
  for each row execute function public.audit_forget_application();


-- ---------------------------------------------------------------------
-- 2. 되살리기 · 되돌리기 (리더십)
--    지운 것: 그 줄을 그대로 다시 넣음 (같은 자리에 이미 다른 게 있으면 안 됨)
--    바꾼 것: 바뀐 칸을 이전 값으로 — 그 뒤에 또 바뀐 칸이 있으면 안 됨
-- ---------------------------------------------------------------------
create or replace function public.restore_audit(p_id bigint)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.audit_log;
  cond text; cur jsonb; k text; moved text[] := '{}'; cols text;
  undeletable text[] := array['member_notes', 'member_skills', 'member_extra_positions', 'interview_evaluations', 'trainee_postpones',
                              'attendance', 'practice_attendance', 'assignments', 'forecast_exits', 'forecast_heirs'];
begin
  if not public.is_admin() then raise exception '리더십만 할 수 있어요.'; end if;
  select * into a from public.audit_log where id = p_id for update;
  if a.id is null then raise exception '기록을 찾을 수 없어요.'; end if;
  if a.restored_at is not null then raise exception '이미 되살린 기록이에요.'; end if;
  if a.op = 'INSERT' then raise exception '새로 넣은 기록은 되돌릴 수 없어요. 그 화면에서 직접 지워 주세요.'; end if;
  select string_agg(format('%I::text = %L', x, a.row_key ->> x), ' and ') into cond from jsonb_object_keys(a.row_key) x;
  if cond is null then raise exception '이 기록은 되살릴 수 없어요.'; end if;

  if a.op = 'DELETE' then
    if a.tbl <> all (undeletable) then raise exception '이 종류는 되살릴 수 없어요.'; end if;
    execute format('select to_jsonb(t) from public.%I t where %s', a.tbl, cond) into cur;
    if cur is not null then raise exception '같은 자리에 이미 다른 기록이 있어요.'; end if;
    begin
      execute format('insert into public.%I overriding system value select * from jsonb_populate_record(null::public.%I, $1)', a.tbl, a.tbl) using a.old_row;
    exception
      when foreign_key_violation then raise exception '연결된 일정이나 사람이 지금은 없어서 되살릴 수 없어요.';
      when unique_violation then raise exception '같은 자리에 이미 다른 기록이 있어요.';
    end;
  else
    execute format('select to_jsonb(t) from public.%I t where %s for update', a.tbl, cond) into cur;
    if cur is null then raise exception '그 기록이 지금은 없어요.'; end if;
    foreach k in array a.changed loop
      if (cur -> k) is distinct from (a.new_row -> k) then moved := moved || k; end if;
    end loop;
    if cardinality(moved) > 0 then
      raise exception '그 뒤에 또 바뀐 칸이 있어서 되돌릴 수 없어요 (%).', array_to_string(moved, ', ');
    end if;
    select string_agg(format('%I', x), ', ') into cols from unnest(a.changed) x;
    execute format('update public.%I set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where %s',
                   a.tbl, cols, cols, a.tbl, cond) using (cur || a.old_row);
  end if;
  update public.audit_log set restored_at = now(), restored_by = auth.uid() where id = a.id;
  return json_build_object('ok', true, 'tbl', a.tbl, 'op', a.op);
end;
$$;

revoke all on function public.restore_audit(bigint) from public, anon;
grant execute on function public.restore_audit(bigint) to authenticated;


-- ---------------------------------------------------------------------
-- 3. 동시 수정 보호
--    화면을 열었을 때의 값(before)과 저장할 값(after)을 함께 보냄
--    → 내가 바꾼 칸만 저장. 그 사이 다른 리더가 같은 칸을 다르게 바꿨으면 아무것도 저장하지 않고 409
--      (details에 어떤 칸이 지금 무엇인지 담아 돌려줌 → 화면에서 보여 주고, 한 번 더 누르면 내 값으로)
-- ---------------------------------------------------------------------
create or replace function public.jnull(v jsonb)
returns jsonb
language sql
immutable
as $$ select coalesce(v, 'null'::jsonb); $$;

create or replace function public.save_member(p_id uuid, p_before jsonb, p_after jsonb)
returns json
language plpgsql
security invoker
set search_path = public
as $$
declare
  m public.members;
  cur jsonb;
  k text; b jsonb; a jsonb; c jsonb;
  cols text[] := '{}';
  bad jsonb := '[]'::jsonb;
  prof text[] := array['name', 'phone', 'small_group', 'served_since', 'main_position', 'gender', 'cohort', 'birth_date', 'gift_join', 'role_title'];
  lbl jsonb := '{"name":"이름","phone":"연락처","small_group":"순모임","served_since":"함께한 날","main_position":"주 포지션","gender":"성별","cohort":"기수","birth_date":"생년월일","gift_join":"생일선물 정산","role_title":"리더십 직책"}';
  bx text[]; ax text[]; cx text[];
  sk text[]; skill_set jsonb := '{}'; note_set boolean := false;
  newmain text;
begin
  if not public.is_admin() then raise exception '리더십만 할 수 있어요.'; end if;
  select * into m from public.members where id = p_id for update;
  if m.id is null then raise exception '멤버를 찾을 수 없어요.'; end if;
  cur := to_jsonb(m);

  -- 1) 기본 정보
  foreach k in array prof loop
    if not (p_after ? k) then continue; end if;
    b := jnull(p_before -> k); a := jnull(p_after -> k); c := jnull(cur -> k);
    if a is distinct from b then
      if c is distinct from b and c is distinct from a then
        bad := bad || jsonb_build_object('field', k, 'label', lbl ->> k, 'now', c);
      elsif c is distinct from a then
        cols := cols || k;
      end if;
    end if;
  end loop;

  -- 2) 숙련도: 포지션마다
  if p_after ? 'skills' then
    select array_agg(distinct x) into sk from (
      select jsonb_object_keys(coalesce(p_before -> 'skills', '{}'::jsonb)) x
      union select jsonb_object_keys(p_after -> 'skills')) t;
    foreach k in array coalesce(sk, '{}') loop
      b := jnull(p_before -> 'skills' -> k); a := jnull(p_after -> 'skills' -> k);
      if a is distinct from b then
        select jnull(to_jsonb(level)) into c from public.member_skills where member_id = p_id and position_code = k;
        c := jnull(c);
        if c is distinct from b and c is distinct from a then
          bad := bad || jsonb_build_object('field', 'skill:' || k, 'label', '숙련도 · ' || coalesce((select name from public.positions where code = k), k), 'now', c);
        elsif c is distinct from a then
          skill_set := skill_set || jsonb_build_object(k, a);
        end if;
      end if;
    end loop;
  end if;

  -- 3) 리더십 메모
  if p_after ? 'note' then
    b := jnull(p_before -> 'note'); a := jnull(p_after -> 'note');
    if a is distinct from b then
      select to_jsonb(note) into c from public.member_notes where member_id = p_id;
      c := jnull(c);
      if c is distinct from b and c is distinct from a then
        bad := bad || jsonb_build_object('field', 'note', 'label', '리더십 메모', 'now', c);
      elsif c is distinct from a then
        note_set := true;
      end if;
    end if;
  end if;

  if jsonb_array_length(bad) > 0 then
    raise exception using errcode = 'PT409',
      message = '다른 리더가 먼저 고친 칸이 있어요: ' || (select string_agg(x ->> 'label', ', ') from jsonb_array_elements(bad) x),
      detail = bad::text;
  end if;

  -- 저장: 기본 정보 (직책은 다른 사람이 맡고 있으면 그 사람 것을 비우고 옮김 — 한 번에)
  if 'role_title' = any (cols) and jnull(p_after -> 'role_title') <> 'null'::jsonb then
    update public.members set role_title = null where role_title = p_after ->> 'role_title' and id <> p_id;
  end if;
  if cardinality(cols) > 0 then
    execute format('update public.members set (%s) = (select %s from jsonb_populate_record(null::public.members, $1)) where id = $2',
                   array_to_string(array(select format('%I', x) from unnest(cols) x), ', '),
                   array_to_string(array(select format('%I', x) from unnest(cols) x), ', '))
      using p_after, p_id;
  end if;
  select main_position into newmain from public.members where id = p_id;

  -- 추가 포지션: 내가 더한 것만 더하고 뺀 것만 뺌 (그 사이 다른 리더가 바꾼 것은 그대로)
  if p_after ? 'extras' then
    bx := array(select jsonb_array_elements_text(coalesce(p_before -> 'extras', '[]'::jsonb)));
    ax := array(select jsonb_array_elements_text(p_after -> 'extras'));
    insert into public.member_extra_positions (member_id, position_code)
      select p_id, x from unnest(ax) x where x <> all (bx) and x is distinct from newmain
      on conflict do nothing;
    delete from public.member_extra_positions
     where member_id = p_id and position_code = any (array(select unnest(bx) except select unnest(ax)));
  end if;
  delete from public.member_extra_positions where member_id = p_id and position_code = newmain;

  -- 숙련도
  for k, a in select * from jsonb_each(skill_set) loop
    if a = 'null'::jsonb then
      delete from public.member_skills where member_id = p_id and position_code = k;
    else
      insert into public.member_skills (member_id, position_code, level) values (p_id, k, (a #>> '{}')::smallint)
        on conflict (member_id, position_code) do update set level = excluded.level, updated_at = now();
    end if;
  end loop;

  -- 메모
  if note_set then
    if jnull(p_after -> 'note') = 'null'::jsonb or trim(p_after ->> 'note') = '' then
      delete from public.member_notes where member_id = p_id;
    else
      insert into public.member_notes (member_id, note, updated_by) values (p_id, p_after ->> 'note', auth.uid())
        on conflict (member_id) do update set note = excluded.note, updated_by = excluded.updated_by;
    end if;
  end if;

  return json_build_object('ok', true, 'changed', cols, 'skills', skill_set, 'note', note_set);
end;
$$;

revoke all on function public.save_member(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_member(uuid, jsonb, jsonb) to authenticated;

-- 지원서 관리자 메모 · 수습 주간 기록
create or replace function public.save_fields(p_table text, p_key jsonb, p_before jsonb, p_after jsonb)
returns json
language plpgsql
security invoker
set search_path = public
as $$
declare
  allowed text[]; keys text[]; lbl jsonb;
  cond text; cur jsonb; k text; b jsonb; a jsonb; c jsonb;
  cols text[] := '{}'; bad jsonb := '[]'::jsonb; rowdata jsonb;
begin
  if not public.is_admin() then raise exception '리더십만 할 수 있어요.'; end if;
  if p_table = 'applications' then
    allowed := array['admin_memo']; keys := array['id']; lbl := '{"admin_memo":"관리자 메모"}';
  elsif p_table = 'trainee_weeks' then
    allowed := array['leader_id', 'sat_attended', 'sun_attended', 'note']; keys := array['application_id', 'week'];
    lbl := '{"leader_id":"나눔 리더","sat_attended":"토 연습","sun_attended":"주일 참관","note":"주간 기록"}';
  else
    raise exception '저장할 수 없는 항목이에요.';
  end if;
  if exists (select 1 from unnest(keys) x where p_key ->> x is null) then raise exception '대상이 지정되지 않았어요.'; end if;
  select string_agg(format('%I::text = %L', x, p_key ->> x), ' and ') into cond from unnest(keys) x;
  execute format('select to_jsonb(t) from public.%I t where %s for update', p_table, cond) into cur;
  if cur is null and p_table <> 'trainee_weeks' then raise exception '대상을 찾을 수 없어요.'; end if;

  foreach k in array allowed loop
    if not (p_after ? k) then continue; end if;
    b := jnull(p_before -> k); a := jnull(p_after -> k); c := jnull(cur -> k);
    if a is distinct from b then
      if c is distinct from b and c is distinct from a then
        bad := bad || jsonb_build_object('field', k, 'label', lbl ->> k, 'now', c);
      elsif c is distinct from a then
        cols := cols || k;
      end if;
    end if;
  end loop;
  if jsonb_array_length(bad) > 0 then
    raise exception using errcode = 'PT409',
      message = '다른 리더가 먼저 고친 칸이 있어요: ' || (select string_agg(x ->> 'label', ', ') from jsonb_array_elements(bad) x),
      detail = bad::text;
  end if;
  if cardinality(cols) = 0 then return json_build_object('ok', true, 'changed', cols); end if;

  rowdata := p_after;
  if p_table = 'trainee_weeks' then
    rowdata := rowdata || jsonb_build_object('updated_by', auth.uid());
    cols := cols || 'updated_by'::text;
  end if;
  if cur is null then
    execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)', p_table,
                   array_to_string(array(select format('%I', x) from unnest(keys || cols) x), ', '),
                   array_to_string(array(select format('%I', x) from unnest(keys || cols) x), ', '), p_table)
      using rowdata || p_key;
  else
    execute format('update public.%I set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where %s', p_table,
                   array_to_string(array(select format('%I', x) from unnest(cols) x), ', '),
                   array_to_string(array(select format('%I', x) from unnest(cols) x), ', '), p_table, cond)
      using rowdata;
  end if;
  return json_build_object('ok', true, 'changed', cols);
end;
$$;

revoke all on function public.save_fields(text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_fields(text, jsonb, jsonb, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- 4. 예약 알림: 보내기 전에 자리 잡기
--    done = false 인 줄 = 지금 누군가 보내는 중. 10분이 지나도 끝나지 않았으면(서버가 중간에 멈춤) 다시 잡을 수 있어요
-- ---------------------------------------------------------------------
alter table public.notify_sent
  add column if not exists done       boolean not null default true,
  add column if not exists claimed_at timestamptz;

create or replace function public.claim_notify(p_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notify_sent (key, sent_at, done, claimed_at) values (p_key, now(), false, now())
  on conflict (key) do nothing;
  if found then return true; end if;
  update public.notify_sent set claimed_at = now()
   where key = p_key and not done and claimed_at < now() - interval '10 minutes';
  return found;
end;
$$;
revoke all on function public.claim_notify(text) from public, anon, authenticated;
grant execute on function public.claim_notify(text) to service_role;


-- ---------------------------------------------------------------------
-- 5. 백업 기록 (GitHub Actions가 백업을 마치면 한 줄 넣어요)
-- ---------------------------------------------------------------------
create table if not exists public.backup_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  ok          boolean not null default true,
  size_bytes  bigint,
  note        text check (length(note) <= 300)
);
alter table public.backup_log enable row level security;
drop policy if exists backup_log_read on public.backup_log;
create policy backup_log_read on public.backup_log for select using (public.is_admin());


-- ---------------------------------------------------------------------
-- 6. 초기화(018)에 변경 기록 포함 — 초기화하면 기록도 비우고 '초기화' 한 줄만 남김
-- ---------------------------------------------------------------------
create or replace function public.reset_team_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.forecast_heirs where true;
  delete from public.forecast_exits where true;

  delete from public.poll_votes where true;
  delete from public.poll_options where true;
  delete from public.polls where true;

  delete from public.notification_inbox where true;
  delete from public.notifications where true;
  delete from public.notify_sent where true;

  delete from public.prayer_taps where true;
  delete from public.prayers where true;

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

  delete from public.applications a
   where a.user_id is null
      or not exists (select 1 from public.members m where m.id = a.user_id);
  delete from public.alumni where true;

  delete from public.audit_log where true;
  insert into public.audit_log (tbl, op, label) values ('reset', 'DELETE', '초기화');
end;
$$;

revoke all on function public.reset_team_data() from public, anon, authenticated;
grant execute on function public.reset_team_data() to service_role;

-- 확인: select tbl, op, label, actor_name, at from audit_log order by id desc limit 10;
--       select key, done from notify_sent order by sent_at desc limit 5;
