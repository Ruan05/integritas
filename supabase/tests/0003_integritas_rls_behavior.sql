\set ON_ERROR_STOP on

create extension if not exists pgtap;
select plan(14);

select ok(
  not has_table_privilege('anon', 'public.integritas_cases', 'SELECT'),
  'anon cannot read Integritas cases'
);
select ok(
  not has_table_privilege('anon', 'public.integritas_agent_messages', 'SELECT'),
  'anon cannot read agent messages'
);
select ok(
  not has_table_privilege('anon', 'public.mcp_allowed_email_hashes', 'SELECT'),
  'anon cannot read allowlist hashes'
);
select ok(
  not has_table_privilege('authenticated', 'public.integritas_cases', 'INSERT'),
  'browser authenticated role cannot insert cases directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.integritas_findings', 'UPDATE'),
  'browser authenticated role cannot update findings directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.integritas_deploy_jobs', 'SELECT'),
  'deploy jobs remain server-only'
);
select ok(
  not has_table_privilege('authenticated', 'public.integritas_e2e_runs', 'SELECT'),
  'E2E token table remains server-only'
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
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);

select is(
  (select count(*)::int from public.integritas_cases),
  1,
  'case member sees only authorized case'
);
select is(
  (select count(*)::int from public.integritas_documents),
  1,
  'case member sees only authorized case documents'
);
select is(
  (select count(*)::int from public.integritas_admin_users),
  0,
  'non-admin cannot read another admin identity'
);

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is(
  (select count(*)::int from public.integritas_cases),
  2,
  'admin can read all cases'
);
select is(
  (select count(*)::int from public.integritas_documents),
  2,
  'admin can read all case documents'
);
select is(
  (select count(*)::int from public.integritas_admin_users),
  1,
  'admin can read own admin identity only'
);

reset role;
select ok(
  has_function_privilege('authenticated', 'public.integritas_can_access_case(uuid)', 'EXECUTE'),
  'authenticated role can execute case access helper'
);

select * from finish();
