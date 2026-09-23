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

insert into public.integritas_admin_users(user_id)
values('b23b23b2-2222-4222-8222-222222222222');

-- Fixture A: a model-analysis fallback plus later completed phases must resume
-- from the last trustworthy boundary before analysis (38%), not queued/0 or 15%.
insert into public.integritas_cases(id,created_by,revision)
values('b23b23b2-1111-4111-8111-111111111111','checkpoint-resume-a',1);
insert into public.integritas_case_access(case_id,user_id,role)
values('b23b23b2-1111-4111-8111-111111111111','b23b23b2-2222-4222-8222-222222222222','owner');
insert into public.integritas_documents(
  id,case_id,name,mime_type,size_bytes,sha256,storage_path,extraction_status
) values(
  'b23b23b2-3333-4333-8333-333333333333',
  'b23b23b2-1111-4111-8111-111111111111',
  'resume-a.pdf','application/pdf',100,repeat('b',64),
  'cases/b23b23b2-1111-4111-8111-111111111111/documents/resume-a.pdf','pending'
);

select * from public.integritas_start_case_investigation(
  'b23b23b2-1111-4111-8111-111111111111',1,'maximum',
  'b23b23b2-2222-4222-8222-222222222222','checkpoint-resume-a-start'
) \gset a_

select id as leased_command_id
from public.integritas_control_lease('oracle-primary',600)
\gset alease_

select public.integritas_checkpoint_case_investigation(
  :'a_control_command_id'::uuid,'oracle-primary',:'a_case_job_id'::uuid,1,
  'mapping_entities',38,'{}'::jsonb
);
select public.integritas_checkpoint_case_investigation(
  :'a_control_command_id'::uuid,'oracle-primary',:'a_case_job_id'::uuid,1,
  'researching',52,'{}'::jsonb
);
select public.integritas_checkpoint_case_investigation(
  :'a_control_command_id'::uuid,'oracle-primary',:'a_case_job_id'::uuid,1,
  'independent_review',68,'{}'::jsonb
);
select public.integritas_checkpoint_case_investigation(
  :'a_control_command_id'::uuid,'oracle-primary',:'a_case_job_id'::uuid,1,
  'drafting_report',90,'{}'::jsonb
);
select public.integritas_checkpoint_case_investigation(
  :'a_control_command_id'::uuid,'oracle-primary',:'a_case_job_id'::uuid,1,
  'incomplete',100,'{}'::jsonb
);

insert into public.integritas_checks(
  case_id,case_job_id,case_revision,check_key,check_type,description,status,outcome,priority
) values(
  'b23b23b2-1111-4111-8111-111111111111',:'a_case_job_id'::uuid,1,
  'unresolved:analysis.provider','unresolved',
  'Model-assisted synthesis was unavailable.','blocked',
  'Provider route was unavailable.','high'
);

select pg_temp.assert_true(
  public.integritas_control_complete(
    :'a_control_command_id'::uuid,'oracle-primary',
    jsonb_build_object('terminal_outcome','incomplete')
  ),
  'analysis-fallback fixture completes as incomplete'
);

select public.integritas_retry_case_investigation(
  :'a_case_job_id'::uuid,'b23b23b2-2222-4222-8222-222222222222'
) as retry_result \gset aresume_

select pg_temp.assert_true(
  (select stage='mapping_entities' and progress=38 and pause_requested=false and cancel_requested=false
   from public.integritas_case_jobs where id=:'a_case_job_id'::uuid)
  and
  (select status='queued' and lease_owner is null
   from public.integritas_control_commands where id=:'a_control_command_id'::uuid),
  'Continue resumes analysis fallback at the 38% trustworthy checkpoint'
);

select id as released_command_id
from public.integritas_control_lease('oracle-primary',600)
\gset arelease_

-- Early orchestration calls made while validating retained artifacts are no-ops.
select public.integritas_checkpoint_case_investigation(
  :'a_control_command_id'::uuid,'oracle-primary',:'a_case_job_id'::uuid,1,
  'extracting',5,'{"resume_validation":true}'::jsonb
);
select pg_temp.assert_true(
  (select stage='mapping_entities' and progress=38
   from public.integritas_case_jobs where id=:'a_case_job_id'::uuid),
  'retained-artifact validation cannot regress durable resume progress'
);

-- A failed second attempt must not jump forward to the older 90% checkpoint
-- that still exists for the same durable job id.
select pg_temp.assert_true(
  public.integritas_control_fail(
    :'a_control_command_id'::uuid,'oracle-primary','synthetic_retry_failure','synthetic retry failure'
  ),
  'fixture can fail the resumed attempt at 38%'
);
select public.integritas_retry_case_investigation(
  :'a_case_job_id'::uuid,'b23b23b2-2222-4222-8222-222222222222'
) as retry_result \gset aresume2_
select pg_temp.assert_true(
  (select stage='mapping_entities' and progress=38
   from public.integritas_case_jobs where id=:'a_case_job_id'::uuid),
  'failed continuation is scoped to current-attempt progress instead of an older high-water checkpoint'
);
select id as released_command_id
from public.integritas_control_lease('oracle-primary',600)
\gset arelease2_

-- Close fixture A so it cannot interfere with subsequent leases.
select public.integritas_checkpoint_case_investigation(
  :'a_control_command_id'::uuid,'oracle-primary',:'a_case_job_id'::uuid,1,
  'drafting_report',90,'{}'::jsonb
);
select public.integritas_checkpoint_case_investigation(
  :'a_control_command_id'::uuid,'oracle-primary',:'a_case_job_id'::uuid,1,
  'completed',100,'{}'::jsonb
);
select pg_temp.assert_true(
  public.integritas_control_complete(
    :'a_control_command_id'::uuid,'oracle-primary',
    jsonb_build_object('terminal_outcome','completed')
  ),
  'analysis-fallback fixture closes after resume'
);

-- Fixture B: only a failed specialist lane should resume at the research lane
-- boundary (52%) while prior extraction/planning/analysis remain reusable.
insert into public.integritas_cases(id,created_by,revision)
values('b23b23b2-4444-4444-8444-444444444444','checkpoint-resume-b',1);
insert into public.integritas_case_access(case_id,user_id,role)
values('b23b23b2-4444-4444-8444-444444444444','b23b23b2-2222-4222-8222-222222222222','owner');
insert into public.integritas_documents(
  id,case_id,name,mime_type,size_bytes,sha256,storage_path,extraction_status
) values(
  'b23b23b2-5555-4555-8555-555555555555',
  'b23b23b2-4444-4444-8444-444444444444',
  'resume-b.pdf','application/pdf',100,repeat('c',64),
  'cases/b23b23b2-4444-4444-8444-444444444444/documents/resume-b.pdf','pending'
);

select * from public.integritas_start_case_investigation(
  'b23b23b2-4444-4444-8444-444444444444',1,'deep',
  'b23b23b2-2222-4222-8222-222222222222','checkpoint-resume-b-start'
) \gset b_

select id as leased_command_id
from public.integritas_control_lease('oracle-primary',600)
\gset blease_

select public.integritas_checkpoint_case_investigation(
  :'b_control_command_id'::uuid,'oracle-primary',:'b_case_job_id'::uuid,1,
  'researching',52,'{}'::jsonb
);
select public.integritas_checkpoint_case_investigation(
  :'b_control_command_id'::uuid,'oracle-primary',:'b_case_job_id'::uuid,1,
  'drafting_report',90,'{}'::jsonb
);
select public.integritas_checkpoint_case_investigation(
  :'b_control_command_id'::uuid,'oracle-primary',:'b_case_job_id'::uuid,1,
  'incomplete',100,'{}'::jsonb
);
insert into public.integritas_checks(
  case_id,case_job_id,case_revision,check_key,check_type,description,status,outcome,priority
) values(
  'b23b23b2-4444-4444-8444-444444444444',:'b_case_job_id'::uuid,1,
  'lane.core.corporate_identity','research_lane',
  'Verify corporate identity.','blocked',
  'Automated research was unavailable; no external claim was asserted.','critical'
);
select pg_temp.assert_true(
  public.integritas_control_complete(
    :'b_control_command_id'::uuid,'oracle-primary',
    jsonb_build_object('terminal_outcome','incomplete')
  ),
  'research-lane fixture completes as incomplete'
);
select public.integritas_retry_case_investigation(
  :'b_case_job_id'::uuid,'b23b23b2-2222-4222-8222-222222222222'
) as retry_result \gset bresume_
select pg_temp.assert_true(
  (select stage='researching' and progress=52
   from public.integritas_case_jobs where id=:'b_case_job_id'::uuid),
  'Continue resumes a failed research lane at 52%'
);

-- Fixture C: if no automated phase is unresolved (for example a renderer-only
-- failure), Continue uses the latest non-terminal durable checkpoint.
insert into public.integritas_cases(id,created_by,revision)
values('b23b23b2-6666-4666-8666-666666666666','checkpoint-resume-c',1);
insert into public.integritas_case_access(case_id,user_id,role)
values('b23b23b2-6666-4666-8666-666666666666','b23b23b2-2222-4222-8222-222222222222','owner');
insert into public.integritas_documents(
  id,case_id,name,mime_type,size_bytes,sha256,storage_path,extraction_status
) values(
  'b23b23b2-7777-4777-8777-777777777777',
  'b23b23b2-6666-4666-8666-666666666666',
  'resume-c.pdf','application/pdf',100,repeat('d',64),
  'cases/b23b23b2-6666-4666-8666-666666666666/documents/resume-c.pdf','pending'
);

-- Complete fixture B before leasing C.
select id as released_command_id
from public.integritas_control_lease('oracle-primary',600)
\gset brelease_
select public.integritas_checkpoint_case_investigation(
  :'b_control_command_id'::uuid,'oracle-primary',:'b_case_job_id'::uuid,1,
  'drafting_report',90,'{}'::jsonb
);
select public.integritas_checkpoint_case_investigation(
  :'b_control_command_id'::uuid,'oracle-primary',:'b_case_job_id'::uuid,1,
  'completed',100,'{}'::jsonb
);
select public.integritas_control_complete(
  :'b_control_command_id'::uuid,'oracle-primary',jsonb_build_object('terminal_outcome','completed')
);

select * from public.integritas_start_case_investigation(
  'b23b23b2-6666-4666-8666-666666666666',1,'deep',
  'b23b23b2-2222-4222-8222-222222222222','checkpoint-resume-c-start'
) \gset c_
select id as leased_command_id
from public.integritas_control_lease('oracle-primary',600)
\gset clease_
select public.integritas_checkpoint_case_investigation(
  :'c_control_command_id'::uuid,'oracle-primary',:'c_case_job_id'::uuid,1,
  'drafting_report',90,'{}'::jsonb
);
select public.integritas_checkpoint_case_investigation(
  :'c_control_command_id'::uuid,'oracle-primary',:'c_case_job_id'::uuid,1,
  'incomplete',100,'{}'::jsonb
);
select public.integritas_control_complete(
  :'c_control_command_id'::uuid,'oracle-primary',jsonb_build_object('terminal_outcome','incomplete')
);
select public.integritas_retry_case_investigation(
  :'c_case_job_id'::uuid,'b23b23b2-2222-4222-8222-222222222222'
) as retry_result \gset cresume_
select pg_temp.assert_true(
  (select stage='drafting_report' and progress=90
   from public.integritas_case_jobs where id=:'c_case_job_id'::uuid),
  'renderer-only style retry resumes at latest 90% checkpoint'
);


-- Fixture D: a failed current attempt must never borrow a later checkpoint from
-- an older attempt. The failed job's own progress is the upper resume bound.
insert into public.integritas_cases(id,created_by,revision)
values('b23b23b2-8888-4888-8888-888888888888','checkpoint-resume-d',1);
insert into public.integritas_case_access(case_id,user_id,role)
values('b23b23b2-8888-4888-8888-888888888888','b23b23b2-2222-4222-8222-222222222222','owner');
insert into public.integritas_documents(
  id,case_id,name,mime_type,size_bytes,sha256,storage_path,extraction_status
) values(
  'b23b23b2-9999-4999-8999-999999999999',
  'b23b23b2-8888-4888-8888-888888888888',
  'resume-d.pdf','application/pdf',100,repeat('e',64),
  'cases/b23b23b2-8888-4888-8888-888888888888/documents/resume-d.pdf','pending'
);

-- Close fixture C before leasing D.
select id as released_command_id
from public.integritas_control_lease('oracle-primary',600)
\gset crelease_
select public.integritas_checkpoint_case_investigation(
  :'c_control_command_id'::uuid,'oracle-primary',:'c_case_job_id'::uuid,1,
  'completed',100,'{}'::jsonb
);
select public.integritas_control_complete(
  :'c_control_command_id'::uuid,'oracle-primary',jsonb_build_object('terminal_outcome','completed')
);

select * from public.integritas_start_case_investigation(
  'b23b23b2-8888-4888-8888-888888888888',1,'maximum',
  'b23b23b2-2222-4222-8222-222222222222','checkpoint-resume-d-start'
) \gset d_
select id as leased_command_id
from public.integritas_control_lease('oracle-primary',600)
\gset dlease_

-- Simulate an older attempt that once reached 90%.
select public.integritas_checkpoint_case_investigation(
  :'d_control_command_id'::uuid,'oracle-primary',:'d_case_job_id'::uuid,1,
  'mapping_entities',38,'{}'::jsonb
);
select public.integritas_checkpoint_case_investigation(
  :'d_control_command_id'::uuid,'oracle-primary',:'d_case_job_id'::uuid,1,
  'drafting_report',90,'{}'::jsonb
);

-- Reset the live row to the point where the current attempt actually failed.
update public.integritas_case_jobs
set stage='failed',progress=38,updated_at=now()
where id=:'d_case_job_id'::uuid;
update public.integritas_control_commands
set status='failed',lease_owner=null,lease_expires_at=null,updated_at=now()
where id=:'d_control_command_id'::uuid;

select public.integritas_retry_case_investigation(
  :'d_case_job_id'::uuid,'b23b23b2-2222-4222-8222-222222222222'
) as retry_result \gset dresume_

select pg_temp.assert_true(
  (select stage='mapping_entities' and progress=38
   from public.integritas_case_jobs where id=:'d_case_job_id'::uuid),
  'failed current attempt cannot borrow an older 90% checkpoint'
);

reset role;
select 'checkpoint resume assertions passed' as result;
