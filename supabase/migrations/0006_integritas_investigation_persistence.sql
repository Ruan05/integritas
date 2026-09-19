begin;

create table public.integritas_case_job_checkpoints (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.integritas_cases(id) on delete cascade,
  case_job_id uuid not null references public.integritas_case_jobs(id) on delete cascade,
  case_revision integer not null check (case_revision >= 0),
  stage text not null check (stage in (
    'queued','extracting','analyzing_documents','mapping_entities','planning_research',
    'researching','verifying','cross_checking','independent_review','drafting_report',
    'completed','incomplete','failed','cancelled','research_limit_reached'
  )),
  progress integer not null check (progress between 0 and 100),
  safe_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(safe_metadata) = 'object' and octet_length(safe_metadata::text) <= 16384),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (case_job_id, stage)
);

alter table public.integritas_case_job_checkpoints enable row level security;

create table public.integritas_case_job_outputs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.integritas_cases(id) on delete cascade,
  case_job_id uuid not null references public.integritas_case_jobs(id) on delete cascade,
  case_revision integer not null check (case_revision >= 0),
  output_type text not null check (output_type in ('bundle','report_html','evidence','execution_log')),
  content_type text not null check (content_type in ('application/json','text/html','application/octet-stream','text/plain')),
  storage_path text not null check (
    char_length(storage_path) between 1 and 1024
    and storage_path not like '%..%'
    and storage_path not like 'http%'
  ),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint not null check (size_bytes between 0 and 5242880),
  safe_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(safe_metadata) = 'object' and octet_length(safe_metadata::text) <= 16384),
  created_at timestamptz not null default now(),
  unique (case_job_id, output_type, sha256)
);

alter table public.integritas_case_job_outputs enable row level security;

create or replace function integritas_private.integritas_investigation_manifest_context(
  p_command_id uuid,
  p_worker_id text,
  p_case_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.integritas_case_jobs;
  v_command public.integritas_control_commands;
  v_case public.integritas_cases;
  v_documents jsonb;
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 or length(p_worker_id) > 200 then
    raise exception 'invalid worker id';
  end if;

  select j.* into v_job
  from public.integritas_case_jobs j
  join public.integritas_control_commands cmd on cmd.id = j.control_command_id
  join public.integritas_cases c on c.id = j.case_id
  where j.id = p_case_job_id
    and j.runtime_provider = 'openclaw-oracle'
    and cmd.id = p_command_id
    and cmd.command_type = 'run_case_investigation'
    and cmd.case_id = j.case_id
    and cmd.lease_owner = p_worker_id
    and cmd.status in ('leased','running')
    and c.revision = j.case_revision
  for update of j;
  if not found then
    raise exception 'investigation manifest access denied';
  end if;

  select * into v_command
  from public.integritas_control_commands
  where id = p_command_id;
  select * into v_case
  from public.integritas_cases
  where id = v_job.case_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'name', d.name,
    'mime_type', d.mime_type,
    'size_bytes', d.size_bytes,
    'sha256', d.sha256,
    'storage_path', d.storage_path,
    'extraction_status', d.extraction_status
  ) order by d.created_at, d.id), '[]'::jsonb)
  into v_documents
  from public.integritas_documents d
  where d.case_id = v_job.case_id;

  if jsonb_array_length(v_documents) < 1 or jsonb_array_length(v_documents) > 20 then
    raise exception 'investigation requires between 1 and 20 documents';
  end if;
  return jsonb_build_object(
    'command_id', v_command.id,
    'case_job_id', v_job.id,
    'case_id', v_job.case_id,
    'case_revision', v_job.case_revision,
    'depth', v_job.depth,
    'case', jsonb_build_object(
      'title', v_case.title,
      'purpose', v_case.purpose,
      'authorized_scope', v_case.authorized_scope,
      'intended_subjects', v_case.intended_subjects,
      'jurisdictions', v_case.jurisdictions
    ),
    'documents', v_documents
  );
end;
$$;

revoke all on function integritas_private.integritas_investigation_manifest_context(uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function integritas_private.integritas_investigation_manifest_context(uuid,text,uuid)
  to service_role;

create or replace function public.integritas_investigation_manifest_context(
  p_command_id uuid, p_worker_id text, p_case_job_id uuid
) returns jsonb
language sql security definer set search_path = ''
as $$
  select integritas_private.integritas_investigation_manifest_context(
    p_command_id, p_worker_id, p_case_job_id
  );
$$;
revoke all on function public.integritas_investigation_manifest_context(uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function public.integritas_investigation_manifest_context(uuid,text,uuid)
  to service_role;

create or replace function integritas_private.integritas_checkpoint_case_investigation(
  p_command_id uuid,
  p_worker_id text,
  p_case_job_id uuid,
  p_case_revision integer,
  p_stage text,
  p_progress integer,
  p_safe_metadata jsonb default '{}'::jsonb
)
returns public.integritas_case_job_checkpoints
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.integritas_case_jobs;
  v_checkpoint public.integritas_case_job_checkpoints;
  v_order text[] := array[
    'queued','extracting','analyzing_documents','mapping_entities','planning_research',
    'researching','verifying','cross_checking','independent_review','drafting_report','completed'
  ];
  v_terminal text[] := array['incomplete','failed','cancelled','research_limit_reached'];
begin
  if p_stage is null or not (p_stage = any(v_order) or p_stage = any(v_terminal)) then
    raise exception 'invalid investigation stage';
  end if;
  if p_progress is null or p_progress < 0 or p_progress > 100 then
    raise exception 'invalid investigation progress';
  end if;
  if p_safe_metadata is null or jsonb_typeof(p_safe_metadata) <> 'object'
    or octet_length(p_safe_metadata::text) > 16384 then
    raise exception 'invalid checkpoint metadata';
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
    raise exception 'investigation checkpoint access denied';
  end if;
  if v_job.stage = any(v_terminal) and p_stage <> v_job.stage then
    raise exception 'terminal investigation stage is immutable';
  end if;
  if p_progress < v_job.progress then
    raise exception 'investigation progress cannot move backwards';
  end if;
  if p_stage = 'completed' and (v_job.stage not in ('drafting_report','completed') or p_progress <> 100) then
    raise exception 'completed stage requires drafted report and 100 percent progress';
  end if;
  if not (p_stage = any(v_terminal))
    and array_position(v_order, p_stage) < array_position(v_order, v_job.stage) then
    raise exception 'investigation stage cannot move backwards';
  end if;

  update public.integritas_case_jobs
  set stage = p_stage,
      progress = p_progress,
      updated_at = now()
  where id = v_job.id;

  insert into public.integritas_case_job_checkpoints(
    case_id, case_job_id, case_revision, stage, progress, safe_metadata
  ) values (
    v_job.case_id, v_job.id, v_job.case_revision, p_stage, p_progress, p_safe_metadata
  )
  on conflict (case_job_id, stage) do update
    set progress = greatest(public.integritas_case_job_checkpoints.progress, excluded.progress),
        safe_metadata = excluded.safe_metadata,
        updated_at = now()
  returning * into v_checkpoint;

  return v_checkpoint;
end;
$$;
revoke all on function integritas_private.integritas_checkpoint_case_investigation(uuid,text,uuid,integer,text,integer,jsonb)
  from public, anon, authenticated;
grant execute on function integritas_private.integritas_checkpoint_case_investigation(uuid,text,uuid,integer,text,integer,jsonb)
  to service_role;

create or replace function public.integritas_checkpoint_case_investigation(
  p_command_id uuid, p_worker_id text, p_case_job_id uuid,
  p_case_revision integer, p_stage text, p_progress integer,
  p_safe_metadata jsonb default '{}'::jsonb
) returns public.integritas_case_job_checkpoints
language sql security definer set search_path = ''
as $$
  select integritas_private.integritas_checkpoint_case_investigation(
    p_command_id, p_worker_id, p_case_job_id, p_case_revision,
    p_stage, p_progress, p_safe_metadata
  );
$$;
revoke all on function public.integritas_checkpoint_case_investigation(uuid,text,uuid,integer,text,integer,jsonb)
  from public, anon, authenticated;
grant execute on function public.integritas_checkpoint_case_investigation(uuid,text,uuid,integer,text,integer,jsonb)
  to service_role;

create or replace function integritas_private.integritas_register_case_job_output(
  p_command_id uuid,
  p_worker_id text,
  p_case_job_id uuid,
  p_case_revision integer,
  p_output_type text,
  p_content_type text,
  p_storage_path text,
  p_sha256 text,
  p_size_bytes bigint,
  p_safe_metadata jsonb default '{}'::jsonb
)
returns public.integritas_case_job_outputs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.integritas_case_jobs;
  v_output public.integritas_case_job_outputs;
  v_prefix text;
begin
  if p_output_type not in ('bundle','report_html','evidence','execution_log') then
    raise exception 'invalid investigation output type';
  end if;
  if p_content_type not in ('application/json','text/html','application/octet-stream','text/plain') then
    raise exception 'invalid investigation content type';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid investigation output digest';
  end if;
  if p_size_bytes is null or p_size_bytes < 0 or p_size_bytes > 5242880 then
    raise exception 'invalid investigation output size';
  end if;
  if p_safe_metadata is null or jsonb_typeof(p_safe_metadata) <> 'object'
    or octet_length(p_safe_metadata::text) > 16384
    or p_safe_metadata::text like '%/storage/v1/object/sign/%' then
    raise exception 'invalid investigation output metadata';
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
    raise exception 'investigation output access denied';
  end if;

  v_prefix := 'cases/' || v_job.case_id::text || '/jobs/' || v_job.id::text || '/outputs/';
  if p_storage_path is null or position(v_prefix in p_storage_path) <> 1
    or p_storage_path like '%..%' or p_storage_path like 'http%' then
    raise exception 'invalid investigation output path';
  end if;
  insert into public.integritas_case_job_outputs(
    case_id, case_job_id, case_revision, output_type, content_type,
    storage_path, sha256, size_bytes, safe_metadata
  ) values (
    v_job.case_id, v_job.id, v_job.case_revision, p_output_type, p_content_type,
    p_storage_path, p_sha256, p_size_bytes, p_safe_metadata
  )
  on conflict (case_job_id, output_type, sha256) do update
    set storage_path = excluded.storage_path,
        content_type = excluded.content_type,
        size_bytes = excluded.size_bytes,
        safe_metadata = excluded.safe_metadata
  returning * into v_output;

  return v_output;
end;
$$;

revoke all on function integritas_private.integritas_register_case_job_output(uuid,text,uuid,integer,text,text,text,text,bigint,jsonb)
  from public, anon, authenticated;
grant execute on function integritas_private.integritas_register_case_job_output(uuid,text,uuid,integer,text,text,text,text,bigint,jsonb)
  to service_role;

create or replace function public.integritas_register_case_job_output(
  p_command_id uuid, p_worker_id text, p_case_job_id uuid, p_case_revision integer,
  p_output_type text, p_content_type text, p_storage_path text, p_sha256 text,
  p_size_bytes bigint, p_safe_metadata jsonb default '{}'::jsonb
) returns public.integritas_case_job_outputs
language sql security definer set search_path = ''
as $$
  select integritas_private.integritas_register_case_job_output(
    p_command_id, p_worker_id, p_case_job_id, p_case_revision,
    p_output_type, p_content_type, p_storage_path, p_sha256,
    p_size_bytes, p_safe_metadata
  );
$$;
revoke all on function public.integritas_register_case_job_output(uuid,text,uuid,integer,text,text,text,text,bigint,jsonb)
  from public, anon, authenticated;
grant execute on function public.integritas_register_case_job_output(uuid,text,uuid,integer,text,text,text,text,bigint,jsonb)
  to service_role;

commit;
