\set ON_ERROR_STOP on

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if not coalesce(condition,false) then
    raise exception 'ASSERTION FAILED: %',message;
  end if;
end;
$$;

select pg_temp.assert_true(
  not has_function_privilege('authenticated','public.integritas_retry_case_investigation(uuid,uuid)','EXECUTE'),
  'browser role cannot retry investigations'
);
select pg_temp.assert_true(
  not has_function_privilege('authenticated','public.integritas_cancel_case_investigation(uuid,uuid)','EXECUTE'),
  'browser role cannot cancel investigations'
);
select pg_temp.assert_true(
  has_function_privilege('service_role','public.integritas_investigation_job_state(uuid,text,uuid)','EXECUTE'),
  'service role can read bounded recovery state'
);

set role service_role;
insert into public.integritas_cases(id,created_by,revision)
values('77777777-7777-4777-8777-777777777777','recovery-test',1);
insert into public.integritas_admin_users(user_id)
values('88888888-8888-4888-8888-888888888888');
insert into public.integritas_case_access(case_id,user_id,role)
values('77777777-7777-4777-8777-777777777777','88888888-8888-4888-8888-888888888888','owner');
insert into public.integritas_documents(
  id,case_id,name,mime_type,size_bytes,sha256,storage_path,extraction_status
) values(
  '99999999-9999-4999-8999-999999999999',
  '77777777-7777-4777-8777-777777777777',
  'recovery.pdf','application/pdf',100,repeat('9',64),
  'cases/77777777-7777-4777-8777-777777777777/documents/recovery.pdf','pending'
);

select * from public.integritas_start_case_investigation(
  '77777777-7777-4777-8777-777777777777',1,'deep',
  '88888888-8888-4888-8888-888888888888','recovery-start-0001'
) \gset recovery_

select id as leased_command_id
from public.integritas_control_lease('oracle-primary',600)
\gset recovery_lease_

select pg_temp.assert_true(
  :'recovery_lease_leased_command_id'::uuid = :'recovery_control_command_id'::uuid,
  'recovery test leases its investigation command'
);

select public.integritas_investigation_manifest_context(
  :'recovery_control_command_id'::uuid,'oracle-primary',:'recovery_case_job_id'::uuid
) as manifest \gset
select pg_temp.assert_true(
  (:'manifest'::jsonb->>'job_stage')='queued'
  and (:'manifest'::jsonb->>'job_progress')::integer=0
  and (:'manifest'::jsonb->>'cancel_requested')::boolean=false,
  'manifest exposes durable resume state'
);
select public.integritas_checkpoint_case_investigation(
  :'recovery_control_command_id'::uuid,'oracle-primary',:'recovery_case_job_id'::uuid,
  1,'extracting',5,jsonb_build_object('document_count',1)
);

select pg_temp.assert_true(
  public.integritas_control_fail(
    :'recovery_control_command_id'::uuid,'oracle-primary','synthetic_failure','synthetic failure'
  ),
  'worker failure is accepted'
);
select pg_temp.assert_true(
  (select stage='failed' and progress=5 from public.integritas_case_jobs where id=:'recovery_case_job_id'::uuid),
  'worker failure marks the linked investigation job failed'
);

reset role;
update public.integritas_cases
set revision=2 where id='77777777-7777-4777-8777-777777777777';
set role service_role;
do $$ begin
  perform public.integritas_retry_case_investigation(
    (select id from public.integritas_case_jobs where case_id='77777777-7777-4777-8777-777777777777'::uuid and runtime_provider='openclaw-oracle'),'88888888-8888-4888-8888-888888888888'::uuid
  );
  raise exception 'expected stale revision retry rejection';
exception when others then
  if sqlerrm <> 'case revision is stale' then raise; end if;
end $$;
reset role;
update public.integritas_cases
set revision=1 where id='77777777-7777-4777-8777-777777777777';
set role service_role;
select public.integritas_retry_case_investigation(
  :'recovery_case_job_id'::uuid,'88888888-8888-4888-8888-888888888888'
) as retry_result \gset
select pg_temp.assert_true(
  (select stage='extracting' and progress=5 and cancel_requested=false
   from public.integritas_case_jobs where id=:'recovery_case_job_id'::uuid)
  and
  (select status='queued' and lease_owner is null
   from public.integritas_control_commands where id=:'recovery_control_command_id'::uuid),
  'retry restores last non-terminal checkpoint and requeues same command'
);

select id as second_lease_id
from public.integritas_control_lease('oracle-primary',600)
\gset recovery_second_
select pg_temp.assert_true(
  :'recovery_second_second_lease_id'::uuid = :'recovery_control_command_id'::uuid,
  'retry leases the same command and job'
);

select public.integritas_cancel_case_investigation(
  :'recovery_case_job_id'::uuid,'88888888-8888-4888-8888-888888888888'
) as cancel_result \gset
select pg_temp.assert_true(
  (select cancel_requested=true from public.integritas_case_jobs where id=:'recovery_case_job_id'::uuid)
  and
  (select status in ('leased','running') from public.integritas_control_commands where id=:'recovery_control_command_id'::uuid),
  'active cancel is recorded as a pending worker acknowledgement'
);
select public.integritas_investigation_job_state(
  :'recovery_control_command_id'::uuid,'oracle-primary',:'recovery_case_job_id'::uuid
) as state_result \gset
select pg_temp.assert_true(
  (:'state_result'::jsonb->>'cancel_requested')::boolean=true
  and (:'state_result'::jsonb->>'stale_revision')::boolean=false,
  'worker state exposes cancellation and revision freshness'
);

select pg_temp.assert_true(
  public.integritas_acknowledge_case_investigation_cancel(
    :'recovery_control_command_id'::uuid,'oracle-primary',:'recovery_case_job_id'::uuid
  ),
  'worker acknowledges cancellation'
);
select pg_temp.assert_true(
  (select stage='cancelled' and progress=100 from public.integritas_case_jobs where id=:'recovery_case_job_id'::uuid)
  and
  (select status='cancelled' and lease_expires_at is null
   from public.integritas_control_commands where id=:'recovery_control_command_id'::uuid),
  'cancellation closes the durable job and control command'
);

reset role;
select pg_temp.assert_true(
  exists(select 1 from public.integritas_case_job_checkpoints
    where case_job_id=:'recovery_case_job_id'::uuid and stage='cancelled'),
  'cancellation records a durable terminal checkpoint without weakening table grants'
);
select 'investigation recovery assertions passed' as result;
