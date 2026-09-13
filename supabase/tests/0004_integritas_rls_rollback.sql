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
  not has_table_privilege('authenticated', 'public.integritas_cases', 'SELECT'),
  'rollback removes browser case reads'
);
select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.integritas_repositories', 'SELECT'),
  'rollback removes browser repository reads'
);
select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.integritas_cases', 'SELECT'),
  'rollback preserves anonymous denial'
);
select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.opencode_jobs', 'SELECT'),
  'rollback preserves server-only OpenCode jobs'
);
select pg_temp.assert_true(
  (select count(*) from pg_policies where schemaname='public' and (
    tablename like 'integritas_%' or tablename like 'opencode_%' or tablename='mcp_allowed_email_hashes'
  )) = 0,
  'rollback removes staged policies cleanly'
);
select pg_temp.assert_true(
  to_regprocedure('public.integritas_is_admin()') is null,
  'rollback removes admin helper'
);
select pg_temp.assert_true(
  to_regprocedure('public.integritas_can_access_case(uuid)') is null,
  'rollback removes case access helper'
);
select pg_temp.assert_true(
  to_regprocedure('public.integritas_can_access_thread(uuid)') is null,
  'rollback removes thread access helper'
);

select 'RLS rollback assertions passed' as result;
