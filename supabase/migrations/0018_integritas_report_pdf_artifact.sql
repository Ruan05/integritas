begin;

alter table public.integritas_case_job_outputs
  drop constraint if exists integritas_case_job_outputs_output_type_check;
alter table public.integritas_case_job_outputs
  add constraint integritas_case_job_outputs_output_type_check
  check (output_type in ('bundle','report_markdown','report_html','report_pdf','evidence','execution_log'));

alter table public.integritas_case_job_outputs
  drop constraint if exists integritas_case_job_outputs_content_type_check;
alter table public.integritas_case_job_outputs
  add constraint integritas_case_job_outputs_content_type_check
  check (content_type in ('application/json','application/pdf','text/html','application/octet-stream','text/plain','text/markdown'));

create or replace function integritas_private.integritas_register_report_pdf_output(
  p_command_id uuid,
  p_worker_id text,
  p_case_job_id uuid,
  p_case_revision integer,
  p_storage_path text,
  p_sha256 text,
  p_size_bytes bigint,
  p_safe_metadata jsonb default '{}'::jsonb
) returns public.integritas_case_job_outputs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.integritas_case_jobs;
  v_output public.integritas_case_job_outputs;
  v_prefix text;
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 or length(p_worker_id) > 200 then
    raise exception 'invalid worker id';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid investigation PDF digest';
  end if;
  if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 5242880 then
    raise exception 'invalid investigation PDF size';
  end if;
  if p_safe_metadata is null
    or jsonb_typeof(p_safe_metadata) <> 'object'
    or octet_length(p_safe_metadata::text) > 16384
    or p_safe_metadata::text like '%/storage/v1/object/sign/%' then
    raise exception 'invalid investigation PDF metadata';
  end if;

  select j.* into v_job
  from public.integritas_case_jobs j
  join public.integritas_control_commands cmd on cmd.id = j.control_command_id
  join public.integritas_cases c on c.id = j.case_id
  where j.id = p_case_job_id
    and j.case_revision = p_case_revision
    and j.runtime_provider = 'openclaw-oracle'
    and cmd.id = p_command_id
    and cmd.command_type = 'run_case_investigation'
    and cmd.lease_owner = p_worker_id
    and cmd.status in ('leased','running')
    and c.revision = j.case_revision
  for update of j;

  if not found then
    raise exception 'investigation PDF output access denied';
  end if;

  v_prefix := 'cases/' || v_job.case_id::text || '/jobs/' || v_job.id::text || '/outputs/report_pdf/';
  if p_storage_path is null
    or position(v_prefix in p_storage_path) <> 1
    or p_storage_path like '%..%'
    or p_storage_path like 'http%' then
    raise exception 'invalid investigation PDF output path';
  end if;

  insert into public.integritas_case_job_outputs(
    case_id, case_job_id, case_revision, output_type, content_type,
    storage_path, sha256, size_bytes, safe_metadata
  ) values (
    v_job.case_id, v_job.id, v_job.case_revision, 'report_pdf', 'application/pdf',
    p_storage_path, p_sha256, p_size_bytes, p_safe_metadata
  )
  on conflict (case_job_id, output_type, sha256) do update set
    storage_path = excluded.storage_path,
    content_type = excluded.content_type,
    size_bytes = excluded.size_bytes,
    safe_metadata = excluded.safe_metadata
  returning * into v_output;

  return v_output;
end;
$$;

revoke all on function integritas_private.integritas_register_report_pdf_output(
  uuid,text,uuid,integer,text,text,bigint,jsonb
) from public, anon, authenticated;
grant execute on function integritas_private.integritas_register_report_pdf_output(
  uuid,text,uuid,integer,text,text,bigint,jsonb
) to service_role;

create or replace function public.integritas_register_report_pdf_output(
  p_command_id uuid,
  p_worker_id text,
  p_case_job_id uuid,
  p_case_revision integer,
  p_storage_path text,
  p_sha256 text,
  p_size_bytes bigint,
  p_safe_metadata jsonb default '{}'::jsonb
) returns public.integritas_case_job_outputs
language sql
security definer
set search_path = ''
as $$
  select integritas_private.integritas_register_report_pdf_output(
    p_command_id,
    p_worker_id,
    p_case_job_id,
    p_case_revision,
    p_storage_path,
    p_sha256,
    p_size_bytes,
    p_safe_metadata
  );
$$;

revoke all on function public.integritas_register_report_pdf_output(
  uuid,text,uuid,integer,text,text,bigint,jsonb
) from public, anon, authenticated;
grant execute on function public.integritas_register_report_pdf_output(
  uuid,text,uuid,integer,text,text,bigint,jsonb
) to service_role;

commit;
