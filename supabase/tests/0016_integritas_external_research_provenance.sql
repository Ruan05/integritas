create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if not coalesce(condition, false) then
    raise exception 'ASSERTION FAILED: %', message;
  end if;
end;
$$;

set role service_role;

insert into public.integritas_cases(id, created_by, revision)
values ('14141414-1414-4141-8141-141414141414', 'external-provenance-test', 1);

insert into public.integritas_tool_invocations(
  id, case_id, case_job_id, tool_name, query_summary, status, safe_metadata, invoked_at, completed_at
) values (
  '15151515-1515-4151-8151-151515151515',
  '14141414-1414-4141-8141-141414141414',
  null,
  'openclaw_external_research',
  'Synthetic official source',
  'completed',
  '{"source_key":"source-web","url":"https://example.com/official"}'::jsonb,
  '2026-09-18T20:00:00Z',
  '2026-09-18T20:00:05Z'
);

insert into public.integritas_sources(
  id, case_id, finding_id, source_type, title, url, document_id, page_reference,
  excerpt, reliability_note, retrieved_at, evidence_origin, tool_invocation_id,
  case_job_id, case_revision, source_key
) values (
  '16161616-1616-4161-8161-161616161616',
  '14141414-1414-4141-8141-141414141414',
  null,
  'official',
  'Synthetic official source',
  'https://example.com/official',
  null,
  null,
  'Synthetic public source',
  'fixture',
  '2026-09-18T20:00:00Z',
  'external_research',
  null,
  null,
  1,
  'source-web'
);

select pg_temp.assert_true(
  (select tool_invocation_id = '15151515-1515-4151-8151-151515151515'::uuid
   from public.integritas_sources
   where id='16161616-1616-4161-8161-161616161616'),
  'external research source is bound to the matching completed OpenClaw invocation'
);

do $$
begin
  begin
    insert into public.integritas_sources(
      id, case_id, finding_id, source_type, title, url, document_id, page_reference,
      excerpt, reliability_note, retrieved_at, evidence_origin, tool_invocation_id,
      case_job_id, case_revision, source_key
    ) values (
      '17171717-1717-4171-8171-171717171717',
      '14141414-1414-4141-8141-141414141414',
      null,
      'official',
      'Unobserved source',
      'https://example.com/unobserved',
      null,
      null,
      'Synthetic public source',
      'fixture',
      '2026-09-18T20:00:00Z',
      'external_research',
      null,
      null,
      1,
      'source-unobserved'
    );
    raise exception 'expected unobserved external source rejection';
  exception when others then
    if sqlerrm not like '%External research evidence requires a URL and recorded tool invocation%' then
      raise;
    end if;
  end;
end
$$;

delete from public.integritas_sources where case_id='14141414-1414-4141-8141-141414141414';
delete from public.integritas_tool_invocations where case_id='14141414-1414-4141-8141-141414141414';
delete from public.integritas_cases where id='14141414-1414-4141-8141-141414141414';

reset role;

select 'external research provenance assertions passed' as result;
