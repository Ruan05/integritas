begin;

-- Safe reprocessing for a finalized report:
-- preserve the prior finalized row as history, reopen the draft slot, and
-- restart the same case/job from queued so progress cannot inherit a stale
-- monotonic checkpoint from a previous attempt.
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
  v_existing_report public.integritas_reports;
  v_history_key text;
  v_prior_stage text;
  v_prior_progress integer;
  v_had_existing_report boolean := false;
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

  select revision into v_current_revision
  from public.integritas_cases
  where id=v_job.case_id;
  if not exists (
    select 1 from public.integritas_case_access a
    where a.case_id=v_job.case_id and a.user_id=p_requested_by
  ) then raise exception 'case access denied'; end if;
  if v_current_revision <> v_job.case_revision then
    raise exception 'case revision is stale';
  end if;

  select * into v_command
  from public.integritas_control_commands
  where id=v_job.control_command_id
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

  v_prior_stage := v_job.stage;
  v_prior_progress := v_job.progress;

  select * into v_existing_report
  from public.integritas_reports r
  where r.case_job_id=v_job.id and r.report_key='draft-report'
  for update;

  if found and v_existing_report.status <> 'draft' then
    v_had_existing_report := true;
    v_history_key := 'historical-' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS')
      || '-' || replace(substr(v_existing_report.id::text,1,8),'-','');
    insert into public.integritas_reports(
      case_id,based_on_revision,status,summary,content_markdown,created_at,
      reviewed_at,finalized_at,reviewed_by,finalized_by,limitations,
      case_job_id,report_key,bundle_sha256,report_sha256,updated_at
    )
    values(
      v_existing_report.case_id,v_existing_report.based_on_revision,
      v_existing_report.status,v_existing_report.summary,
      v_existing_report.content_markdown,v_existing_report.created_at,
      v_existing_report.reviewed_at,v_existing_report.finalized_at,
      v_existing_report.reviewed_by,v_existing_report.finalized_by,
      v_existing_report.limitations,v_existing_report.case_job_id,
      v_history_key,v_existing_report.bundle_sha256,
      v_existing_report.report_sha256,v_existing_report.updated_at
    );

    update public.integritas_reports
    set status='draft',
        reviewed_at=null,
        finalized_at=null,
        reviewed_by=null,
        finalized_by=null,
        updated_at=now()
    where id=v_existing_report.id;
  end if;

  update public.integritas_control_commands
  set status='queued',
      lease_owner=null,
      lease_expires_at=null,
      leased_at=null,
      started_at=null,
      completed_at=null,
      result_summary=null,
      error_code=null,
      error_summary=null,
      updated_at=now()
  where id=v_command.id;

  update public.integritas_case_jobs
  set stage='queued',
      progress=0,
      cancel_requested=false,
      pause_requested=false,
      updated_at=now()
  where id=v_job.id;

  insert into public.integritas_control_audit(
    command_id,event_type,actor_type,actor_id,metadata
  ) values (
    v_command.id,'retry_requested','admin',p_requested_by::text,
    jsonb_build_object(
      'case_job_id',v_job.id,
      'resume_stage','queued',
      'resume_progress',0,
      'prior_stage',v_prior_stage,
      'prior_progress',v_prior_progress,
      'replay_mode','full_deterministic_replay',
      'finalized_report_archived',v_had_existing_report
    )
  );

  return jsonb_build_object(
    'case_job_id',v_job.id,
    'control_command_id',v_command.id,
    'command_status','queued',
    'stage','queued',
    'progress',0,
    'replay_mode','full_deterministic_replay'
  );
end;
$$;

revoke all on function integritas_private.integritas_retry_case_investigation(uuid,uuid)
  from public, anon, authenticated;
grant execute on function integritas_private.integritas_retry_case_investigation(uuid,uuid)
  to service_role;

commit;
