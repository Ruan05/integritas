begin;

do $$
begin
  if exists (
    select 1 from public.integritas_case_jobs
    where runtime_provider = 'openclaw-oracle'
  ) then
    raise exception 'rollback blocked: OpenClaw case jobs exist';
  end if;
  if exists (
    select 1 from public.integritas_control_commands
    where command_type = 'run_case_investigation'
  ) then
    raise exception 'rollback blocked: investigation control commands exist';
  end if;
end;
$$;

drop function if exists public.integritas_start_case_investigation(uuid,integer,text,uuid,text);
drop function if exists integritas_private.integritas_start_case_investigation(uuid,integer,text,uuid,text);

alter table public.integritas_control_commands
  drop constraint integritas_control_run_case_payload_check,
  drop constraint integritas_control_commands_command_type_check;

alter table public.integritas_control_commands
  add constraint integritas_control_commands_command_type_check
  check (command_type in (
    'health','openclaw_status','list_cases','case_status','case_progress','list_agent_runs',
    'pause_case','resume_case','retry_failed_run','cancel_case','fetch_qa_summary','fetch_report',
    'restart_openclaw','verify_runtime','deploy_verified_update'
  ));

drop index public.integritas_case_jobs_openclaw_revision_key;

alter table public.integritas_case_jobs
  drop constraint integritas_case_jobs_job_kind_check;
alter table public.integritas_case_jobs
  add constraint integritas_case_jobs_job_kind_check
  check (job_kind in ('extract','research','chat','review','verify'));


alter table public.integritas_case_jobs
  drop constraint integritas_case_jobs_runtime_link_check,
  drop constraint integritas_case_jobs_control_command_id_key,
  drop constraint integritas_case_jobs_control_command_id_fkey,
  drop constraint integritas_case_jobs_runtime_provider_check;

alter table public.integritas_case_jobs
  drop column control_command_id,
  drop column runtime_provider,
  alter column opencode_job_id set not null;

alter table public.integritas_cases
  drop column revision;

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

commit;
