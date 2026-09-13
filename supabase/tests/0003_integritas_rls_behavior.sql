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
  not has_table_privilege('anon', 'public.integritas_cases', 'SELECT'),
  'anon cannot read Integritas cases'
);
select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.integritas_agent_messages', 'SELECT'),
  'anon cannot read agent messages'
);
select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.mcp_allowed_email_hashes', 'SELECT'),
  'anon cannot read allowlist hashes'
);
select pg_temp.assert_true(
  not has_schema_privilege('anon', 'integritas_private', 'USAGE'),
  'anon cannot use private policy helper schema'
);
select pg_temp.assert_true(
  has_schema_privilege('authenticated', 'integritas_private', 'USAGE'),
  'authenticated role can resolve private policy helpers'
);
select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.integritas_cases', 'INSERT'),
  'browser authenticated role cannot insert cases directly'
);
select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.integritas_findings', 'UPDATE'),
  'browser authenticated role cannot update findings directly'
);
select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.integritas_repositories', 'INSERT'),
  'browser authenticated role cannot create repository records directly'
);
select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.integritas_deploy_jobs', 'SELECT'),
  'deploy jobs remain server-only'
);
select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.integritas_e2e_runs', 'SELECT'),
  'E2E token table remains server-only'
);
select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.opencode_jobs', 'SELECT'),
  'OpenCode job transport remains server-only'
);
select pg_temp.assert_true(
  to_regprocedure('public.integritas_can_access_case(uuid)') is null,
  'security-definer helper is not exposed from public schema'
);

insert into public.integritas_admin_users(user_id)
values ('00000000-0000-0000-0000-000000000001');
insert into public.integritas_cases(id, created_by) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002');
insert into public.integritas_case_access(case_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'analyst');
insert into public.integritas_documents(id, case_id) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
select pg_temp.assert_true(
  (select count(*) from public.integritas_cases) = 1,
  'case member sees only authorized case'
);
select pg_temp.assert_true(
  (select count(*) from public.integritas_documents) = 1,
  'case member sees only authorized case documents'
);
select pg_temp.assert_true(
  (select count(*) from public.integritas_admin_users) = 0,
  'non-admin cannot read another admin identity'
);

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select pg_temp.assert_true(
  (select count(*) from public.integritas_cases) = 2,
  'admin can read all cases'
);
select pg_temp.assert_true(
  (select count(*) from public.integritas_documents) = 2,
  'admin can read all case documents'
);
select pg_temp.assert_true(
  (select count(*) from public.integritas_admin_users) = 1,
  'admin can read own admin identity only'
);
reset role;

select pg_temp.assert_true(
  has_function_privilege('authenticated', 'integritas_private.integritas_can_access_case(uuid)', 'EXECUTE'),
  'authenticated role can execute private case access helper'
);
select pg_temp.assert_true(
  not has_function_privilege('anon', 'integritas_private.integritas_can_access_case(uuid)', 'EXECUTE'),
  'anon cannot execute private case access helper'
);

select 'RLS behavior assertions passed' as result;
