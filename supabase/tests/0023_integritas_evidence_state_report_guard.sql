\set ON_ERROR_STOP on

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if not coalesce(condition, false) then
    raise exception 'ASSERTION FAILED: %', message;
  end if;
end;
$$;

select pg_temp.assert_true(
  exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='integritas_sources' and column_name='verification_state'
  ),
  'source verification_state column exists'
);

set role service_role;

insert into public.integritas_cases(id, created_by, revision)
values ('12121212-1212-4121-8121-121212121212', 'evidence-state-test', 1);

insert into public.integritas_admin_users(user_id)
values ('13131313-1313-4131-8131-131313131313');

insert into public.integritas_case_access(case_id, user_id, role)
values ('12121212-1212-4121-8121-121212121212', '13131313-1313-4131-8131-131313131313', 'owner');

insert into public.integritas_documents(
  id, case_id, name, mime_type, size_bytes, sha256, storage_path, extraction_status
) values (
  '14141414-1414-4141-8141-141414141414',
  '12121212-1212-4121-8121-121212121212',
  'guard.pdf','application/pdf',100,repeat('1',64),
  'cases/12121212-1212-4121-8121-121212121212/documents/guard.pdf','pending'
);

select * from public.integritas_start_case_investigation(
  '12121212-1212-4121-8121-121212121212', 1, 'maximum',
  '13131313-1313-4131-8131-131313131313', 'evidence-state-start-0001'
) \gset guard_job_

create temp table guard_context(job_id uuid);
insert into guard_context values (:'guard_job_case_job_id'::uuid);

insert into public.integritas_sources(
  case_id, case_job_id, case_revision, source_key, source_type, title,
  document_id, excerpt, reliability_note, evidence_origin
) values (
  '12121212-1212-4121-8121-121212121212',
  :'guard_job_case_job_id'::uuid, 1, 'doc.guard',
  'document', 'guard.pdf', '14141414-1414-4141-8141-141414141414',
  'submitted evidence', 'submitted fixture', 'submitted_document'
);

select pg_temp.assert_true(
  (select verification_state='submitted'
   from public.integritas_sources
   where case_job_id=:'guard_job_case_job_id'::uuid and source_key='doc.guard'),
  'submitted evidence is tagged submitted'
);

insert into public.integritas_tool_invocations(
  id, case_id, case_job_id, tool_name, status, safe_metadata, invoked_at, completed_at
) values (
  '15151515-1515-4151-8151-151515151515',
  '12121212-1212-4121-8121-121212121212',
  :'guard_job_case_job_id'::uuid,
  'openclaw_external_research',
  'completed',
  jsonb_build_object('source_key','ext.discovery','url','https://example.test/discovery','verification_state','discovered'),
  now(), now()
);

insert into public.integritas_sources(
  case_id, case_job_id, case_revision, source_key, source_type, title,
  url, excerpt, reliability_note, evidence_origin
) values (
  '12121212-1212-4121-8121-121212121212',
  :'guard_job_case_job_id'::uuid, 1, 'ext.discovery',
  'secondary', 'Search result', 'https://example.test/discovery',
  'search snippet', 'Search discovery only. The underlying URL was not opened in this phase and cannot substantiate a verified or official claim.',
  'external_research'
);

select pg_temp.assert_true(
  (select verification_state='discovered' and tool_invocation_id is not null
   from public.integritas_sources
   where case_job_id=:'guard_job_case_job_id'::uuid and source_key='ext.discovery'),
  'search-only evidence is discovery-only and retains tool provenance'
);

do $guard$
begin
  update public.integritas_sources
  set verification_state='validated'
  where case_job_id=(select job_id from guard_context) and source_key='ext.discovery';
  raise exception 'expected discovery promotion rejection';
exception when others then
  if sqlerrm <> 'Discovery-only source cannot be stored as validated evidence' then raise; end if;
end
$guard$;

insert into public.integritas_reports(
  case_id, case_job_id, based_on_revision, report_key, status, summary, content_markdown, limitations
) values (
  '12121212-1212-4121-8121-121212121212',
  :'guard_job_case_job_id'::uuid,
  1, 'guard-report', 'draft', 'Guard report', '# Guard report', ''
);

do $guard$
begin
  update public.integritas_reports
  set status='reviewed', reviewed_at=now(), reviewed_by='13131313-1313-4131-8131-131313131313'
  where case_job_id=(select job_id from guard_context);
  raise exception 'expected active-job review rejection';
exception when others then
  if sqlerrm not like 'Report source investigation stage is not reviewable:%' then raise; end if;
end
$guard$;

update public.integritas_case_jobs
set stage='incomplete', progress=100
where id=:'guard_job_case_job_id'::uuid;

update public.integritas_reports
set status='reviewed', reviewed_at=now(), reviewed_by='13131313-1313-4131-8131-131313131313'
where case_job_id=(select job_id from guard_context);

update public.integritas_case_jobs
set stage='cancelled', progress=100
where id=:'guard_job_case_job_id'::uuid;

do $guard$
begin
  update public.integritas_reports
  set status='finalized', finalized_at=now(), finalized_by='13131313-1313-4131-8131-131313131313'
  where case_job_id=(select job_id from guard_context);
  raise exception 'expected cancelled-job finalization rejection';
exception when others then
  if sqlerrm <> 'Report source investigation stage is not reviewable: cancelled' then raise; end if;
end
$guard$;

update public.integritas_case_jobs
set stage='incomplete', progress=100
where id=:'guard_job_case_job_id'::uuid;

update public.integritas_reports
set status='finalized', finalized_at=now(), finalized_by='13131313-1313-4131-8131-131313131313'
where case_job_id=(select job_id from guard_context);

select pg_temp.assert_true(
  (select status='finalized'
   from public.integritas_reports
   where case_job_id=:'guard_job_case_job_id'::uuid),
  'reviewed report from an admissible terminal job can finalize'
);

reset role;

select 'evidence state and report guard assertions passed' as result;
