\set ON_ERROR_STOP on

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void
language plpgsql
as $$
begin
  if not coalesce(condition, false) then
    raise exception 'ASSERTION FAILED: %', message;
  end if;
end;
$$;

-- Browser roles can observe only through RLS and cannot mutate transport state.
select pg_temp.assert_true(
  has_table_privilege('authenticated', 'public.integritas_control_commands', 'SELECT'),
  'authenticated browser role can read control commands subject to RLS'
);
select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.integritas_control_commands', 'INSERT'),
  'authenticated browser role cannot enqueue commands directly'
);
select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.integritas_control_commands', 'UPDATE'),
  'authenticated browser role cannot mutate leased commands'
);
select pg_temp.assert_true(
  not has_function_privilege('authenticated', 'integritas_private.integritas_lease_control_command(text,integer)', 'EXECUTE'),
  'browser role cannot lease worker commands'
);
select pg_temp.assert_true(
  has_function_privilege('service_role', 'integritas_private.integritas_lease_control_command(text,integer)', 'EXECUTE'),
  'service role can lease worker commands'
);

insert into public.integritas_admin_users(user_id)
values ('00000000-0000-0000-0000-000000000001')
on conflict do nothing;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
select pg_temp.assert_true(
  (select count(*) from public.integritas_control_commands) = 0,
  'non-admin cannot read control commands'
);
reset role;

-- Enqueue is idempotent and restricted to the fixed command enum.
set role service_role;
select (integritas_private.integritas_enqueue_control_command(
  'health', '{}'::jsonb, 'chatgpt:test', null,
  'test-health-idempotency-0001', null
)).id as first_id \gset

select (integritas_private.integritas_enqueue_control_command(
  'health', '{}'::jsonb, 'chatgpt:test', null,
  'test-health-idempotency-0001', null
)).id as second_id \gset

select pg_temp.assert_true(
  :'first_id' = :'second_id',
  'duplicate idempotency key returns the existing command'
);
select pg_temp.assert_true(
  (select count(*) from public.integritas_control_commands where idempotency_key = 'test-health-idempotency-0001') = 1,
  'duplicate enqueue creates one command only'
);

-- Lease is single-owner and increments attempt once.
select (integritas_private.integritas_lease_control_command('oracle-worker-test', 90)).id as lease_id \gset
select pg_temp.assert_true(:'lease_id' = :'first_id', 'worker leases queued command');
select pg_temp.assert_true(
  (select status = 'leased' and lease_owner = 'oracle-worker-test' and attempt = 1
     from public.integritas_control_commands where id = :'lease_id'::uuid),
  'lease transition records owner and attempt'
);
select pg_temp.assert_true(
  (integritas_private.integritas_lease_control_command('second-worker', 90)).id is null,
  'second worker cannot lease an active lease'
);

-- Wrong owner cannot complete; correct owner can.
select pg_temp.assert_true(
  not integritas_private.integritas_complete_control_command(:'lease_id'::uuid, 'wrong-worker', '{"ok":true}'::jsonb),
  'wrong worker cannot complete command'
);
select pg_temp.assert_true(
  integritas_private.integritas_complete_control_command(:'lease_id'::uuid, 'oracle-worker-test', '{"ok":true}'::jsonb),
  'lease owner can complete command'
);
select pg_temp.assert_true(
  (select status = 'completed' and result_summary->>'ok' = 'true'
     from public.integritas_control_commands where id = :'lease_id'::uuid),
  'completed command persists redacted result summary'
);

-- Heartbeats upsert without creating duplicate worker rows.
select (integritas_private.integritas_upsert_runtime_heartbeat(
  'oracle-primary', 'oracle-linux-9', '2026.9.4', 'healthy', 'bridge-test', '{"browser":true}'::jsonb
)).worker_id;
select (integritas_private.integritas_upsert_runtime_heartbeat(
  'oracle-primary', 'oracle-linux-9', '2026.9.4', 'healthy', 'bridge-test-2', '{"browser":true}'::jsonb
)).worker_id;
select pg_temp.assert_true(
  (select count(*) from public.integritas_runtime_heartbeats where worker_id = 'oracle-primary') = 1,
  'heartbeat uses one durable row per worker'
);
select pg_temp.assert_true(
  (select worker_version = 'bridge-test-2' from public.integritas_runtime_heartbeats where worker_id = 'oracle-primary'),
  'heartbeat updates current worker version'
);
reset role;

-- Admin browser can read durable state after RLS identity is set.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select pg_temp.assert_true(
  (select count(*) from public.integritas_control_commands) = 1,
  'admin can read control commands'
);
select pg_temp.assert_true(
  (select count(*) from public.integritas_runtime_heartbeats) = 1,
  'admin can read runtime heartbeat'
);
reset role;

select 'control bridge assertions passed' as result;
