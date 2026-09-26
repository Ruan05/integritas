-- Public-schema RPC wrappers for the Edge Function. They remain service-role-only.
begin;

create or replace function public.integritas_control_enqueue(
  p_command_type text,
  p_payload jsonb,
  p_requested_actor text,
  p_requested_by uuid,
  p_idempotency_key text,
  p_case_id uuid default null
)
returns public.integritas_control_commands
language sql
security definer
set search_path = ''
as $$
  select integritas_private.integritas_enqueue_control_command(
    p_command_type, p_payload, p_requested_actor, p_requested_by, p_idempotency_key, p_case_id
  );
$$;

create or replace function public.integritas_control_lease(
  p_worker_id text,
  p_lease_seconds integer default 90
)
returns public.integritas_control_commands
language sql
security definer
set search_path = ''
as $$
  select integritas_private.integritas_lease_control_command(p_worker_id, p_lease_seconds);
$$;

create or replace function public.integritas_control_touch(
  p_command_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 90
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select integritas_private.integritas_touch_control_command(p_command_id, p_worker_id, p_lease_seconds);
$$;

create or replace function public.integritas_control_complete(
  p_command_id uuid,
  p_worker_id text,
  p_result_summary jsonb default '{}'::jsonb
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select integritas_private.integritas_complete_control_command(p_command_id, p_worker_id, p_result_summary);
$$;

create or replace function public.integritas_control_fail(
  p_command_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_summary text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select integritas_private.integritas_fail_control_command(p_command_id, p_worker_id, p_error_code, p_error_summary);
$$;

create or replace function public.integritas_control_heartbeat(
  p_worker_id text,
  p_runtime_version text,
  p_openclaw_version text,
  p_openclaw_status text,
  p_worker_version text,
  p_capability_flags jsonb default '{}'::jsonb
)
returns public.integritas_runtime_heartbeats
language sql
security definer
set search_path = ''
as $$
  select integritas_private.integritas_upsert_runtime_heartbeat(
    p_worker_id, p_runtime_version, p_openclaw_version, p_openclaw_status,
    p_worker_version, p_capability_flags
  );
$$;

revoke all on function public.integritas_control_enqueue(text,jsonb,text,uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.integritas_control_lease(text,integer) from public, anon, authenticated;
revoke all on function public.integritas_control_touch(uuid,text,integer) from public, anon, authenticated;
revoke all on function public.integritas_control_complete(uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.integritas_control_fail(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.integritas_control_heartbeat(text,text,text,text,text,jsonb) from public, anon, authenticated;

grant execute on function public.integritas_control_enqueue(text,jsonb,text,uuid,text,uuid) to service_role;
grant execute on function public.integritas_control_lease(text,integer) to service_role;
grant execute on function public.integritas_control_touch(uuid,text,integer) to service_role;
grant execute on function public.integritas_control_complete(uuid,text,jsonb) to service_role;
grant execute on function public.integritas_control_fail(uuid,text,text,text) to service_role;
grant execute on function public.integritas_control_heartbeat(text,text,text,text,text,jsonb) to service_role;

commit;
