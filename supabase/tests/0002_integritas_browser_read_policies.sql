-- Run after 0002_integritas_browser_read_policies on the disposable CI database.
-- This checks the complete policy contract without creating production data.
do $$
declare
  missing_policies text[];
  anonymous_policies text[];
begin
  select array_agg(table_name order by table_name)
  into missing_policies
  from (
    select unnest(array[
      'integritas_admin_users',
      'integritas_agent_lessons',
      'integritas_agent_messages',
      'integritas_agent_threads',
      'integritas_audit_events',
      'integritas_case_access',
      'integritas_case_jobs',
      'integritas_cases',
      'integritas_change_sets',
      'integritas_checks',
      'integritas_deploy_jobs',
      'integritas_documents',
      'integritas_e2e_runs',
      'integritas_entities',
      'integritas_findings',
      'integritas_relationships',
      'integritas_reports',
      'integritas_repositories',
      'integritas_sources',
      'integritas_tool_invocations',
      'mcp_allowed_email_hashes',
      'opencode_efficiency_test',
      'opencode_jobs',
      'opencode_runs',
      'opencode_selftest',
      'opencode_sessions'
    ]) as table_name
  ) expected
  where not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = expected.table_name
  );

  if missing_policies is not null then
    raise exception 'Missing protected-table RLS policies: %', missing_policies;
  end if;

  select array_agg(tablename order by tablename)
  into anonymous_policies
  from pg_policies
  where schemaname = 'public'
    and (
      tablename like 'integritas_%'
      or tablename like 'opencode_%'
      or tablename = 'mcp_allowed_email_hashes'
    )
    and 'anon' = any(roles);

  if anonymous_policies is not null then
    raise exception 'Anonymous access policy found on: %', anonymous_policies;
  end if;
end;
$$;
