\set ON_ERROR_STOP on

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if not coalesce(condition,false) then
    raise exception 'ASSERTION FAILED: %',message;
  end if;
end;
$$;

set role service_role;

insert into public.integritas_cases(id,created_by,revision)
values('bbbbbbbb-1111-4111-8111-111111111111','draft-replacement-test',1);
insert into public.integritas_admin_users(user_id)
values('bbbbbbbb-2222-4222-8222-222222222222');
insert into public.integritas_case_access(case_id,user_id,role)
values('bbbbbbbb-1111-4111-8111-111111111111','bbbbbbbb-2222-4222-8222-222222222222','owner');
insert into public.integritas_documents(
  id,case_id,name,mime_type,size_bytes,sha256,storage_path,extraction_status
) values(
  'bbbbbbbb-3333-4333-8333-333333333333',
  'bbbbbbbb-1111-4111-8111-111111111111',
  'replacement.txt','text/plain',100,repeat('a',64),
  'cases/bbbbbbbb-1111-4111-8111-111111111111/documents/replacement.txt','ready'
);

select * from public.integritas_start_case_investigation(
  'bbbbbbbb-1111-4111-8111-111111111111',1,'fast',
  'bbbbbbbb-2222-4222-8222-222222222222','draft-replacement-start-0001'
) \gset rep_

select id as leased_command_id
from public.integritas_control_lease('oracle-primary',600)
\gset lease_

select pg_temp.assert_true(
  :'lease_leased_command_id'::uuid = :'rep_control_command_id'::uuid,
  'replacement fixture leases its investigation command'
);

create temp table replacement_bundles(version integer primary key,bundle jsonb);
insert into replacement_bundles values
(1,jsonb_build_object(
  'schema_version',1,
  'case_id','bbbbbbbb-1111-4111-8111-111111111111',
  'case_job_id',:'rep_case_job_id',
  'case_revision',1,
  'depth','fast',
  'generated_at','2026-09-19T18:00:00Z',
  'entities',jsonb_build_array(
    jsonb_build_object('entity_key','entity-a','entity_type','person','display_name','Alpha','aliases','[]'::jsonb,'identifiers','{}'::jsonb,'match_status','probable','confidence',80),
    jsonb_build_object('entity_key','entity-stale','entity_type','company','display_name','Stale Co','aliases','[]'::jsonb,'identifiers','{}'::jsonb,'match_status','proposed','confidence',40)
  ),
  'relationships','[]'::jsonb,
  'sources',jsonb_build_array(
    jsonb_build_object('source_key','source-a','source_type','document','title','replacement.txt','url',null,'document_id','bbbbbbbb-3333-4333-8333-333333333333','page_reference',null,'excerpt','Synthetic evidence','reliability_note','fixture','evidence_origin','submitted_document','retrieved_at','2026-09-19T18:00:00Z')
  ),
  'findings',jsonb_build_array(
    jsonb_build_object('finding_key','finding-a','entity_key','entity-a','finding_type','identity','claim','Alpha claim','evidence_status','uncertain','materiality','medium','reliability','medium','evidence_excerpt','Synthetic evidence','source_keys',jsonb_build_array('source-a'))
  ),
  'checks',jsonb_build_array(
    jsonb_build_object('check_key','check-a','entity_key','entity-a','check_type','identity','description','Check Alpha','priority','medium','required_source','manual','status','blocked','outcome','pending'),
    jsonb_build_object('check_key','check-stale','entity_key','entity-stale','check_type','registry','description','Stale check','priority','low','required_source','manual','status','blocked','outcome','pending')
  ),
  'contradictions','[]'::jsonb,
  'unresolved_checks','[]'::jsonb,
  'limitations',jsonb_build_array('Synthetic fixture'),
  'report',jsonb_build_object('summary','First draft','markdown','# First draft','status','draft'),
  'execution',jsonb_build_object('started_at','2026-09-19T17:55:00Z','completed_at','2026-09-19T18:00:00Z','stages','[]'::jsonb,'tool_results','[]'::jsonb,'warnings','[]'::jsonb,'terminal_outcome','incomplete')
)),
(2,jsonb_build_object(
  'schema_version',1,
  'case_id','bbbbbbbb-1111-4111-8111-111111111111',
  'case_job_id',:'rep_case_job_id',
  'case_revision',1,
  'depth','fast',
  'generated_at','2026-09-19T18:05:00Z',
  'entities',jsonb_build_array(
    jsonb_build_object('entity_key','entity-a','entity_type','person','display_name','Alpha Updated','aliases','[]'::jsonb,'identifiers','{}'::jsonb,'match_status','verified','confidence',95)
  ),
  'relationships','[]'::jsonb,
  'sources',jsonb_build_array(
    jsonb_build_object('source_key','source-a','source_type','document','title','replacement.txt','url',null,'document_id','bbbbbbbb-3333-4333-8333-333333333333','page_reference',null,'excerpt','Updated evidence','reliability_note','fixture','evidence_origin','submitted_document','retrieved_at','2026-09-19T18:05:00Z')
  ),
  'findings',jsonb_build_array(
    jsonb_build_object('finding_key','finding-a','entity_key','entity-a','finding_type','identity','claim','Updated Alpha claim','evidence_status','verified','materiality','medium','reliability','high','evidence_excerpt','Updated evidence','source_keys',jsonb_build_array('source-a'))
  ),
  'checks',jsonb_build_array(
    jsonb_build_object('check_key','check-a','entity_key','entity-a','check_type','identity','description','Check Alpha','priority','medium','required_source','manual','status','complete','outcome','verified')
  ),
  'contradictions','[]'::jsonb,
  'unresolved_checks','[]'::jsonb,
  'limitations',jsonb_build_array('Synthetic fixture updated'),
  'report',jsonb_build_object('summary','Second draft','markdown','# Second draft','status','draft'),
  'execution',jsonb_build_object('started_at','2026-09-19T17:55:00Z','completed_at','2026-09-19T18:05:00Z','stages','[]'::jsonb,'tool_results','[]'::jsonb,'warnings','[]'::jsonb,'terminal_outcome','completed')
));

select public.integritas_register_case_job_output(
  :'rep_control_command_id'::uuid,'oracle-primary',:'rep_case_job_id'::uuid,1,
  'bundle','application/json',
  'cases/bbbbbbbb-1111-4111-8111-111111111111/jobs/'||:'rep_case_job_id'||'/outputs/bundle-v1.json',
  repeat('a',64),1000,'{}'::jsonb
);
select public.integritas_register_case_job_output(
  :'rep_control_command_id'::uuid,'oracle-primary',:'rep_case_job_id'::uuid,1,
  'report_markdown','text/markdown',
  'cases/bbbbbbbb-1111-4111-8111-111111111111/jobs/'||:'rep_case_job_id'||'/outputs/report-v1.md',
  repeat('b',64),100,'{}'::jsonb
);
select public.integritas_commit_investigation_bundle(
  :'rep_control_command_id'::uuid,'oracle-primary',:'rep_case_job_id'::uuid,1,
  repeat('a',64),repeat('b',64),(select bundle from replacement_bundles where version=1)
);

select pg_temp.assert_true(
  (select count(*)=2 from public.integritas_entities where case_job_id=:'rep_case_job_id'::uuid)
  and (select count(*)=2 from public.integritas_checks where case_job_id=:'rep_case_job_id'::uuid),
  'first draft materializes the original rows'
);

select public.integritas_register_case_job_output(
  :'rep_control_command_id'::uuid,'oracle-primary',:'rep_case_job_id'::uuid,1,
  'bundle','application/json',
  'cases/bbbbbbbb-1111-4111-8111-111111111111/jobs/'||:'rep_case_job_id'||'/outputs/bundle-v2.json',
  repeat('c',64),900,'{}'::jsonb
);
select public.integritas_register_case_job_output(
  :'rep_control_command_id'::uuid,'oracle-primary',:'rep_case_job_id'::uuid,1,
  'report_markdown','text/markdown',
  'cases/bbbbbbbb-1111-4111-8111-111111111111/jobs/'||:'rep_case_job_id'||'/outputs/report-v2.md',
  repeat('d',64),100,'{}'::jsonb
);
select public.integritas_commit_investigation_bundle(
  :'rep_control_command_id'::uuid,'oracle-primary',:'rep_case_job_id'::uuid,1,
  repeat('c',64),repeat('d',64),(select bundle from replacement_bundles where version=2)
);

select pg_temp.assert_true(
  (select count(*)=1 and max(display_name)='Alpha Updated'
   from public.integritas_entities where case_job_id=:'rep_case_job_id'::uuid)
  and (select count(*)=1 and max(check_key)='check-a'
   from public.integritas_checks where case_job_id=:'rep_case_job_id'::uuid)
  and (select count(*)=1 from public.integritas_findings where case_job_id=:'rep_case_job_id'::uuid)
  and (select count(*)=1 from public.integritas_sources where case_job_id=:'rep_case_job_id'::uuid)
  and (select count(*)=1 from public.integritas_finding_source_links where case_job_id=:'rep_case_job_id'::uuid),
  'replacement removes stale job-scoped rows instead of accumulating them'
);

select pg_temp.assert_true(
  (select count(*)=1
          and bool_and(bundle_sha256=repeat('c',64)
                       and report_sha256=repeat('d',64)
                       and summary='Second draft')
   from public.integritas_reports where case_job_id=:'rep_case_job_id'::uuid),
  'replacement atomically updates the one draft report'
);

update public.integritas_case_jobs
set stage='incomplete', progress=100
where id=:'rep_case_job_id'::uuid;

update public.integritas_reports
set status='reviewed', reviewed_at=now()
where case_job_id=:'rep_case_job_id'::uuid;

update public.integritas_reports
set status='finalized', finalized_at=now()
where case_job_id=:'rep_case_job_id'::uuid;

select public.integritas_register_case_job_output(
  :'rep_control_command_id'::uuid,'oracle-primary',:'rep_case_job_id'::uuid,1,
  'bundle','application/json',
  'cases/bbbbbbbb-1111-4111-8111-111111111111/jobs/'||:'rep_case_job_id'||'/outputs/bundle-v3.json',
  repeat('e',64),900,'{}'::jsonb
);
select public.integritas_register_case_job_output(
  :'rep_control_command_id'::uuid,'oracle-primary',:'rep_case_job_id'::uuid,1,
  'report_markdown','text/markdown',
  'cases/bbbbbbbb-1111-4111-8111-111111111111/jobs/'||:'rep_case_job_id'||'/outputs/report-v3.md',
  repeat('f',64),100,'{}'::jsonb
);

do $replacement$ declare v_command uuid; v_job uuid; begin
  select control_command_id,id into v_command,v_job
  from public.integritas_case_jobs
  where case_id='bbbbbbbb-1111-4111-8111-111111111111'::uuid;
  perform public.integritas_commit_investigation_bundle(
    v_command,'oracle-primary',v_job,1,repeat('e',64),repeat('f',64),
    (select bundle from replacement_bundles where version=2)
  );
  raise exception 'expected finalized replacement rejection';
exception when others then
  if sqlerrm <> 'investigation report is no longer draft' then raise; end if;
end $replacement$;

select pg_temp.assert_true(
  (select bundle_sha256=repeat('c',64) and report_sha256=repeat('d',64)
   from public.integritas_reports where case_job_id=:'rep_case_job_id'::uuid),
  'finalized report remains immutable'
);

reset role;

delete from public.integritas_finding_source_links where case_job_id=:'rep_case_job_id'::uuid;
delete from public.integritas_relationships where case_job_id=:'rep_case_job_id'::uuid;
delete from public.integritas_sources where case_job_id=:'rep_case_job_id'::uuid;
delete from public.integritas_findings where case_job_id=:'rep_case_job_id'::uuid;
delete from public.integritas_checks where case_job_id=:'rep_case_job_id'::uuid;
delete from public.integritas_reports where case_job_id=:'rep_case_job_id'::uuid;
delete from public.integritas_entities where case_job_id=:'rep_case_job_id'::uuid;
delete from public.integritas_case_job_outputs where case_job_id=:'rep_case_job_id'::uuid;
select 'draft bundle replacement assertions passed' as result;
