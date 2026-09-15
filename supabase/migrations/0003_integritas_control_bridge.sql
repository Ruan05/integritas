-- Durable, least-privilege control bridge for ChatGPT -> Supabase -> Oracle/OpenClaw.
begin;

create table if not exists public.integritas_control_commands (
  id uuid primary key default gen_random_uuid(),
  case_id uuid null,
  command_type text not null check (command_type in (
    'health',
    'openclaw_status',
    'list_cases',
    'case_status',
    'case_progress',
    'list_agent_runs',
    'pause_case',
    'resume_case',
    'retry_failed_run',
    'cancel_case',
    'fetch_qa_summary',
    'fetch_report',
    'restart_openclaw',
    'verify_runtime',
    'deploy_verified_update'
  )),
  payload jsonb not null default '{}'::jsonb,
  requested_actor text not null,
  requested_by uuid null,
  idempotency_key text not null unique,
  status text not null default 'queued' check (status in (
    'queued','leased','running','completed','failed','cancelled'
  )),
  lease_owner text null,
  lease_expires_at timestamptz null,
  attempt integer not null default 0 check (attempt >= 0),
  requested_at timestamptz not null default now(),
  leased_at timestamptz null,
  started_at timestamptz null,
  completed_at timestamptz null,
  updated_at timestamptz not null default now(),
  result_summary jsonb null,
  error_code text null,
  error_summary text null,
  constraint integritas_control_payload_size check (octet_length(payload::text) <= 32768)
);

create index if not exists integritas_control_commands_status_idx
  on public.integritas_control_commands(status, requested_at);
create index if not exists integritas_control_commands_case_idx
  on public.integritas_control_commands(case_id, requested_at desc);

create table if not exists public.integritas_runtime_heartbeats (
  worker_id text primary key,
  runtime_version text null,
  openclaw_version text null,
  openclaw_status text null,
  worker_version text null,
  capability_flags jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integritas_runtime_flags_size check (octet_length(capability_flags::text) <= 16384)
);

create table if not exists public.integritas_control_audit (
  id bigint generated always as identity primary key,
  command_id uuid null references public.integritas_control_commands(id) on delete set null,
  event_type text not null,
  actor_type text not null,
  actor_id text null,
  event_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint integritas_control_audit_size check (octet_length(metadata::text) <= 16384)
);

alter table public.integritas_control_commands enable row level security;
alter table public.integritas_runtime_heartbeats enable row level security;
alter table public.integritas_control_audit enable row level security;

revoke all on table public.integritas_control_commands from anon, authenticated;
revoke all on table public.integritas_runtime_heartbeats from anon, authenticated;
revoke all on table public.integritas_control_audit from anon, authenticated;

grant select on table
  public.integritas_control_commands,
  public.integritas_runtime_heartbeats,
  public.integritas_control_audit
  to authenticated, service_role;

create policy "admins read control commands"
  on public.integritas_control_commands for select to authenticated
  using (integritas_private.integritas_is_admin());
create policy "admins read runtime heartbeat"
  on public.integritas_runtime_heartbeats for select to authenticated
  using (integritas_private.integritas_is_admin());
create policy "admins read control audit"
  on public.integritas_control_audit for select to authenticated
  using (integritas_private.integritas_is_admin());

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

create or replace function integritas_private.integritas_lease_control_command(
  p_worker_id text,
  p_lease_seconds integer default 90
)
returns public.integritas_control_commands
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_out public.integritas_control_commands;
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 or length(p_worker_id) > 200 then
    raise exception 'invalid worker id';
  end if;
  if p_lease_seconds < 15 or p_lease_seconds > 900 then
    raise exception 'invalid lease duration';
  end if;

  select * into row_out
  from public.integritas_control_commands
  where status = 'queued'
     or (status in ('leased','running') and lease_expires_at < now())
  order by requested_at
  for update skip locked
  limit 1;

  if row_out.id is null then
    return null;
  end if;

  update public.integritas_control_commands
  set status = 'leased',
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      leased_at = now(),
      started_at = coalesce(started_at, now()),
      attempt = attempt + 1,
      updated_at = now()
  where id = row_out.id
  returning * into row_out;

  insert into public.integritas_control_audit(command_id, event_type, actor_type, actor_id, metadata)
  values (row_out.id, 'leased', 'worker', p_worker_id, jsonb_build_object('attempt', row_out.attempt));

  return row_out;
end;
$$;

create or replace function integritas_private.integritas_touch_control_command(
  p_command_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 90
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.integritas_control_commands
  set status = case when status = 'leased' then 'running' else status end,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  where id = p_command_id
    and lease_owner = p_worker_id
    and status in ('leased','running');
  return found;
end;
$$;

create or replace function integritas_private.integritas_complete_control_command(
  p_command_id uuid,
  p_worker_id text,
  p_result_summary jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.integritas_control_commands
  set status = 'completed',
      result_summary = coalesce(p_result_summary, '{}'::jsonb),
      completed_at = now(),
      updated_at = now(),
      lease_expires_at = null
  where id = p_command_id
    and lease_owner = p_worker_id
    and status in ('leased','running');
  if not found then return false; end if;
  insert into public.integritas_control_audit(command_id, event_type, actor_type, actor_id)
  values (p_command_id, 'completed', 'worker', p_worker_id);
  return true;
end;
$$;

create or replace function integritas_private.integritas_fail_control_command(
  p_command_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_summary text
)
returns boolean
language plpgsql
security definer
set search_path = ''
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
  insert into public.integritas_control_audit(command_id, event_type, actor_type, actor_id, metadata)
  values (p_command_id, 'failed', 'worker', p_worker_id, jsonb_build_object('error_code', left(coalesce(p_error_code, 'failed'), 120)));
  return true;
end;
$$;

create or replace function integritas_private.integritas_upsert_runtime_heartbeat(
  p_worker_id text,
  p_runtime_version text,
  p_openclaw_version text,
  p_openclaw_status text,
  p_worker_version text,
  p_capability_flags jsonb default '{}'::jsonb
)
returns public.integritas_runtime_heartbeats
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_out public.integritas_runtime_heartbeats;
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 or length(p_worker_id) > 200 then
    raise exception 'invalid worker id';
  end if;
  insert into public.integritas_runtime_heartbeats(
    worker_id, runtime_version, openclaw_version, openclaw_status, worker_version, capability_flags, last_seen_at, updated_at
  ) values (
    p_worker_id, left(p_runtime_version, 200), left(p_openclaw_version, 200), left(p_openclaw_status, 100), left(p_worker_version, 200), coalesce(p_capability_flags, '{}'::jsonb), now(), now()
  )
  on conflict (worker_id) do update set
    runtime_version = excluded.runtime_version,
    openclaw_version = excluded.openclaw_version,
    openclaw_status = excluded.openclaw_status,
    worker_version = excluded.worker_version,
    capability_flags = excluded.capability_flags,
    last_seen_at = now(),
    updated_at = now()
  returning * into row_out;
  return row_out;
end;
$$;

revoke all on function integritas_private.integritas_enqueue_control_command(text,jsonb,text,uuid,text,uuid) from public, anon, authenticated;
revoke all on function integritas_private.integritas_lease_control_command(text,integer) from public, anon, authenticated;
revoke all on function integritas_private.integritas_touch_control_command(uuid,text,integer) from public, anon, authenticated;
revoke all on function integritas_private.integritas_complete_control_command(uuid,text,jsonb) from public, anon, authenticated;
revoke all on function integritas_private.integritas_fail_control_command(uuid,text,text,text) from public, anon, authenticated;
revoke all on function integritas_private.integritas_upsert_runtime_heartbeat(text,text,text,text,text,jsonb) from public, anon, authenticated;

grant execute on function integritas_private.integritas_enqueue_control_command(text,jsonb,text,uuid,text,uuid) to service_role;
grant execute on function integritas_private.integritas_lease_control_command(text,integer) to service_role;
grant execute on function integritas_private.integritas_touch_control_command(uuid,text,integer) to service_role;
grant execute on function integritas_private.integritas_complete_control_command(uuid,text,jsonb) to service_role;
grant execute on function integritas_private.integritas_fail_control_command(uuid,text,text,text) to service_role;
grant execute on function integritas_private.integritas_upsert_runtime_heartbeat(text,text,text,text,text,jsonb) to service_role;

commit;
