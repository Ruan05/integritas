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
  not has_function_privilege('authenticated', 'public.integritas_pause_case_investigation(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.integritas_resume_case_investigation(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.integritas_finalize_document_delete(uuid,uuid,uuid)', 'EXECUTE'),
  'browser roles cannot invoke pause, resume, or document deletion SQL directly'
);

set role service_role;

insert into public.integritas_cases(id,created_by,revision)
values('c1111111-1111-4111-8111-111111111111','pause-delete-test',1);
insert into public.integritas_admin_users(user_id)
values('c2222222-2222-4222-8222-222222222222');
insert into public.integritas_case_access(case_id,user_id,role)
values('c1111111-1111-4111-8111-111111111111','c2222222-2222-4222-8222-222222222222','owner');
insert into public.integritas_documents(id,case_id,name,mime_type,size_bytes,sha256,storage_path,extraction_status)
values(
  'c3333333-3333-4333-8333-333333333333','c1111111-1111-4111-8111-111111111111',
  'deletable.pdf','application/pdf',100,repeat('c',64),
  'cases/c1111111-1111-4111-8111-111111111111/documents/deletable.pdf','pending'
);

select * from public.integritas_start_case_investigation(
  'c1111111-1111-4111-8111-111111111111',1,'deep',
  'c2222222-2222-4222-8222-222222222222','pause-delete-start-0001'
) \gset pause_

select public.integritas_pause_case_investigation(
  :'pause_case_job_id'::uuid,'c2222222-2222-4222-8222-222222222222'
);
select pg_temp.assert_true(
  (select stage='paused' and pause_requested from public.integritas_case_jobs where id=:'pause_case_job_id'::uuid)
  and (select status='paused' from public.integritas_control_commands where id=:'pause_control_command_id'::uuid),
  'a queued investigation pauses without worker execution'
);

select public.integritas_resume_case_investigation(
  :'pause_case_job_id'::uuid,'c2222222-2222-4222-8222-222222222222'
);
select id as leased_command_id from public.integritas_control_lease('oracle-primary',600) \gset pause_lease_
select pg_temp.assert_true(
  :'pause_lease_leased_command_id'::uuid=:'pause_control_command_id'::uuid,
  'resumed investigation reuses its durable command'
);

select public.integritas_pause_case_investigation(
  :'pause_case_job_id'::uuid,'c2222222-2222-4222-8222-222222222222'
);
select pg_temp.assert_true(
  public.integritas_acknowledge_case_investigation_pause(
    :'pause_control_command_id'::uuid,'oracle-primary',:'pause_case_job_id'::uuid
  ),
  'worker can acknowledge an active pause request'
);
select pg_temp.assert_true(
  (select stage='paused' from public.integritas_case_jobs where id=:'pause_case_job_id'::uuid)
  and (select status='paused' from public.integritas_control_commands where id=:'pause_control_command_id'::uuid),
  'active pause is checkpointed durably'
);

select public.integritas_resume_case_investigation(
  :'pause_case_job_id'::uuid,'c2222222-2222-4222-8222-222222222222'
);
select id as released_command_id from public.integritas_control_lease('oracle-primary',600) \gset pause_resume_
select public.integritas_cancel_case_investigation(
  :'pause_case_job_id'::uuid,'c2222222-2222-4222-8222-222222222222'
);
select pg_temp.assert_true(
  public.integritas_acknowledge_case_investigation_cancel(
    :'pause_control_command_id'::uuid,'oracle-primary',:'pause_case_job_id'::uuid
  ),
  'a resumed investigation can be cancelled without corrupting pause recovery state'
);

select public.integritas_finalize_document_delete(
  'c1111111-1111-4111-8111-111111111111','c3333333-3333-4333-8333-333333333333','c2222222-2222-4222-8222-222222222222'
);
select pg_temp.assert_true(
  not exists (select 1 from public.integritas_documents where id='c3333333-3333-4333-8333-333333333333')
  and (select revision=2 from public.integritas_cases where id='c1111111-1111-4111-8111-111111111111')
  and exists (select 1 from public.integritas_control_audit where event_type='document_deleted' and actor_id='c2222222-2222-4222-8222-222222222222'),
  'safe document deletion increments the case revision and records an audit event'
);

insert into public.integritas_documents(id,case_id,name,mime_type,size_bytes,sha256,storage_path,extraction_status)
values(
  'c4444444-4444-4444-8444-444444444444','c1111111-1111-4111-8111-111111111111',
  'cited.pdf','application/pdf',100,repeat('d',64),
  'cases/c1111111-1111-4111-8111-111111111111/documents/cited.pdf','pending'
);
insert into public.integritas_sources(case_id,finding_id,source_type,title,document_id)
values('c1111111-1111-4111-8111-111111111111',gen_random_uuid(),'document','Cited evidence','c4444444-4444-4444-8444-444444444444');
do $$ begin
  perform public.integritas_finalize_document_delete(
    'c1111111-1111-4111-8111-111111111111','c4444444-4444-4444-8444-444444444444','c2222222-2222-4222-8222-222222222222'
  );
  raise exception 'expected saved-evidence protection';
exception when others then
  if sqlerrm <> 'cannot delete evidence cited by a saved investigation' then raise; end if;
end $$;

reset role;
select 'pause/resume/document deletion assertions passed' as result;
