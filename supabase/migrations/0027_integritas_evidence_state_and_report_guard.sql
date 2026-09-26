begin;

alter table public.integritas_sources
  add column if not exists verification_state text;

update public.integritas_sources
set verification_state = case
  when evidence_origin = 'submitted_document' then 'submitted'
  when lower(coalesce(reliability_note, '')) like '%search discovery only%'
    or lower(coalesce(reliability_note, '')) like '%underlying url was not opened%'
    then 'discovered'
  else 'validated'
end
where verification_state is null;

alter table public.integritas_sources
  alter column verification_state set not null;

alter table public.integritas_sources
  drop constraint if exists integritas_sources_verification_state_check;
alter table public.integritas_sources
  add constraint integritas_sources_verification_state_check
  check (
    (evidence_origin = 'submitted_document' and verification_state = 'submitted')
    or
    (evidence_origin = 'external_research' and verification_state in ('discovered','opened','validated','claim_supporting'))
  );

create schema if not exists private;

create or replace function private.integritas_source_provenance_guard()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_invocation_id uuid;
  v_invocation_state text;
begin
  if new.evidence_origin = 'submitted_document' then
    new.verification_state := 'submitted';
    if new.document_id is null then
      raise exception 'Submitted document evidence requires a document';
    end if;
  elsif new.evidence_origin = 'external_research' then
    if new.url is null then
      raise exception 'External research evidence requires a URL and recorded tool invocation';
    end if;

    select ti.id, ti.safe_metadata->>'verification_state'
      into v_invocation_id, v_invocation_state
    from public.integritas_tool_invocations ti
    where ti.case_id = new.case_id
      and ti.case_job_id is not distinct from new.case_job_id
      and ti.tool_name = 'openclaw_external_research'
      and ti.status = 'completed'
      and ti.safe_metadata->>'source_key' = new.source_key
      and ti.safe_metadata->>'url' = new.url
    order by ti.completed_at desc nulls last, ti.invoked_at desc
    limit 1;

    if new.tool_invocation_id is null then
      new.tool_invocation_id := v_invocation_id;
    end if;

    if new.verification_state is null then
      if v_invocation_state in ('discovered','opened','validated','claim_supporting') then
        new.verification_state := v_invocation_state;
      elsif lower(coalesce(new.reliability_note, '')) like '%search discovery only%'
        or lower(coalesce(new.reliability_note, '')) like '%underlying url was not opened%' then
        new.verification_state := 'discovered';
      else
        new.verification_state := 'validated';
      end if;
    end if;

    if new.verification_state not in ('discovered','opened','validated','claim_supporting') then
      raise exception 'External research verification_state is invalid';
    end if;

    if new.verification_state in ('validated','claim_supporting')
      and (
        lower(coalesce(new.reliability_note, '')) like '%search discovery only%'
        or lower(coalesce(new.reliability_note, '')) like '%underlying url was not opened%'
      ) then
      raise exception 'Discovery-only source cannot be stored as validated evidence';
    end if;

    if v_invocation_state in ('discovered','opened','validated','claim_supporting')
      and new.verification_state <> v_invocation_state then
      raise exception 'External research verification_state does not match recorded provenance';
    end if;

    if new.tool_invocation_id is null then
      raise exception 'External research evidence requires a URL and recorded tool invocation';
    end if;
  else
    raise exception 'Unsupported evidence_origin';
  end if;

  return new;
end
$function$;

drop trigger if exists integritas_source_provenance_guard on public.integritas_sources;
create trigger integritas_source_provenance_guard
before insert or update on public.integritas_sources
for each row execute function private.integritas_source_provenance_guard();

create or replace function private.integritas_report_guard()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_current_revision integer;
  v_job public.integritas_case_jobs;
begin
  select revision into v_current_revision
  from public.integritas_cases
  where id = new.case_id;

  if v_current_revision is null then
    raise exception 'Case not found';
  end if;

  if new.based_on_revision <> v_current_revision and new.status <> 'stale' then
    raise exception 'Report revision does not match current case revision';
  end if;

  if new.status in ('reviewed','finalized') then
    if new.case_job_id is null then
      raise exception 'Reviewed/finalized reports require a source investigation job';
    end if;

    select * into v_job
    from public.integritas_case_jobs
    where id = new.case_job_id;

    if not found then
      raise exception 'Report source investigation job not found';
    end if;

    if v_job.case_id <> new.case_id or v_job.case_revision <> new.based_on_revision then
      raise exception 'Report source investigation identity does not match report';
    end if;

    if v_job.stage not in ('completed','incomplete','research_limit_reached') then
      raise exception 'Report source investigation stage is not reviewable: %', v_job.stage;
    end if;
  end if;

  if new.status = 'finalized' and new.reviewed_at is null then
    raise exception 'Finalized reports require analyst review';
  end if;

  return new;
end
$function$;

drop trigger if exists integritas_reports_guard on public.integritas_reports;
create trigger integritas_reports_guard
before insert or update on public.integritas_reports
for each row execute function private.integritas_report_guard();

commit;
