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
values('aaaaaaaa-1111-4111-8111-111111111111','incomplete-retry-test',1);
insert into public.integritas_admin_users(user_id)
values('aaaaaaaa-2222-4222-8222-222222222222');
insert into public.integritas_case_access(case_id,user_id,role)
values('aaaaaaaa-1111-4111-8111-111111111111','aaaaaaaa-2222-4222-8222-222222222222','owner');
insert into public.integritas_documents(
  id,case_id,name,mime_type,size_bytes,sha256,storage_path,extraction_status
) values(
  'aaaaaaaa-3333-4333-8333-333333333333',
  'aaaaaaaa-1111-4111-8111-111111111111',
  'incomplete-retry.pdf','application/pdf',100,repeat('a',64),
  'cases/aaaaaaaa-1111-4111-8111-111111111111/documents/incomplete-retry.pdf','pending'
);

select * from public.integritas_start_case_investigation(
  'aaaaaaaa-1111-4111-8111-111111111111',1,'deep',
  'aaaaaaaa-2222-4222-8222-222222222222','incomplete-retry-start-0001'
) \gset retry_

select id as leased_command_id
from public.integritas_control_lease('oracle-primary',600)
\gset lease_

select pg_temp.assert_true(
  :'lease_leased_command_id'::uuid = :'retry_control_command_id'::uuid,
  'incomplete-retry fixture leases its investigation command'
);

select public.integritas_checkpoint_case_investigation(
  :'retry_control_command_id'::uuid,'oracle-primary',:'retry_case_job_id'::uuid,
  1,'drafting_report',90,'{}'::jsonb
);
select public.integritas_checkpoint_case_investigation(
  :'retry_control_command_id'::uuid,'oracle-primary',:'retry_case_job_id'::uuid,
  1,'incomplete',100,'{}'::jsonb
);
select pg_temp.assert_true(
  public.integritas_control_complete(
    :'retry_control_command_id'::uuid,'oracle-primary',
    jsonb_build_object('terminal_outcome','incomplete')
  ),
  'incomplete command completes before retry'
);

select public.integritas_retry_case_investigation(
  :'retry_case_job_id'::uuid,'aaaaaaaa-2222-4222-8222-222222222222'
) as retry_result \gset resumed_

select pg_temp.assert_true(
  (select stage='drafting_report' and progress=90 and cancel_requested=false
   from public.integritas_case_jobs where id=:'retry_case_job_id'::uuid)
  and
  (select status='queued' and lease_owner is null
   from public.integritas_control_commands where id=:'retry_control_command_id'::uuid),
  'incomplete retry resumes from the last non-terminal checkpoint'
);

select id as released_command_id
from public.integritas_control_lease('oracle-primary',600)
\gset re_lease_
select pg_temp.assert_true(
  :'re_lease_released_command_id'::uuid = :'retry_control_command_id'::uuid,
  'resumed incomplete investigation leases the same durable command'
);

-- A resumed large runner may replay an earlier phase before reaching
-- the retained researching/drafting checkpoint. This must not regress state.
select public.integritas_checkpoint_case_investigation(
  :'retry_control_command_id'::uuid,'oracle-primary',:'retry_case_job_id'::uuid,
  1,'analyzing_documents',90,'{}'::jsonb
);
select pg_temp.assert_true(
  (select stage='drafting_report' and progress=90
   from public.integritas_case_jobs where id=:'retry_case_job_id'::uuid),
  'stale recovery checkpoint is an idempotent no-op'
);

select public.integritas_checkpoint_case_investigation(
  :'retry_control_command_id'::uuid,'oracle-primary',:'retry_case_job_id'::uuid,
  1,'completed',100,'{}'::jsonb
);
select pg_temp.assert_true(
  public.integritas_control_complete(
    :'retry_control_command_id'::uuid,'oracle-primary',
    jsonb_build_object('terminal_outcome','completed')
  ),
  'completed command closes normally'
);

do $$ begin
  perform public.integritas_retry_case_investigation(
    (select id from public.integritas_case_jobs where case_id='aaaaaaaa-1111-4111-8111-111111111111'::uuid),
    'aaaaaaaa-2222-4222-8222-222222222222'::uuid
  );
  raise exception 'expected completed investigation retry rejection';
exception when others then
  if sqlerrm <> 'investigation is not retryable' then raise; end if;
end $$;

reset role;
select 'incomplete retry assertions passed' as result;
