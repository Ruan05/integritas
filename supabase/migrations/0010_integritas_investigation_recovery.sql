begin;

create or replace function integritas_private.integritas_investigation_manifest_context(
  p_command_id uuid, p_worker_id text, p_case_job_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_job public.integritas_case_jobs;
  v_command public.integritas_control_commands;
  v_case public.integritas_cases;
  v_documents jsonb;
begin
  select j.* into v_job
  from public.integritas_case_jobs j
  join public.integritas_control_commands cmd on cmd.id=j.control_command_id
  join public.integritas_cases c on c.id=j.case_id
  where j.id=p_case_job_id and cmd.id=p_command_id
    and j.runtime_provider='openclaw-oracle'
    and cmd.command_type='run_case_investigation'
    and cmd.lease_owner=p_worker_id and cmd.status in ('leased','running')
    and c.revision=j.case_revision
  for update of j;
  if not found then raise exception 'investigation manifest access denied'; end if;
  select * into v_command from public.integritas_control_commands where id=p_command_id;
  select * into v_case from public.integritas_cases where id=v_job.case_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',d.id,'name',d.name,'mime_type',d.mime_type,'size_bytes',d.size_bytes,
    'sha256',d.sha256,'storage_path',d.storage_path,'extraction_status',d.extraction_status
  ) order by d.created_at,d.id),'[]'::jsonb)
  into v_documents from public.integritas_documents d where d.case_id=v_job.case_id;
  if jsonb_array_length(v_documents) < 1 or jsonb_array_length(v_documents) > 20 then
    raise exception 'investigation requires between 1 and 20 documents';
  end if;
  return jsonb_build_object(
    'command_id',v_command.id,'case_job_id',v_job.id,'case_id',v_job.case_id,
    'case_revision',v_job.case_revision,'depth',v_job.depth,
    'job_stage',v_job.stage,'job_progress',v_job.progress,
    'cancel_requested',v_job.cancel_requested,
    'case',jsonb_build_object(
      'title',v_case.title,'purpose',v_case.purpose,'authorized_scope',v_case.authorized_scope,
      'intended_subjects',v_case.intended_subjects,'jurisdictions',v_case.jurisdictions
    ),
    'documents',v_documents
  );
end;
$$;
revoke all on function integritas_private.integritas_investigation_manifest_context(uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function integritas_private.integritas_investigation_manifest_context(uuid,text,uuid)
  to service_role;

create or replace function integritas_private.integritas_investigation_job_state(
  p_command_id uuid,
  p_worker_id text,
  p_case_job_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_job public.integritas_case_jobs;
  v_current_revision integer;
  v_command_status text;
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 or length(p_worker_id) > 200 then
    raise exception 'invalid worker id';
  end if;
  select j.* into v_job
  from public.integritas_case_jobs j
  join public.integritas_control_commands cmd on cmd.id = j.control_command_id
  where j.id = p_case_job_id and cmd.id = p_command_id
    and j.runtime_provider = 'openclaw-oracle'
    and cmd.command_type = 'run_case_investigation'
    and cmd.lease_owner = p_worker_id
    and cmd.status in ('leased','running')
  for update of j;
  if not found then raise exception 'investigation state access denied'; end if;
  select revision into v_current_revision from public.integritas_cases where id=v_job.case_id;
  select status into v_command_status from public.integritas_control_commands where id=p_command_id;
  return jsonb_build_object(
    'case_revision', v_job.case_revision,
    'current_case_revision', v_current_revision,
    'stale_revision', v_current_revision <> v_job.case_revision,
    'job_stage', v_job.stage,
    'job_progress', v_job.progress,
    'cancel_requested', v_job.cancel_requested,
    'command_status', v_command_status
  );
end;
$$;

revoke all on function integritas_private.integritas_investigation_job_state(uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function integritas_private.integritas_investigation_job_state(uuid,text,uuid)
  to service_role;

create or replace function public.integritas_investigation_job_state(
  p_command_id uuid, p_worker_id text, p_case_job_id uuid
) returns jsonb
language sql security definer set search_path = ''
as $$ select integritas_private.integritas_investigation_job_state(
  p_command_id,p_worker_id,p_case_job_id
); $$;
revoke all on function public.integritas_investigation_job_state(uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function public.integritas_investigation_job_state(uuid,text,uuid) to service_role;
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
    set stage = 'cancelled', progress = 100, updated_at = now()
    where id = v_job.id;
    insert into public.integritas_case_job_checkpoints(
      case_id,case_job_id,case_revision,stage,progress,safe_metadata
    ) values (
      v_job.case_id,v_job.id,v_job.case_revision,'cancelled',100,
      jsonb_build_object('message','cancelled before execution')
    ) on conflict (case_job_id,stage) do update
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

revoke all on function integritas_private.integritas_cancel_case_investigation(uuid,uuid)
  from public, anon, authenticated;
grant execute on function integritas_private.integritas_cancel_case_investigation(uuid,uuid)
  to service_role;

create or replace function public.integritas_cancel_case_investigation(
  p_case_job_id uuid, p_requested_by uuid
) returns jsonb
language sql security definer set search_path = ''
as $$ select integritas_private.integritas_cancel_case_investigation(
  p_case_job_id,p_requested_by
); $$;
revoke all on function public.integritas_cancel_case_investigation(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.integritas_cancel_case_investigation(uuid,uuid) to service_role;
create or replace function integritas_private.integritas_acknowledge_case_investigation_cancel(
  p_command_id uuid,
  p_worker_id text,
  p_case_job_id uuid
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_job public.integritas_case_jobs;
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

  update public.integritas_control_commands
  set status='cancelled', completed_at=now(), updated_at=now(),
      lease_expires_at=null, result_summary=jsonb_build_object('cancelled',true)
  where id=p_command_id and lease_owner=p_worker_id
    and status in ('leased','running');
  if not found then return false; end if;
  update public.integritas_case_jobs
  set stage='cancelled', progress=100, updated_at=now()
  where id=v_job.id;
  insert into public.integritas_case_job_checkpoints(
    case_id,case_job_id,case_revision,stage,progress,safe_metadata
  ) values (
    v_job.case_id,v_job.id,v_job.case_revision,'cancelled',100,
    jsonb_build_object('message','cancellation acknowledged by worker')
  ) on conflict (case_job_id,stage) do update
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

revoke all on function integritas_private.integritas_acknowledge_case_investigation_cancel(uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function integritas_private.integritas_acknowledge_case_investigation_cancel(uuid,text,uuid)
  to service_role;
create or replace function public.integritas_acknowledge_case_investigation_cancel(
  p_command_id uuid, p_worker_id text, p_case_job_id uuid
) returns boolean
language sql security definer set search_path = ''
as $$ select integritas_private.integritas_acknowledge_case_investigation_cancel(
  p_command_id,p_worker_id,p_case_job_id
); $$;
revoke all on function public.integritas_acknowledge_case_investigation_cancel(uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function public.integritas_acknowledge_case_investigation_cancel(uuid,text,uuid)
  to service_role;

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
  if v_command.status not in ('failed','cancelled') then
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

create or replace function public.integritas_retry_case_investigation(
  p_case_job_id uuid, p_requested_by uuid
) returns jsonb
language sql security definer set search_path = ''
as $$ select integritas_private.integritas_retry_case_investigation(
  p_case_job_id,p_requested_by
); $$;
revoke all on function public.integritas_retry_case_investigation(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.integritas_retry_case_investigation(uuid,uuid)
  to service_role;

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
begin
  select j.* into v_job
  from public.integritas_case_jobs j
  where j.control_command_id=p_command_id
    and j.runtime_provider='openclaw-oracle';
  if found then v_cancel := v_job.cancel_requested; end if;

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
        updated_at=now()
    where id=v_job.id;
    insert into public.integritas_case_job_checkpoints(
      case_id,case_job_id,case_revision,stage,progress,safe_metadata
    ) values (
      v_job.case_id,v_job.id,v_job.case_revision,
      case when v_cancel then 'cancelled' else 'failed' end,
      case when v_cancel then 100 else v_job.progress end,
      jsonb_build_object('message',left(coalesce(p_error_code,'failed'),120))
    ) on conflict (case_job_id,stage) do update
      set progress=greatest(public.integritas_case_job_checkpoints.progress,excluded.progress),
          safe_metadata=excluded.safe_metadata,updated_at=now();
  end if;
  insert into public.integritas_control_audit(
    command_id,event_type,actor_type,actor_id,metadata
  ) values (
    p_command_id,case when v_cancel then 'cancelled' else 'failed' end,
    'worker',p_worker_id,
    jsonb_build_object('error_code',left(coalesce(p_error_code,'failed'),120))
  );
  return true;
end;
$$;

commit;
