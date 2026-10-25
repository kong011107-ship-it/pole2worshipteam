do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticator') then
    create role authenticator login password 'pw' noinherit;
  end if;
end $$;
grant anon, authenticated, service_role to authenticator;
alter table auth.users add column if not exists password text;
-- 028: Supabase realtime.send 대신 (테스트): 보낸 Broadcast를 표에 남김
create schema if not exists realtime;
create table if not exists realtime.sent (id serial primary key, topic text, event text, payload jsonb, private boolean, at timestamptz default clock_timestamp());
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void language sql as $$ insert into realtime.sent (topic, event, payload, private) values (topic, event, payload, private); $$;
