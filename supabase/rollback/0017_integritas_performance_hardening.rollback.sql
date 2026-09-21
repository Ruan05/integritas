\set ON_ERROR_STOP on

alter policy "read own admin identity"
  on public.integritas_admin_users
  using (user_id = auth.uid());

alter policy "read own case access"
  on public.integritas_case_access
  using (user_id = auth.uid());

alter policy "read authorized agent threads"
  on public.integritas_agent_threads
  using (
    integritas_private.integritas_is_admin()
    or (
      created_by = auth.uid()
      and (
        case_id is null
        or integritas_private.integritas_can_access_case(case_id)
      )
    )
  );

alter policy "read own change sets"
  on public.integritas_change_sets
  using (
    requested_by = auth.uid()
    or integritas_private.integritas_is_admin()
  );

alter policy "read own repositories"
  on public.integritas_repositories
  using (
    requested_by = auth.uid()
    or integritas_private.integritas_is_admin()
  );

drop index if exists public.integritas_finding_source_links_source_id_idx;
drop index if exists public.integritas_finding_source_links_finding_id_idx;
drop index if exists public.integritas_finding_source_links_case_id_idx;
drop index if exists public.integritas_control_audit_command_id_idx;
drop index if exists public.integritas_case_job_outputs_case_id_idx;
drop index if exists public.integritas_case_job_checkpoints_case_id_idx;
