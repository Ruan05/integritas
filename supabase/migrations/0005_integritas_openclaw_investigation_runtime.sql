begin;

alter table public.integritas_cases
  add column if not exists revision integer not null default 0;

alter table public.integritas_case_jobs
  drop constraint integritas_case_jobs_job_kind_check;
alter table public.integritas_case_jobs
  add constraint integritas_case_jobs_job_kind_check
  check (job_kind in ('extract','research','chat','review','verify','investigation'));

alter table public.integritas_case_jobs
  alter column opencode_job_id drop not null;

alter table public.integritas_case_jobs
  add column runtime_provider text not null default 'opencode-go',
  add column control_command_id uuid null;

alter table public.integritas_case_jobs
  add constraint integritas_case_jobs_runtime_provider_check
    check (runtime_provider in ('opencode-go','openclaw-oracle')),
  add constraint integritas_case_jobs_control_command_id_fkey
    foreign key (control_command_id)
    references public.integritas_control_commands(id) on delete restrict,
  add constraint integritas_case_jobs_control_command_id_key
    unique (control_command_id),
  add constraint integritas_case_jobs_runtime_link_check
    check (
      (runtime_provider = 'opencode-go' and opencode_job_id is not null and control_command_id is null)
      or
      (runtime_provider = 'openclaw-oracle' and opencode_job_id is null and control_command_id is not null)
    );

create unique index integritas_case_jobs_openclaw_revision_key
  on public.integritas_case_jobs(case_id, case_revision)
  where runtime_provider = 'openclaw-oracle';

alter table public.integritas_control_commands
  drop constraint integritas_control_commands_command_type_check;
alter table public.integritas_control_commands
  add constraint integritas_control_commands_command_type_check
  check (command_type in (
    'health','openclaw_status','list_cases','case_status','case_progress','list_agent_runs',
    'pause_case','resume_case','retry_failed_run','cancel_case','fetch_qa_summary','fetch_report',
    'restart_openclaw','verify_runtime','deploy_verified_update','run_case_investigation'
  ));

alter table public.integritas_control_commands
  add constraint integritas_control_run_case_payload_check
  check (
    command_type <> 'run_case_investigation' or (
      jsonb_typeof(payload) = 'object'
      and payload ?& array['case_id','case_job_id','case_revision','depth']
      and payload - 'case_id' - 'case_job_id' - 'case_revision' - 'depth' = '{}'::jsonb
      and jsonb_typeof(payload->'case_id') = 'string'
      and (payload->>'case_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and payload->>'case_id' = case_id::text
      and jsonb_typeof(payload->'case_job_id') = 'string'
      and (payload->>'case_job_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and jsonb_typeof(payload->'case_revision') = 'number'
      and (payload->>'case_revision') ~ '^(0|[1-9][0-9]*)$'
      and payload->>'depth' in ('fast','standard','deep','maximum')
    )
  );

create or replace function integritas_private.integritas_enqueue_control_command(
  p_command_type text,
  p_payload jsonb,
  p_requested_actor text,
  p_requested_by uuid,
  p_idempotency_key text,
  p_case_id uuid default null
)
returns public.integritas_control_commands
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_out public.integritas_control_commands;
begin
  if p_command_type not in (
    'health','openclaw_status','list_cases','case_status','case_progress','list_agent_runs',
    'pause_case','resume_case','retry_failed_run','cancel_case','fetch_qa_summary','fetch_report',
    'restart_openclaw','verify_runtime','deploy_verified_update'
  ) then
    raise exception 'unsupported control command';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 or length(p_idempotency_key) > 200 then
    raise exception 'invalid idempotency key';
  end if;
  if p_requested_actor is null or length(trim(p_requested_actor)) = 0 or length(p_requested_actor) > 200 then
    raise exception 'invalid requested actor';
  end if;
  if octet_length(coalesce(p_payload, '{}'::jsonb)::text) > 32768 then
    raise exception 'control payload too large';
  end if;

  insert into public.integritas_control_commands(
    case_id, command_type, payload, requested_actor, requested_by, idempotency_key
  ) values (
    p_case_id, p_command_type, coalesce(p_payload, '{}'::jsonb), p_requested_actor, p_requested_by, p_idempotency_key
  )
  on conflict (idempotency_key) do update
    set idempotency_key = excluded.idempotency_key
  returning * into row_out;

  insert into public.integritas_control_audit(command_id, event_type, actor_type, actor_id, metadata)
  values (row_out.id, 'enqueued', 'connector', p_requested_actor, jsonb_build_object('command_type', row_out.command_type));

  return row_out;
end;
$$;
create or replace function integritas_private.integritas_start_case_investigation(
  p_case_id uuid,
  p_case_revision integer,
  p_depth text,
  p_requested_by uuid,
  p_idempotency_key text
)
returns table (
  case_job_id uuid,
  control_command_id uuid,
  case_id uuid,
  case_revision integer,
  depth text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_revision integer;
  v_job public.integritas_case_jobs;
  v_command public.integritas_control_commands;
  v_job_id uuid;
  v_payload jsonb;
begin
  if p_case_revision is null or p_case_revision < 0 then
    raise exception 'invalid case revision';
  end if;
  if p_depth not in ('fast','standard','deep','maximum') then
    raise exception 'invalid investigation depth';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 or length(p_idempotency_key) > 200 then
    raise exception 'invalid idempotency key';
  end if;
  if p_requested_by is null
    or not exists (select 1 from public.integritas_admin_users where user_id = p_requested_by) then
    raise exception 'admin required';
  end if;
  if not exists (
    select 1 from public.integritas_case_access access_row
    where access_row.case_id = p_case_id and access_row.user_id = p_requested_by
  ) then
    raise exception 'case access denied';
  end if;

  select revision into v_current_revision
  from public.integritas_cases
  where id = p_case_id
  for update;
  if not found then
    raise exception 'case not found';
  end if;
  if v_current_revision <> p_case_revision then
    raise exception 'case revision is stale';
  end if;

  select * into v_command
  from public.integritas_control_commands
  where idempotency_key = p_idempotency_key
  for update;
  if found then
    select * into v_job
    from public.integritas_case_jobs job_row
    where job_row.control_command_id = v_command.id
    for update;
    if not found
      or v_command.command_type <> 'run_case_investigation'
      or v_command.case_id <> p_case_id
      or v_job.case_id <> p_case_id
      or v_job.runtime_provider <> 'openclaw-oracle'
      or v_job.case_revision <> p_case_revision
      or v_job.depth <> p_depth then
      raise exception 'idempotency key already used for a different command';
    end if;
    v_payload := jsonb_build_object(
      'case_id', p_case_id, 'case_job_id', v_job.id,
      'case_revision', p_case_revision, 'depth', p_depth
    );
    if v_command.payload <> v_payload then
      raise exception 'existing investigation command payload is inconsistent';
    end if;
    return query select v_job.id, v_command.id, p_case_id, p_case_revision, p_depth;
    return;
  end if;

  select * into v_job
  from public.integritas_case_jobs job_row
  where job_row.case_id = p_case_id
    and job_row.case_revision = p_case_revision
    and job_row.runtime_provider = 'openclaw-oracle'
  for update;
  if found then
    select * into v_command
    from public.integritas_control_commands command_row
    where command_row.id = v_job.control_command_id
    for update;
    if not found or v_command.command_type <> 'run_case_investigation'
      or v_command.case_id <> p_case_id or v_job.depth <> p_depth then
      raise exception 'existing investigation state is inconsistent';
    end if;
    v_payload := jsonb_build_object(
      'case_id', p_case_id, 'case_job_id', v_job.id,
      'case_revision', p_case_revision, 'depth', p_depth
    );
    if v_command.payload <> v_payload then
      raise exception 'existing investigation command payload is inconsistent';
    end if;
    return query select v_job.id, v_command.id, p_case_id, p_case_revision, p_depth;
    return;
  end if;

  v_job_id := gen_random_uuid();
  v_payload := jsonb_build_object(
    'case_id', p_case_id, 'case_job_id', v_job_id,
    'case_revision', p_case_revision, 'depth', p_depth
  );

  insert into public.integritas_control_commands(
    case_id, command_type, payload, requested_actor, requested_by, idempotency_key
  ) values (
    p_case_id, 'run_case_investigation', v_payload, 'admin:' || p_requested_by::text,
    p_requested_by, p_idempotency_key
  )
  returning * into v_command;

  insert into public.integritas_case_jobs(
    id, case_id, opencode_job_id, runtime_provider, control_command_id, job_kind,
    case_revision, requested_question, depth, stage
  ) values (
    v_job_id, p_case_id, null, 'openclaw-oracle', v_command.id, 'investigation',
    p_case_revision, '', p_depth, 'queued'
  )
  returning * into v_job;

  insert into public.integritas_control_audit(command_id, event_type, actor_type, actor_id, metadata)
  values (
    v_command.id, 'enqueued', 'admin', p_requested_by::text,
    jsonb_build_object('command_type', v_command.command_type, 'case_job_id', v_job.id)
  );

  return query select v_job.id, v_command.id, p_case_id, p_case_revision, p_depth;
end;
$$;

revoke all on function integritas_private.integritas_start_case_investigation(uuid,integer,text,uuid,text)
  from public, anon, authenticated;
grant execute on function integritas_private.integritas_start_case_investigation(uuid,integer,text,uuid,text)
  to service_role;

create or replace function public.integritas_start_case_investigation(
  p_case_id uuid,
  p_case_revision integer,
  p_depth text,
  p_requested_by uuid,
  p_idempotency_key text
)
returns table (
  case_job_id uuid,
  control_command_id uuid,
  case_id uuid,
  case_revision integer,
  depth text
)
language sql
security definer
set search_path = ''
as $$
  select * from integritas_private.integritas_start_case_investigation(
    p_case_id, p_case_revision, p_depth, p_requested_by, p_idempotency_key
  );
$$;

revoke all on function public.integritas_start_case_investigation(uuid,integer,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.integritas_start_case_investigation(uuid,integer,text,uuid,text)
  to service_role;

commit;
