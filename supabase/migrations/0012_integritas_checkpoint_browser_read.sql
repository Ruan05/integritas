begin;

-- These tables were created after the original browser-policy baseline.
-- Expose durable checkpoints read-only to authorized case members; keep raw
-- output-artifact registrations server-only.
revoke all on table public.integritas_case_job_checkpoints from anon, authenticated;
grant select on table public.integritas_case_job_checkpoints to authenticated;

drop policy if exists "read authorized case checkpoints" on public.integritas_case_job_checkpoints;
create policy "read authorized case checkpoints"
  on public.integritas_case_job_checkpoints
  for select
  to authenticated
  using (integritas_private.integritas_can_access_case(case_id));

revoke all on table public.integritas_case_job_outputs from anon, authenticated;
drop policy if exists "deny browser output artifacts" on public.integritas_case_job_outputs;
create policy "deny browser output artifacts"
  on public.integritas_case_job_outputs
  for select
  to authenticated
  using (false);

commit;
