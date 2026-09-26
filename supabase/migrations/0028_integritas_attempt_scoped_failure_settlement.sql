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

create or replace function integritas_private.integritas_cancel_case_investigation(
  p_case_job_id uuid,
  p_requested_by uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_job public.integritas_case_jobs;
  v_command public.integritas_control_commands;
begin
  if p_requested_by is null
    or not exists (select 1 from public.integritas_admin_users where user_id = p_requested_by) then
    raise exception 'admin required';
  end if;
  select j.* into v_job
  from public.integritas_case_jobs j
  where j.id = p_case_job_id and j.runtime_provider = 'openclaw-oracle'
  for update;
  if not found then raise exception 'investigation job not found'; end if;
  if not exists (
    select 1 from public.integritas_case_access a
    where a.case_id = v_job.case_id and a.user_id = p_requested_by
  ) then raise exception 'case access denied'; end if;
  select * into v_command
  from public.integritas_control_commands where id = v_job.control_command_id
  for update;
  if not found or v_command.command_type <> 'run_case_investigation' then
    raise exception 'investigation command not found';
  end if;
  update public.integritas_case_jobs
  set cancel_requested = true, updated_at = now()
  where id = v_job.id;

  if v_command.status = 'queued' then
    update public.integritas_control_commands
    set status = 'cancelled', completed_at = now(), updated_at = now(),
        lease_owner = null, lease_expires_at = null,
        result_summary = jsonb_build_object('cancelled',true,'before_execution',true)
    where id = v_command.id;
    update public.integritas_case_jobs
    set stage = 'cancelled', progress = 100, current_attempt = v_command.attempt, updated_at = now()
    where id = v_job.id;
    insert into public.integritas_case_job_checkpoints(
      case_id,case_job_id,case_revision,attempt,stage,progress,safe_metadata
    ) values (
      v_job.case_id,v_job.id,v_job.case_revision,v_command.attempt,'cancelled',100,
      jsonb_build_object('message','cancelled before execution')
    ) on conflict (case_job_id,attempt,stage) do update
      set progress=100,safe_metadata=excluded.safe_metadata,updated_at=now();
  end if;

  insert into public.integritas_control_audit(
    command_id,event_type,actor_type,actor_id,metadata
  ) values (
    v_command.id,'cancel_requested','admin',p_requested_by::text,
    jsonb_build_object('case_job_id',v_job.id,'command_status',v_command.status)
  );
  return jsonb_build_object(
    'case_job_id',v_job.id,
    'control_command_id',v_command.id,
    'cancel_requested',true,
    'command_status',case when v_command.status='queued' then 'cancelled' else v_command.status end
  );
end;
$$;

create or replace function integritas_private.integritas_acknowledge_case_investigation_cancel(
  p_command_id uuid,
  p_worker_id text,
  p_case_job_id uuid
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_job public.integritas_case_jobs;
  v_attempt integer;
begin
  select j.* into v_job
  from public.integritas_case_jobs j
  join public.integritas_control_commands cmd on cmd.id = j.control_command_id
  where j.id = p_case_job_id and cmd.id = p_command_id
    and j.runtime_provider = 'openclaw-oracle'
    and j.cancel_requested = true
    and cmd.command_type = 'run_case_investigation'
    and cmd.lease_owner = p_worker_id
    and cmd.status in ('leased','running')
  for update of j;
  if not found then return false; end if;
  select attempt into v_attempt from public.integritas_control_commands where id=p_command_id;

  update public.integritas_control_commands
  set status='cancelled', completed_at=now(), updated_at=now(),
      lease_expires_at=null, result_summary=jsonb_build_object('cancelled',true)
  where id=p_command_id and lease_owner=p_worker_id
    and status in ('leased','running');
  if not found then return false; end if;
  update public.integritas_case_jobs
  set stage='cancelled', progress=100, current_attempt=v_attempt, updated_at=now()
  where id=v_job.id;
  insert into public.integritas_case_job_checkpoints(
    case_id,case_job_id,case_revision,attempt,stage,progress,safe_metadata
  ) values (
    v_job.case_id,v_job.id,v_job.case_revision,v_attempt,'cancelled',100,
    jsonb_build_object('message','cancellation acknowledged by worker')
  ) on conflict (case_job_id,attempt,stage) do update
    set progress=100,safe_metadata=excluded.safe_metadata,updated_at=now();
  insert into public.integritas_control_audit(
    command_id,event_type,actor_type,actor_id,metadata
  ) values (
    p_command_id,'cancelled','worker',p_worker_id,
    jsonb_build_object('case_job_id',v_job.id)
  );
  return true;
end;
$$;

create or replace function integritas_private.integritas_pause_case_investigation(
  p_case_job_id uuid, p_requested_by uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_job public.integritas_case_jobs;
  v_command public.integritas_control_commands;
begin
  if p_requested_by is null or not exists (select 1 from public.integritas_admin_users where user_id=p_requested_by) then
    raise exception 'admin required';
  end if;
  select j.* into v_job from public.integritas_case_jobs j
  where j.id=p_case_job_id and j.runtime_provider='openclaw-oracle' for update;
  if not found then raise exception 'investigation job not found'; end if;
  if not exists (select 1 from public.integritas_case_access a where a.case_id=v_job.case_id and a.user_id=p_requested_by) then
    raise exception 'case access denied';
  end if;
  select * into v_command from public.integritas_control_commands where id=v_job.control_command_id for update;
  if not found or v_command.command_type <> 'run_case_investigation' then raise exception 'investigation command not found'; end if;
  if v_command.status in ('completed','failed','cancelled','paused') then raise exception 'investigation is not pausable'; end if;

  update public.integritas_case_jobs set pause_requested=true, updated_at=now() where id=v_job.id;
  if v_command.status='queued' then
    update public.integritas_control_commands
      set status='paused', lease_owner=null, lease_expires_at=null, updated_at=now(),
          result_summary=jsonb_build_object('paused',true,'before_execution',true)
      where id=v_command.id;
    update public.integritas_case_jobs set stage='paused', current_attempt=v_command.attempt, updated_at=now() where id=v_job.id;
    insert into public.integritas_case_job_checkpoints(case_id,case_job_id,case_revision,attempt,stage,progress,safe_metadata)
      values(v_job.case_id,v_job.id,v_job.case_revision,v_command.attempt,'paused',v_job.progress,jsonb_build_object('message','paused before execution'))
      on conflict (case_job_id,attempt,stage) do update set progress=excluded.progress,safe_metadata=excluded.safe_metadata,updated_at=now();
  end if;
  insert into public.integritas_control_audit(command_id,event_type,actor_type,actor_id,metadata)
    values(v_command.id,'pause_requested','admin',p_requested_by::text,jsonb_build_object('case_job_id',v_job.id));
  return jsonb_build_object('case_job_id',v_job.id,'command_status',case when v_command.status='queued' then 'paused' else v_command.status end,'pause_requested',true);
end;
$$;

create or replace function integritas_private.integritas_acknowledge_case_investigation_pause(
  p_command_id uuid, p_worker_id text, p_case_job_id uuid
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_job public.integritas_case_jobs;
  v_attempt integer;
begin
  select j.* into v_job from public.integritas_case_jobs j
  join public.integritas_control_commands cmd on cmd.id=j.control_command_id
  where j.id=p_case_job_id and cmd.id=p_command_id and j.runtime_provider='openclaw-oracle'
    and j.pause_requested=true and cmd.command_type='run_case_investigation'
    and cmd.lease_owner=p_worker_id and cmd.status in ('leased','running')
  for update of j;
  if not found then return false; end if;
  select attempt into v_attempt from public.integritas_control_commands where id=p_command_id;
  update public.integritas_control_commands set status='paused', lease_expires_at=null, updated_at=now(),
    result_summary=jsonb_build_object('paused',true) where id=p_command_id and lease_owner=p_worker_id and status in ('leased','running');
  if not found then return false; end if;
  update public.integritas_case_jobs set stage='paused', current_attempt=v_attempt, updated_at=now() where id=v_job.id;
  insert into public.integritas_case_job_checkpoints(case_id,case_job_id,case_revision,attempt,stage,progress,safe_metadata)
    values(v_job.case_id,v_job.id,v_job.case_revision,v_attempt,'paused',v_job.progress,jsonb_build_object('message','pause acknowledged by worker'))
    on conflict (case_job_id,attempt,stage) do update set progress=excluded.progress,safe_metadata=excluded.safe_metadata,updated_at=now();
  insert into public.integritas_control_audit(command_id,event_type,actor_type,actor_id,metadata)
    values(p_command_id,'paused','worker',p_worker_id,jsonb_build_object('case_job_id',v_job.id));
  return true;
end;
$$;

commit;
