begin;

create or replace function integritas_private.integritas_retry_case_investigation(
  p_case_job_id uuid,
  p_requested_by uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_job public.integritas_case_jobs;
  v_command public.integritas_control_commands;
  v_current_revision integer;
  v_resume_stage text := 'queued';
  v_resume_progress integer := 0;
begin
  if p_requested_by is null
    or not exists (select 1 from public.integritas_admin_users where user_id=p_requested_by) then
    raise exception 'admin required';
  end if;
  select j.* into v_job
  from public.integritas_case_jobs j
  where j.id=p_case_job_id and j.runtime_provider='openclaw-oracle'
  for update;
  if not found then raise exception 'investigation job not found'; end if;
  select revision into v_current_revision from public.integritas_cases where id=v_job.case_id;
  if not exists (
    select 1 from public.integritas_case_access a
    where a.case_id=v_job.case_id and a.user_id=p_requested_by
  ) then raise exception 'case access denied'; end if;
  if v_current_revision <> v_job.case_revision then
    raise exception 'case revision is stale';
  end if;

  select * into v_command
  from public.integritas_control_commands where id=v_job.control_command_id
  for update;
  if not found or v_command.command_type <> 'run_case_investigation' then
    raise exception 'investigation command not found';
  end if;
  if v_command.status = 'queued' then
    return jsonb_build_object(
      'case_job_id',v_job.id,'control_command_id',v_command.id,
      'command_status','queued','stage',v_job.stage,'progress',v_job.progress
    );
  end if;
  if v_command.status not in ('failed','cancelled')
    and not (v_command.status = 'completed' and v_job.stage = 'incomplete') then
    raise exception 'investigation is not retryable';
  end if;
  select cp.stage,cp.progress into v_resume_stage,v_resume_progress
  from public.integritas_case_job_checkpoints cp
  where cp.case_job_id=v_job.id
    and cp.stage not in ('completed','incomplete','failed','cancelled','research_limit_reached')
  order by cp.progress desc,cp.updated_at desc
  limit 1;
  if not found then
    v_resume_stage := 'queued';
    v_resume_progress := 0;
  end if;

  update public.integritas_control_commands
  set status = 'queued',
      lease_owner = null,
      lease_expires_at = null,
      leased_at = null,
      completed_at = null,
      result_summary = null,
      error_code = null,
      error_summary = null,
      updated_at = now()
  where id=v_command.id;

  update public.integritas_case_jobs
  set stage=v_resume_stage, progress=v_resume_progress,
      cancel_requested=false, updated_at=now()
  where id=v_job.id;
  insert into public.integritas_control_audit(
    command_id,event_type,actor_type,actor_id,metadata
  ) values (
    v_command.id,'retry_requested','admin',p_requested_by::text,
    jsonb_build_object(
      'case_job_id',v_job.id,'resume_stage',v_resume_stage,
      'resume_progress',v_resume_progress,'prior_attempt',v_command.attempt
    )
  );
  return jsonb_build_object(
    'case_job_id',v_job.id,'control_command_id',v_command.id,
    'command_status','queued','stage',v_resume_stage,'progress',v_resume_progress
  );
end;
$$;

revoke all on function integritas_private.integritas_retry_case_investigation(uuid,uuid)
  from public, anon, authenticated;
grant execute on function integritas_private.integritas_retry_case_investigation(uuid,uuid)
  to service_role;

commit;
