begin;

alter table public.integritas_tool_invocations
  add column if not exists case_job_id uuid null,
  add column if not exists tool_name text,
  add column if not exists query_summary text not null default '',
  add column if not exists status text,
  add column if not exists safe_metadata jsonb not null default '{}'::jsonb,
  add column if not exists invoked_at timestamptz not null default now(),
  add column if not exists completed_at timestamptz null;

create index if not exists integritas_tool_invocations_job_tool_lookup
  on public.integritas_tool_invocations(case_job_id, tool_name, completed_at desc);

create schema if not exists private;

create or replace function private.integritas_source_provenance_guard()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $$
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
$$;

drop trigger if exists integritas_source_provenance_guard on public.integritas_sources;
create trigger integritas_source_provenance_guard
before insert or update on public.integritas_sources
for each row execute function private.integritas_source_provenance_guard();

commit;
