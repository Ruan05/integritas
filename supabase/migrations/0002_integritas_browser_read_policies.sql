-- Integritas browser read policy baseline.
-- Review and apply first on a Supabase development branch. Service-role workers bypass RLS
-- and retain the existing server-side enqueue/sync access pattern.
begin;

create or replace function public.integritas_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.integritas_admin_users
    where user_id = auth.uid()
  );
$$;

create or replace function public.integritas_can_access_case(case_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.integritas_is_admin()
    or exists (
      select 1
      from public.integritas_case_access
      where case_id = case_uuid
        and user_id = auth.uid()
    );
$$;

create or replace function public.integritas_can_access_thread(thread_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.integritas_agent_threads
    where id = thread_uuid
      and public.integritas_can_access_case(case_id)
  );
$$;

revoke all on function public.integritas_is_admin() from public;
revoke all on function public.integritas_can_access_case(uuid) from public;
revoke all on function public.integritas_can_access_thread(uuid) from public;
grant execute on function public.integritas_is_admin() to authenticated, service_role;
grant execute on function public.integritas_can_access_case(uuid) to authenticated, service_role;
grant execute on function public.integritas_can_access_thread(uuid) to authenticated, service_role;

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
  using (public.integritas_can_access_case(id));

drop policy if exists "create admin-owned cases" on public.integritas_cases;
create policy "create admin-owned cases"
  on public.integritas_cases for insert to authenticated
  with check (public.integritas_is_admin() and created_by = auth.uid());

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
    'integritas_audit_events',
    'integritas_agent_threads'
  ]
  loop
    execute format('drop policy if exists "read authorized case rows" on public.%I', table_name);
    execute format(
      'create policy "read authorized case rows" on public.%I for select to authenticated using (public.integritas_can_access_case(case_id))',
      table_name
    );
  end loop;
end;
$$;

drop policy if exists "read authorized thread messages" on public.integritas_agent_messages;
create policy "read authorized thread messages"
  on public.integritas_agent_messages for select to authenticated
  using (public.integritas_can_access_thread(thread_id));

drop policy if exists "read own change sets" on public.integritas_change_sets;
create policy "read own change sets"
  on public.integritas_change_sets for select to authenticated
  using (requested_by = auth.uid() or public.integritas_is_admin());

drop policy if exists "read own repositories" on public.integritas_repositories;
create policy "read own repositories"
  on public.integritas_repositories for select to authenticated
  using (requested_by = auth.uid() or public.integritas_is_admin());

drop policy if exists "create own repositories" on public.integritas_repositories;
create policy "create own repositories"
  on public.integritas_repositories for insert to authenticated
  with check (requested_by = auth.uid());

drop policy if exists "read agent lessons as admin" on public.integritas_agent_lessons;
create policy "read agent lessons as admin"
  on public.integritas_agent_lessons for select to authenticated
  using (public.integritas_is_admin());

-- Intentionally no browser policy for deploy jobs or E2E tokens. Those tables carry
-- bearer-token hashes and remain server-only. Browser writes to investigation records
-- remain server API responsibilities, preserving audit and approval guards.

commit;
