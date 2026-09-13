-- Safe rollback for 0002_integritas_browser_read_policies.sql.
-- This intentionally returns browser roles to server-only/default-deny behavior and does NOT
-- restore any historical broad anon/authenticated table grants. service_role access is preserved.
begin;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
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
  ]
  loop
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
  end loop;
end;
$$;

drop policy if exists "read own admin identity" on public.integritas_admin_users;
drop policy if exists "read own case access" on public.integritas_case_access;
drop policy if exists "read authorized cases" on public.integritas_cases;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'integritas_case_jobs',
    'integritas_documents',
    'integritas_entities',
    'integritas_checks',
    'integritas_findings',
    'integritas_relationships',
    'integritas_reports',
    'integritas_sources',
    'integritas_tool_invocations',
    'integritas_audit_events'
  ]
  loop
    execute format('drop policy if exists "read authorized case rows" on public.%I', table_name);
  end loop;
end;
$$;

drop policy if exists "read authorized agent threads" on public.integritas_agent_threads;
drop policy if exists "read authorized thread messages" on public.integritas_agent_messages;
drop policy if exists "read own change sets" on public.integritas_change_sets;
drop policy if exists "read own repositories" on public.integritas_repositories;
drop policy if exists "read agent lessons as admin" on public.integritas_agent_lessons;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'integritas_deploy_jobs',
    'integritas_e2e_runs',
    'mcp_allowed_email_hashes',
    'opencode_efficiency_test',
    'opencode_jobs',
    'opencode_runs',
    'opencode_selftest',
    'opencode_sessions'
  ]
  loop
    execute format('drop policy if exists "deny browser access" on public.%I', table_name);
  end loop;
end;
$$;

revoke all on function public.integritas_is_admin() from public, authenticated, service_role;
revoke all on function public.integritas_can_access_case(uuid) from public, authenticated, service_role;
revoke all on function public.integritas_can_access_thread(uuid) from public, authenticated, service_role;
drop function if exists public.integritas_can_access_thread(uuid);
drop function if exists public.integritas_can_access_case(uuid);
drop function if exists public.integritas_is_admin();

commit;
