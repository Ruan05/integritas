-- Integritas browser read policy baseline.
-- Browser roles receive explicit read-only access where required. All writes continue through
-- the authenticated server-side Admin API/service-role path so audit and approval guards remain authoritative.
begin;

-- Keep SECURITY DEFINER helpers out of the API-exposed public schema.
create schema if not exists integritas_private;
revoke all on schema integritas_private from public;
revoke all on schema integritas_private from anon;
grant usage on schema integritas_private to authenticated, service_role;

create or replace function integritas_private.integritas_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.integritas_admin_users
    where user_id = auth.uid()
  );
$$;

create or replace function integritas_private.integritas_can_access_case(case_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select integritas_private.integritas_is_admin()
    or exists (
      select 1
      from public.integritas_case_access
      where case_id = case_uuid
        and user_id = auth.uid()
    );
$$;

create or replace function integritas_private.integritas_can_access_thread(thread_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select integritas_private.integritas_is_admin()
    or exists (
      select 1
      from public.integritas_agent_threads
      where id = thread_uuid
        and created_by = auth.uid()
        and (case_id is null or integritas_private.integritas_can_access_case(case_id))
    );
$$;

revoke all on function integritas_private.integritas_is_admin() from public;
revoke all on function integritas_private.integritas_is_admin() from anon;
revoke all on function integritas_private.integritas_can_access_case(uuid) from public;
revoke all on function integritas_private.integritas_can_access_case(uuid) from anon;
revoke all on function integritas_private.integritas_can_access_thread(uuid) from public;
revoke all on function integritas_private.integritas_can_access_thread(uuid) from anon;
grant execute on function integritas_private.integritas_is_admin() to authenticated, service_role;
grant execute on function integritas_private.integritas_can_access_case(uuid) to authenticated, service_role;
grant execute on function integritas_private.integritas_can_access_thread(uuid) to authenticated, service_role;

-- Revoke legacy/default browser grants first. Server-side service_role access is intentionally preserved.
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

-- Read-only browser grants. Direct inserts/updates/deletes remain server API responsibilities.
grant select on table
  public.integritas_admin_users,
  public.integritas_case_access,
  public.integritas_cases,
  public.integritas_case_jobs,
  public.integritas_documents,
  public.integritas_entities,
  public.integritas_checks,
  public.integritas_findings,
  public.integritas_relationships,
  public.integritas_reports,
  public.integritas_sources,
  public.integritas_tool_invocations,
  public.integritas_audit_events,
  public.integritas_agent_threads,
  public.integritas_agent_messages,
  public.integritas_change_sets,
  public.integritas_repositories,
  public.integritas_agent_lessons
  to authenticated;

drop policy if exists "read own admin identity" on public.integritas_admin_users;
create policy "read own admin identity"
  on public.integritas_admin_users for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "read own case access" on public.integritas_case_access;
create policy "read own case access"
  on public.integritas_case_access for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "read authorized cases" on public.integritas_cases;
create policy "read authorized cases"
  on public.integritas_cases for select to authenticated
  using (integritas_private.integritas_can_access_case(id));

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
    execute format(
      'create policy "read authorized case rows" on public.%I for select to authenticated using (integritas_private.integritas_can_access_case(case_id))',
      table_name
    );
  end loop;
end;
$$;

drop policy if exists "read authorized agent threads" on public.integritas_agent_threads;
create policy "read authorized agent threads"
  on public.integritas_agent_threads for select to authenticated
  using (
    integritas_private.integritas_is_admin()
    or (
      created_by = auth.uid()
      and (case_id is null or integritas_private.integritas_can_access_case(case_id))
    )
  );

drop policy if exists "read authorized thread messages" on public.integritas_agent_messages;
create policy "read authorized thread messages"
  on public.integritas_agent_messages for select to authenticated
  using (integritas_private.integritas_can_access_thread(thread_id));

drop policy if exists "read own change sets" on public.integritas_change_sets;
create policy "read own change sets"
  on public.integritas_change_sets for select to authenticated
  using (requested_by = auth.uid() or integritas_private.integritas_is_admin());

drop policy if exists "read own repositories" on public.integritas_repositories;
create policy "read own repositories"
  on public.integritas_repositories for select to authenticated
  using (requested_by = auth.uid() or integritas_private.integritas_is_admin());

drop policy if exists "read agent lessons as admin" on public.integritas_agent_lessons;
create policy "read agent lessons as admin"
  on public.integritas_agent_lessons for select to authenticated
  using (integritas_private.integritas_is_admin());

-- Explicit policies on server-only tables keep the RLS contract complete while browser table grants stay revoked.
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
    execute format(
      'create policy "deny browser access" on public.%I for select to authenticated using (false)',
      table_name
    );
  end loop;
end;
$$;

commit;
