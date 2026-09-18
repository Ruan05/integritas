begin;
create or replace function private.integritas_source_provenance_guard()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $$
begin
  if new.evidence_origin='external_research' and (new.url is null or new.tool_invocation_id is null) then
    raise exception 'External research evidence requires a URL and recorded tool invocation';
  end if;
  if new.evidence_origin='submitted_document' and new.document_id is null then
    raise exception 'Submitted document evidence requires a document';
  end if;
  return new;
end
$$;
drop index if exists public.integritas_tool_invocations_job_tool_lookup;
commit;
