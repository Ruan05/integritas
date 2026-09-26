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

select pg_temp.assert_true(
  not has_function_privilege('authenticated', 'public.integritas_control_enqueue(text,jsonb,text,uuid,text,uuid)', 'EXECUTE'),
  'authenticated browser role cannot execute enqueue wrapper'
);
select pg_temp.assert_true(
  not has_function_privilege('authenticated', 'public.integritas_control_lease(text,integer)', 'EXECUTE'),
  'authenticated browser role cannot execute lease wrapper'
);
select pg_temp.assert_true(
  has_function_privilege('service_role', 'public.integritas_control_enqueue(text,jsonb,text,uuid,text,uuid)', 'EXECUTE'),
  'service role can execute enqueue wrapper'
);
select pg_temp.assert_true(
  has_function_privilege('service_role', 'public.integritas_control_heartbeat(text,text,text,text,text,jsonb)', 'EXECUTE'),
  'service role can execute heartbeat wrapper'
);

set role service_role;
select (public.integritas_control_enqueue(
  'health', '{}'::jsonb, 'edge:test', null,
  'wrapper-test-health-0001', null
)).id as wrapper_command_id \gset
select pg_temp.assert_true(
  (select command_type = 'health' and status = 'queued'
     from public.integritas_control_commands
     where id = :'wrapper_command_id'::uuid),
  'wrapper enqueues a bounded command'
);

select (public.integritas_control_heartbeat(
  'wrapper-worker', 'node-test', null, 'unknown', '0.1.0', '{"bounded_control":true}'::jsonb
)).worker_id as heartbeat_worker \gset
select pg_temp.assert_true(:'heartbeat_worker' = 'wrapper-worker', 'heartbeat wrapper persists worker state');
reset role;

select 'control API wrapper assertions passed' as result;
