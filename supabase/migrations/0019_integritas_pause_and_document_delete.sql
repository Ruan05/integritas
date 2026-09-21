-- Case-scoped recovery controls.  Browser callers remain server-gated by
-- integritas-control; these functions are service-role only.
begin;

alter table public.integritas_case_jobs
  add column if not exists pause_requested boolean not null default false;

alter table public.integritas_control_commands
  drop constraint if exists integritas_control_commands_status_check;
alter table public.integritas_control_commands
  add constraint integritas_control_commands_status_check
  check (status in ('queued','leased','running','paused','completed','failed','cancelled'));

alter table public.integritas_case_job_checkpoints
  drop constraint if exists integritas_case_job_checkpoints_stage_check;
alter table public.integritas_case_job_checkpoints
  add constraint integritas_case_job_checkpoints_stage_check
  check (stage in (
    'queued','extracting','analyzing_documents','mapping_entities','planning_research',
    'researching','verifying','cross_checking','independent_review','drafting_report',
    'paused','completed','incomplete','failed','cancelled','research_limit_reached'
  ));

create or replace function integritas_private.integritas_investigation_job_state(
  p_command_id uuid, p_worker_id text, p_case_job_id uuid
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
    'pause_requested', v_job.pause_requested,
    'cancel_requested', v_job.cancel_requested,
    'command_status', v_command_status
  );
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
    update public.integritas_case_jobs set stage='paused', updated_at=now() where id=v_job.id;
    insert into public.integritas_case_job_checkpoints(case_id,case_job_id,case_revision,stage,progress,safe_metadata)
      values(v_job.case_id,v_job.id,v_job.case_revision,'paused',v_job.progress,jsonb_build_object('message','paused before execution'))
      on conflict (case_job_id,stage) do update set progress=excluded.progress,safe_metadata=excluded.safe_metadata,updated_at=now();
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
declare v_job public.integritas_case_jobs;
begin
  select j.* into v_job from public.integritas_case_jobs j
  join public.integritas_control_commands cmd on cmd.id=j.control_command_id
  where j.id=p_case_job_id and cmd.id=p_command_id and j.runtime_provider='openclaw-oracle'
    and j.pause_requested=true and cmd.command_type='run_case_investigation'
    and cmd.lease_owner=p_worker_id and cmd.status in ('leased','running')
  for update of j;
  if not found then return false; end if;
  update public.integritas_control_commands set status='paused', lease_expires_at=null, updated_at=now(),
    result_summary=jsonb_build_object('paused',true) where id=p_command_id and lease_owner=p_worker_id and status in ('leased','running');
  if not found then return false; end if;
  update public.integritas_case_jobs set stage='paused', updated_at=now() where id=v_job.id;
  insert into public.integritas_case_job_checkpoints(case_id,case_job_id,case_revision,stage,progress,safe_metadata)
    values(v_job.case_id,v_job.id,v_job.case_revision,'paused',v_job.progress,jsonb_build_object('message','pause acknowledged by worker'))
    on conflict (case_job_id,stage) do update set progress=excluded.progress,safe_metadata=excluded.safe_metadata,updated_at=now();
  insert into public.integritas_control_audit(command_id,event_type,actor_type,actor_id,metadata)
    values(p_command_id,'paused','worker',p_worker_id,jsonb_build_object('case_job_id',v_job.id));
  return true;
end;
$$;

create or replace function integritas_private.integritas_resume_case_investigation(
  p_case_job_id uuid, p_requested_by uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_job public.integritas_case_jobs;
  v_command public.integritas_control_commands;
  v_resume_stage text := 'queued';
  v_resume_progress integer := 0;
begin
  if p_requested_by is null or not exists (select 1 from public.integritas_admin_users where user_id=p_requested_by) then raise exception 'admin required'; end if;
  select j.* into v_job from public.integritas_case_jobs j where j.id=p_case_job_id and j.runtime_provider='openclaw-oracle' for update;
  if not found then raise exception 'investigation job not found'; end if;
  if not exists (select 1 from public.integritas_case_access a where a.case_id=v_job.case_id and a.user_id=p_requested_by) then raise exception 'case access denied'; end if;
  select * into v_command from public.integritas_control_commands where id=v_job.control_command_id for update;
  if not found or v_command.status <> 'paused' or v_job.stage <> 'paused' then raise exception 'investigation is not paused'; end if;
  select cp.stage,cp.progress into v_resume_stage,v_resume_progress from public.integritas_case_job_checkpoints cp
    where cp.case_job_id=v_job.id and cp.stage not in ('completed','incomplete','failed','cancelled','paused','research_limit_reached')
    order by cp.progress desc,cp.updated_at desc limit 1;
  if not found then v_resume_stage := 'queued'; v_resume_progress := 0; end if;
  update public.integritas_control_commands set status='queued', lease_owner=null, lease_expires_at=null, completed_at=null,
    result_summary=null, error_code=null, error_summary=null, updated_at=now() where id=v_command.id;
  update public.integritas_case_jobs set stage=v_resume_stage,progress=v_resume_progress,pause_requested=false,updated_at=now() where id=v_job.id;
  insert into public.integritas_control_audit(command_id,event_type,actor_type,actor_id,metadata)
    values(v_command.id,'resume_requested','admin',p_requested_by::text,jsonb_build_object('case_job_id',v_job.id,'resume_stage',v_resume_stage));
  return jsonb_build_object('case_job_id',v_job.id,'command_status','queued','stage',v_resume_stage,'progress',v_resume_progress);
end;
$$;

-- This finaliser deliberately refuses to delete evidence already cited in a
-- saved investigation.  That preserves a reviewable evidence graph instead of
-- silently corrupting a historical result.  The Edge Function removes the
-- private object immediately before this atomic database finalisation.
create or replace function integritas_private.integritas_finalize_document_delete(
  p_case_id uuid, p_document_id uuid, p_requested_by uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_document public.integritas_documents;
  v_revision integer;
  v_command_id uuid;
begin
  if p_requested_by is null
    or not exists (select 1 from public.integritas_admin_users where user_id=p_requested_by) then
    raise exception 'admin required';
  end if;
  select * into v_document from public.integritas_documents where id=p_document_id and case_id=p_case_id for update;
  if not found then raise exception 'document not found'; end if;
  if not exists (select 1 from public.integritas_case_access a where a.case_id=p_case_id and a.user_id=p_requested_by) then
    raise exception 'case access denied';
  end if;
  if exists (select 1 from public.integritas_case_jobs j where j.case_id=p_case_id and j.stage not in ('completed','incomplete','failed','cancelled','research_limit_reached')) then
    raise exception 'cannot delete evidence while an investigation is active';
  end if;
  if exists (select 1 from public.integritas_sources s where s.document_id=p_document_id) then
    raise exception 'cannot delete evidence cited by a saved investigation';
  end if;
  update public.integritas_cases set revision=revision+1 where id=p_case_id returning revision into v_revision;
  if not found then raise exception 'case not found'; end if;
  delete from public.integritas_documents where id=p_document_id and case_id=p_case_id;
  select j.control_command_id into v_command_id
  from public.integritas_case_jobs j
  where j.case_id=p_case_id and j.control_command_id is not null
  order by j.updated_at desc, j.id desc
  limit 1;
  insert into public.integritas_control_audit(command_id,event_type,actor_type,actor_id,metadata)
    values(v_command_id,'document_deleted','admin',p_requested_by::text,
      jsonb_build_object('case_id',p_case_id,'document_id',p_document_id,'case_revision',v_revision));
  return jsonb_build_object('document_id',p_document_id,'storage_path',v_document.storage_path,'case_revision',v_revision);
end;
$$;

revoke all on function integritas_private.integritas_pause_case_investigation(uuid,uuid),
  integritas_private.integritas_acknowledge_case_investigation_pause(uuid,text,uuid),
  integritas_private.integritas_resume_case_investigation(uuid,uuid),
  integritas_private.integritas_finalize_document_delete(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function integritas_private.integritas_pause_case_investigation(uuid,uuid),
  integritas_private.integritas_acknowledge_case_investigation_pause(uuid,text,uuid),
  integritas_private.integritas_resume_case_investigation(uuid,uuid),
  integritas_private.integritas_finalize_document_delete(uuid,uuid,uuid) to service_role;

create or replace function public.integritas_pause_case_investigation(p_case_job_id uuid,p_requested_by uuid) returns jsonb
language sql security definer set search_path = '' as $$ select integritas_private.integritas_pause_case_investigation(p_case_job_id,p_requested_by); $$;
create or replace function public.integritas_resume_case_investigation(p_case_job_id uuid,p_requested_by uuid) returns jsonb
language sql security definer set search_path = '' as $$ select integritas_private.integritas_resume_case_investigation(p_case_job_id,p_requested_by); $$;
create or replace function public.integritas_acknowledge_case_investigation_pause(p_command_id uuid,p_worker_id text,p_case_job_id uuid) returns boolean
language sql security definer set search_path = '' as $$ select integritas_private.integritas_acknowledge_case_investigation_pause(p_command_id,p_worker_id,p_case_job_id); $$;
create or replace function public.integritas_finalize_document_delete(p_case_id uuid,p_document_id uuid,p_requested_by uuid) returns jsonb
language sql security definer set search_path = '' as $$ select integritas_private.integritas_finalize_document_delete(p_case_id,p_document_id,p_requested_by); $$;
revoke all on function public.integritas_pause_case_investigation(uuid,uuid),public.integritas_resume_case_investigation(uuid,uuid),public.integritas_acknowledge_case_investigation_pause(uuid,text,uuid),public.integritas_finalize_document_delete(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.integritas_pause_case_investigation(uuid,uuid),public.integritas_resume_case_investigation(uuid,uuid),public.integritas_acknowledge_case_investigation_pause(uuid,text,uuid),public.integritas_finalize_document_delete(uuid,uuid,uuid) to service_role;

commit;
