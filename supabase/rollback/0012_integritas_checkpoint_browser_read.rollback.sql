begin;

drop policy if exists "read authorized case checkpoints" on public.integritas_case_job_checkpoints;
revoke all on table public.integritas_case_job_checkpoints from anon, authenticated;

drop policy if exists "deny browser output artifacts" on public.integritas_case_job_outputs;
revoke all on table public.integritas_case_job_outputs from anon, authenticated;

commit;
