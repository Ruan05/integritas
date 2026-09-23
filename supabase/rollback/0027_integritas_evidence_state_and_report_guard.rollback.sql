begin;

drop trigger if exists integritas_reports_guard on public.integritas_reports;
drop function if exists private.integritas_report_guard();

create or replace function private.integritas_report_guard()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  current_revision integer;
begin
  select revision into current_revision
  from public.integritas_cases
  where id = new.case_id;

  if current_revision is null then
    raise exception 'Case not found';
  end if;

  if new.based_on_revision <> current_revision and new.status <> 'stale' then
    raise exception 'Report revision does not match current case revision';
  end if;

  if new.status = 'finalized' and new.reviewed_at is null then
    raise exception 'Finalized reports require analyst review';
  end if;

  return new;
end
$function$;

create trigger integritas_reports_guard
before insert or update on public.integritas_reports
for each row execute function private.integritas_report_guard();

create or replace function private.integritas_source_provenance_guard()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_invocation_id uuid;
begin
  if new.evidence_origin='external_research' then
    if new.url is null then
      raise exception 'External research evidence requires a URL and recorded tool invocation';
    end if;
    if new.tool_invocation_id is null then
      select ti.id into v_invocation_id
      from public.integritas_tool_invocations ti
      where ti.case_id = new.case_id
        and ti.case_job_id is not distinct from new.case_job_id
        and ti.tool_name = 'openclaw_external_research'
        and ti.status = 'completed'
        and ti.safe_metadata->>'source_key' = new.source_key
        and ti.safe_metadata->>'url' = new.url
      order by ti.completed_at desc nulls last, ti.invoked_at desc
      limit 1;
      new.tool_invocation_id := v_invocation_id;
    end if;
    if new.tool_invocation_id is null then
      raise exception 'External research evidence requires a URL and recorded tool invocation';
    end if;
  end if;
  if new.evidence_origin='submitted_document' and new.document_id is null then
    raise exception 'Submitted document evidence requires a document';
  end if;
  return new;
end
$function$;

alter table public.integritas_sources
  drop constraint if exists integritas_sources_verification_state_check;
alter table public.integritas_sources
  drop column if exists verification_state;

commit;
