begin;

-- Attempt-scoped checkpoints cannot be collapsed safely if more than one
-- attempt retained the same stage. Abort rather than discard history.
do $$
begin
  if exists (
    select 1
    from public.integritas_case_job_checkpoints
    group by case_job_id, stage
    having count(*) > 1
  ) then
    raise exception 'cannot roll back attempt scope while duplicate stage history exists';
  end if;
end
$$;

drop trigger if exists integritas_sync_job_attempt on public.integritas_control_commands;
drop function if exists integritas_private.integritas_sync_job_attempt();

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
security definer set search_path = ''
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
  if not found then raise exception 'investigation checkpoint access denied'; end if;

  if v_job.stage = any(v_terminal) and p_stage <> v_job.stage then
    raise exception 'terminal investigation stage is immutable';
  end if;

  -- A resumed worker can replay cheap orchestration calls while validating
  -- retained artifacts. Those calls must be idempotent no-ops, never regress
  -- the durable resume checkpoint and never fail the resumed investigation.
  if p_progress < v_job.progress
    or (
      not (p_stage = any(v_terminal))
      and not (v_job.stage = any(v_terminal))
      and array_position(v_order, p_stage) < array_position(v_order, v_job.stage)
    )
  then
    select cp.* into v_checkpoint
    from public.integritas_case_job_checkpoints cp
    where cp.case_job_id = v_job.id
      and cp.stage = v_job.stage
    order by cp.updated_at desc
    limit 1;
    if not found then
      insert into public.integritas_case_job_checkpoints(
        case_id, case_job_id, case_revision, stage, progress, safe_metadata
      ) values (
        v_job.case_id, v_job.id, v_job.case_revision, v_job.stage, v_job.progress, '{}'::jsonb
      )
      returning * into v_checkpoint;
    end if;
    return v_checkpoint;
  end if;

  if p_stage = 'completed'
    and (v_job.stage not in ('drafting_report','completed') or p_progress <> 100) then
    raise exception 'completed stage requires drafted report and 100 percent progress';
  end if;

  update public.integritas_case_jobs
  set stage = p_stage, progress = p_progress, updated_at = now()
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

drop index if exists public.integritas_case_job_checkpoints_current_attempt_idx;
drop index if exists public.integritas_case_job_checkpoints_attempt_stage_key;

alter table public.integritas_case_job_checkpoints
  add constraint integritas_case_job_checkpoints_case_job_id_stage_key
  unique (case_job_id, stage);

alter table public.integritas_case_job_checkpoints
  drop column if exists attempt;
alter table public.integritas_case_jobs
  drop column if exists current_attempt;

commit;
