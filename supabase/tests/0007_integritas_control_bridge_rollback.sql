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
  to_regclass('public.integritas_control_commands') is null,
  'control commands table removed by rollback'
);
select pg_temp.assert_true(
  to_regclass('public.integritas_runtime_heartbeats') is null,
  'runtime heartbeat table removed by rollback'
);
select pg_temp.assert_true(
  to_regclass('public.integritas_control_audit') is null,
  'control audit table removed by rollback'
);
select pg_temp.assert_true(
  to_regprocedure('public.integritas_control_enqueue(text,jsonb,text,uuid,text,uuid)') is null,
  'public enqueue wrapper removed by rollback'
);
select pg_temp.assert_true(
  to_regprocedure('integritas_private.integritas_lease_control_command(text,integer)') is null,
  'private lease function removed by rollback'
);

select 'control bridge rollback assertions passed' as result;
