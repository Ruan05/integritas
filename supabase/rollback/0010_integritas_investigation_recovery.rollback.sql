begin;

drop function if exists public.integritas_retry_case_investigation(uuid,uuid);
drop function if exists integritas_private.integritas_retry_case_investigation(uuid,uuid);
drop function if exists public.integritas_acknowledge_case_investigation_cancel(uuid,text,uuid);
drop function if exists integritas_private.integritas_acknowledge_case_investigation_cancel(uuid,text,uuid);
drop function if exists public.integritas_cancel_case_investigation(uuid,uuid);
drop function if exists integritas_private.integritas_cancel_case_investigation(uuid,uuid);
drop function if exists public.integritas_investigation_job_state(uuid,text,uuid);
drop function if exists integritas_private.integritas_investigation_job_state(uuid,text,uuid);

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
  where j.id=p_case_job_id and j.runtime_provider='openclaw-oracle'
    and cmd.id=p_command_id and cmd.command_type='run_case_investigation'
    and cmd.case_id=j.case_id and cmd.lease_owner=p_worker_id
    and cmd.status in ('leased','running') and c.revision=j.case_revision
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
    'case',jsonb_build_object(
      'title',v_case.title,'purpose',v_case.purpose,'authorized_scope',v_case.authorized_scope,
      'intended_subjects',v_case.intended_subjects,'jurisdictions',v_case.jurisdictions
    ),
    'documents',v_documents
  );
end;
$$;

create or replace function integritas_private.integritas_fail_control_command(
  p_command_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_summary text
) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update public.integritas_control_commands
  set status = 'failed',
      error_code = left(coalesce(p_error_code, 'failed'), 120),
      error_summary = left(coalesce(p_error_summary, 'command failed'), 1000),
      completed_at = now(),
      updated_at = now(),
      lease_expires_at = null
  where id = p_command_id
    and lease_owner = p_worker_id
    and status in ('leased','running');
  if not found then return false; end if;
  insert into public.integritas_control_audit(
    command_id,event_type,actor_type,actor_id,metadata
  ) values (
    p_command_id,'failed','worker',p_worker_id,
    jsonb_build_object('error_code',left(coalesce(p_error_code,'failed'),120))
  );
  return true;
end;
$$;

commit;
