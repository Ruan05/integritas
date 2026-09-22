-- Preserve the distinction between a bounded reviewable result and execution failure.
-- The worker has already checkpointed the case as incomplete at 100%; this command
-- completion must not overwrite that job state with failed.
begin;

create or replace function integritas_private.integritas_incomplete_control_command(
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
      result_summary = coalesce(p_result_summary, '{}'::jsonb) || jsonb_build_object('terminal_outcome', 'incomplete'),
      completed_at = now(),
      updated_at = now(),
      lease_expires_at = null
  where id = p_command_id
    and lease_owner = p_worker_id
    and status in ('leased','running');
  if not found then return false; end if;

  insert into public.integritas_control_audit(command_id, event_type, actor_type, actor_id, metadata)
  values (
    p_command_id,
    'completed_incomplete',
    'worker',
    p_worker_id,
    jsonb_build_object('terminal_outcome', 'incomplete')
  );
  return true;
end;
$$;

create or replace function public.integritas_control_incomplete(
  p_command_id uuid,
  p_worker_id text,
  p_result_summary jsonb default '{}'::jsonb
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select integritas_private.integritas_incomplete_control_command(
    p_command_id, p_worker_id, p_result_summary
  );
$$;

revoke all on function integritas_private.integritas_incomplete_control_command(uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.integritas_control_incomplete(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function integritas_private.integritas_incomplete_control_command(uuid,text,jsonb) to service_role;
grant execute on function public.integritas_control_incomplete(uuid,text,jsonb) to service_role;

commit;
