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
  to_regclass('public.integritas_finding_source_links') is not null,
  'finding/source lineage table exists'
);
select pg_temp.assert_true(
  not has_function_privilege('authenticated', 'public.integritas_commit_investigation_bundle(uuid,text,uuid,integer,text,text,jsonb)', 'EXECUTE'),
  'browser role cannot commit investigation bundles'
);
select pg_temp.assert_true(
  has_function_privilege('service_role', 'public.integritas_commit_investigation_bundle(uuid,text,uuid,integer,text,text,jsonb)', 'EXECUTE'),
  'service role can commit investigation bundles'
);

set role service_role;
insert into public.integritas_cases(id, created_by, revision)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'bundle-test', 1);
insert into public.integritas_admin_users(user_id)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
insert into public.integritas_case_access(case_id, user_id, role)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'owner');

select * from public.integritas_start_case_investigation(
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 1, 'deep',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'bundle-commit-start-0001'
) \gset bundle_job_

select id as leased_command_id
from public.integritas_control_lease('oracle-primary', 600)
\gset bundle_lease_
select pg_temp.assert_true(
  :'bundle_lease_leased_command_id'::uuid = :'bundle_job_control_command_id'::uuid,
  'bundle test leases its investigation command'
);

create temp table bundle_context(command_id uuid, job_id uuid);
insert into bundle_context values (:'bundle_job_control_command_id'::uuid, :'bundle_job_case_job_id'::uuid);

insert into public.integritas_documents(
  id, case_id, name, mime_type, size_bytes, sha256, storage_path, extraction_status
) values (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'identity.pdf','application/pdf',100,repeat('e',64),
  'cases/cccccccc-cccc-4ccc-8ccc-cccccccccccc/documents/identity.pdf','pending'
);


create temp table bundle_fixture(bundle jsonb);
insert into bundle_fixture(bundle) values (jsonb_build_object(
  'schema_version',1,
  'case_id','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'case_job_id',:'bundle_job_case_job_id',
  'case_revision',1,
  'depth','deep',
  'generated_at','2026-09-17T12:00:00Z',
  'entities',jsonb_build_array(
    jsonb_build_object('entity_key','person-a','entity_type','person','display_name','Same Name','aliases','[]'::jsonb,'identifiers','{"passport":"A1"}'::jsonb,'match_status','verified','confidence',95),
    jsonb_build_object('entity_key','person-b','entity_type','person','display_name','Same Name','aliases','[]'::jsonb,'identifiers','{"passport":"B2"}'::jsonb,'match_status','verified','confidence',93)
  ),
  'relationships',jsonb_build_array(
    jsonb_build_object('relationship_key','rel-1','from_entity_key','person-a','to_entity_key','person-b','relationship_type','associate','claim','Synthetic relationship','evidence_status','verified','source_keys',jsonb_build_array('src-1'),'confidence',88)
  ),
  'sources',jsonb_build_array(
    jsonb_build_object('source_key','src-1','source_type','document','title','Identity evidence','url',null,'document_id','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','page_reference','1','excerpt','Synthetic evidence','reliability_note','fixture','evidence_origin','submitted_document','retrieved_at','2026-09-17T12:00:00Z')
  ),
  'findings',jsonb_build_array(
    jsonb_build_object('finding_key','finding-a','entity_key','person-a','finding_type','identity','claim','First same-name person','evidence_status','verified','materiality','medium','reliability','high','evidence_excerpt','Synthetic evidence','source_keys',jsonb_build_array('src-1')),
    jsonb_build_object('finding_key','finding-b','entity_key','person-b','finding_type','identity','claim','Second same-name person','evidence_status','verified','materiality','medium','reliability','high','evidence_excerpt','Synthetic evidence','source_keys',jsonb_build_array('src-1'))
  ),
  'checks',jsonb_build_array(
    jsonb_build_object('check_key','check-1','entity_key','person-a','check_type','identity','description','Verify identity','priority','high','required_source','official record','status','complete','outcome','verified')
  ),
  'contradictions',jsonb_build_array(
    jsonb_build_object('contradiction_key','conflict-1','finding_keys',jsonb_build_array('finding-a','finding-b'),'description','Synthetic contradictory identity claims')
  ),
  'unresolved_checks',jsonb_build_array(
    jsonb_build_object('unresolved_key','manual-1','description','Manual registry follow-up','reason','Registry unavailable','attempted_methods',jsonb_build_array('web lookup'),'blocker','temporary outage','next_manual_action','retry registry')
  ),
  'limitations',jsonb_build_array('Synthetic test data only'),
  'report',jsonb_build_object('summary','Synthetic report','markdown','# Synthetic report','status','draft'),
  'execution',jsonb_build_object('started_at','2026-09-17T11:00:00Z','completed_at','2026-09-17T12:00:00Z','stages',jsonb_build_array('extracting','drafting_report'),'tool_results','[]'::jsonb,'warnings','[]'::jsonb,'terminal_outcome','completed')
));

select public.integritas_register_case_job_output(
  :'bundle_job_control_command_id'::uuid,'oracle-primary',:'bundle_job_case_job_id'::uuid,1,
  'bundle','application/json',
  'cases/cccccccc-cccc-4ccc-8ccc-cccccccccccc/jobs/'||:'bundle_job_case_job_id'||'/outputs/bundle.json',
  repeat('a',64),1000,'{}'::jsonb
);
select public.integritas_register_case_job_output(
  :'bundle_job_control_command_id'::uuid,'oracle-primary',:'bundle_job_case_job_id'::uuid,1,
  'report_markdown','text/markdown',
  'cases/cccccccc-cccc-4ccc-8ccc-cccccccccccc/jobs/'||:'bundle_job_case_job_id'||'/outputs/report.md',
  repeat('b',64),100,'{}'::jsonb
);

select public.integritas_commit_investigation_bundle(
  :'bundle_job_control_command_id'::uuid,'oracle-primary',:'bundle_job_case_job_id'::uuid,1,
  repeat('a',64),repeat('b',64),(select bundle from bundle_fixture)
) as commit_summary \gset first_

select pg_temp.assert_true(
  (select count(*)=2 and count(distinct entity_key)=2 and count(distinct display_name)=1
   from public.integritas_entities where case_job_id=:'bundle_job_case_job_id'::uuid),
  'same-name entities stay distinct by stable entity_key'
);
select pg_temp.assert_true(
  (select count(*) >= 2 from public.integritas_finding_source_links where case_job_id=:'bundle_job_case_job_id'::uuid),
  'findings retain many-to-many source lineage'
);
select pg_temp.assert_true(
  (select count(*)=1 and bool_and(status='draft') from public.integritas_reports where case_job_id=:'bundle_job_case_job_id'::uuid),
  'bundle commit creates exactly one draft report'
);
select pg_temp.assert_true(
  (select count(*)=1 from public.integritas_relationships where case_job_id=:'bundle_job_case_job_id'::uuid)
  and (select count(*)=3 from public.integritas_findings where case_job_id=:'bundle_job_case_job_id'::uuid)
  and (select count(*)=2 from public.integritas_checks where case_job_id=:'bundle_job_case_job_id'::uuid),
  'relationships, contradiction finding, checks, and unresolved checks materialize'
);

-- Replay/idempotent commit must preserve logical row counts.
select public.integritas_commit_investigation_bundle(
  :'bundle_job_control_command_id'::uuid,'oracle-primary',:'bundle_job_case_job_id'::uuid,1,
  repeat('a',64),repeat('b',64),(select bundle from bundle_fixture)
);
select pg_temp.assert_true(
  (select count(*)=2 from public.integritas_entities where case_job_id=:'bundle_job_case_job_id'::uuid)
  and (select count(*)=1 from public.integritas_relationships where case_job_id=:'bundle_job_case_job_id'::uuid)
  and (select count(*)=1 from public.integritas_sources where case_job_id=:'bundle_job_case_job_id'::uuid)
  and (select count(*)=3 from public.integritas_findings where case_job_id=:'bundle_job_case_job_id'::uuid)
  and (select count(*)=2 from public.integritas_checks where case_job_id=:'bundle_job_case_job_id'::uuid)
  and (select count(*)=1 from public.integritas_reports where case_job_id=:'bundle_job_case_job_id'::uuid),
  'idempotent replay does not duplicate logical result rows'
);

do $$ declare v_command uuid; v_job uuid; begin
  select command_id,job_id into v_command,v_job from bundle_context;
  perform public.integritas_commit_investigation_bundle(
    v_command,'wrong-worker',v_job,1,repeat('a',64),repeat('b',64),(select bundle from bundle_fixture));
  raise exception 'expected wrong-worker rejection';
exception when others then if sqlerrm not like '%access denied%' then raise; end if; end $$;

do $$ declare v_command uuid; v_job uuid; begin
  select command_id,job_id into v_command,v_job from bundle_context;
  perform public.integritas_commit_investigation_bundle(
    v_command,'oracle-primary',v_job,0,repeat('a',64),repeat('b',64),(select bundle from bundle_fixture));
  raise exception 'expected stale-revision rejection';
exception when others then if sqlerrm not like '%access denied%' then raise; end if; end $$;

do $$ declare v_command uuid; begin
  select command_id into v_command from bundle_context;
  perform public.integritas_commit_investigation_bundle(
    v_command,'oracle-primary','ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid,1,
    repeat('a',64),repeat('b',64),(select bundle from bundle_fixture));
  raise exception 'expected wrong-job rejection';
exception when others then if sqlerrm not like '%access denied%' then raise; end if; end $$;

do $$ declare v_command uuid; v_job uuid; begin
  select command_id,job_id into v_command,v_job from bundle_context;
  perform public.integritas_commit_investigation_bundle(
    v_command,'oracle-primary',v_job,1,repeat('a',64),repeat('b',64),
    jsonb_set((select bundle from bundle_fixture),'{findings,0,source_keys}','["missing-source"]'::jsonb));
  raise exception 'expected missing-source rejection';
exception when others then if sqlerrm <> 'investigation bundle references unknown source key' then raise; end if; end $$;

do $$ declare v_command uuid; v_job uuid; begin
  select command_id,job_id into v_command,v_job from bundle_context;
  perform public.integritas_commit_investigation_bundle(
    v_command,'oracle-primary',v_job,1,repeat('a',64),repeat('b',64),
    jsonb_set((select bundle from bundle_fixture),'{report,status}','"finalized"'::jsonb));
  raise exception 'expected finalized-report rejection';
exception when others then if sqlerrm <> 'investigation report must be draft' then raise; end if; end $$;

select pg_temp.assert_true(
  not exists (select 1 from public.integritas_reports where case_job_id=:'bundle_job_case_job_id'::uuid and status in ('reviewed','finalized')),
  'worker commit never creates a reviewed or finalized report'
);

-- Leave the disposable fixture clean enough for the migration rollback gate.
delete from public.integritas_finding_source_links where case_job_id=:'bundle_job_case_job_id'::uuid;
delete from public.integritas_relationships where case_job_id=:'bundle_job_case_job_id'::uuid;
delete from public.integritas_sources where case_job_id=:'bundle_job_case_job_id'::uuid;
delete from public.integritas_findings where case_job_id=:'bundle_job_case_job_id'::uuid;
delete from public.integritas_checks where case_job_id=:'bundle_job_case_job_id'::uuid;
delete from public.integritas_reports where case_job_id=:'bundle_job_case_job_id'::uuid;
delete from public.integritas_entities where case_job_id=:'bundle_job_case_job_id'::uuid;
reset role;
-- The service role intentionally has no direct DELETE grant on server-only output rows.
-- Cleanup that disposable fixture row as the database owner instead of weakening production grants.
delete from public.integritas_case_job_outputs where case_job_id=:'bundle_job_case_job_id'::uuid;
select 'investigation bundle commit assertions passed' as result;
