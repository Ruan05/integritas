begin;

create or replace function integritas_private.integritas_fail_control_command(
  p_command_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_summary text
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_cancel boolean := false;
  v_job public.integritas_case_jobs;
  v_attempt integer;
begin
  select j.* into v_job
  from public.integritas_case_jobs j
  where j.control_command_id=p_command_id
    and j.runtime_provider='openclaw-oracle';
  if found then v_cancel := v_job.cancel_requested; end if;

  select attempt into v_attempt
  from public.integritas_control_commands
  where id=p_command_id;

  update public.integritas_control_commands
  set status = case when v_cancel then 'cancelled' else 'failed' end,
      error_code = left(coalesce(p_error_code,'failed'),120),
      error_summary = left(coalesce(p_error_summary,'command failed'),1000),
      completed_at=now(),updated_at=now(),lease_expires_at=null
  where id=p_command_id and lease_owner=p_worker_id
    and status in ('leased','running');
  if not found then return false; end if;

  if v_job.id is not null then
    update public.integritas_case_jobs
    set stage=case when v_cancel then 'cancelled' else 'failed' end,
        progress=case when v_cancel then 100 else progress end,
        current_attempt=coalesce(v_attempt,current_attempt),
        updated_at=now()
    where id=v_job.id;

    insert into public.integritas_case_job_checkpoints(
      case_id,case_job_id,case_revision,attempt,stage,progress,safe_metadata
    ) values (
      v_job.case_id,v_job.id,v_job.case_revision,coalesce(v_attempt,v_job.current_attempt),
      case when v_cancel then 'cancelled' else 'failed' end,
      case when v_cancel then 100 else v_job.progress end,
      jsonb_build_object('message',left(coalesce(p_error_code,'failed'),120))
    ) on conflict (case_job_id,attempt,stage) do update
      set progress=greatest(public.integritas_case_job_checkpoints.progress,excluded.progress),
          safe_metadata=excluded.safe_metadata,updated_at=now();
  end if;

  insert into public.integritas_control_audit(
    command_id,event_type,actor_type,actor_id,metadata
  ) values (
    p_command_id,case when v_cancel then 'cancelled' else 'failed' end,
    'worker',p_worker_id,
    jsonb_build_object(
      'error_code',left(coalesce(p_error_code,'failed'),120),
      'attempt',coalesce(v_attempt,0)
    )
  );
  return true;
end;
$$;

commit;
