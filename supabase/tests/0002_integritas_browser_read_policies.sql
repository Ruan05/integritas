-- Run after 0002_integritas_browser_read_policies on a non-production Supabase branch.
-- This checks the policy contract without creating or changing case data.
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
      'integritas_case_access',
      'integritas_cases',
      'integritas_case_jobs',
      'integritas_documents',
      'integritas_entities',
      'integritas_checks',
      'integritas_findings',
      'integritas_relationships',
      'integritas_reports',
      'integritas_sources',
      'integritas_tool_invocations',
      'integritas_audit_events',
      'integritas_agent_threads',
      'integritas_agent_messages',
      'integritas_change_sets',
      'integritas_repositories',
      'integritas_agent_lessons'
    ]) as table_name
  ) expected
  where not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = expected.table_name
  );

  if missing_policies is not null then
    raise exception 'Missing Integritas RLS policies: %', missing_policies;
  end if;

  select array_agg(tablename order by tablename)
  into anonymous_policies
  from pg_policies
  where schemaname = 'public'
    and tablename like 'integritas_%'
    and 'anon' = any(roles);

  if anonymous_policies is not null then
    raise exception 'Anonymous access policy found on: %', anonymous_policies;
  end if;
end;
$$;
