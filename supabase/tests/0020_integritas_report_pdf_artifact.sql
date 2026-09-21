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
  not has_function_privilege(
    'authenticated',
    'public.integritas_register_report_pdf_output(uuid,text,uuid,integer,text,text,bigint,jsonb)',
    'EXECUTE'
  ),
  'browser role cannot register investigation PDF outputs'
);
select pg_temp.assert_true(
  has_function_privilege(
    'service_role',
    'public.integritas_register_report_pdf_output(uuid,text,uuid,integer,text,text,bigint,jsonb)',
    'EXECUTE'
  ),
  'service role can register investigation PDF outputs'
);

set role service_role;
insert into public.integritas_cases(id, created_by, revision)
values ('a1111111-1111-4111-8111-111111111111', 'pdf-test', 1);

insert into public.integritas_admin_users(user_id)
values ('b2222222-2222-4222-8222-222222222222');

insert into public.integritas_case_access(case_id, user_id, role)
values (
  'a1111111-1111-4111-8111-111111111111',
  'b2222222-2222-4222-8222-222222222222',
  'owner'
);

select * from public.integritas_start_case_investigation(
  'a1111111-1111-4111-8111-111111111111',
  1,
  'deep',
  'b2222222-2222-4222-8222-222222222222',
  'pdf-output-start-0001'
) \gset pdf_job_

select id as leased_command_id
from public.integritas_control_lease('oracle-primary', 600)
\gset pdf_lease_

select pg_temp.assert_true(
  :'pdf_lease_leased_command_id'::uuid = :'pdf_job_control_command_id'::uuid,
  'PDF artifact test leases its investigation command'
);

create temp table pdf_context(command_id uuid, job_id uuid);
insert into pdf_context values (
  :'pdf_job_control_command_id'::uuid,
  :'pdf_job_case_job_id'::uuid
);

select public.integritas_register_report_pdf_output(
  :'pdf_job_control_command_id'::uuid,
  'oracle-primary',
  :'pdf_job_case_job_id'::uuid,
  1,
  'cases/a1111111-1111-4111-8111-111111111111/jobs/'||:'pdf_job_case_job_id'||'/outputs/report_pdf/'||repeat('c',64)||'.pdf',
  repeat('c',64),
  2048,
  jsonb_build_object(
    'renderer','integritas-report-renderer',
    'template_version','integritas-report-v1',
    'source_bundle_sha256',repeat('a',64),
    'source_markdown_sha256',repeat('b',64)
  )
);

reset role;
select pg_temp.assert_true(
  (
    select count(*)=1
      and bool_and(output_type='report_pdf')
      and bool_and(content_type='application/pdf')
      and bool_and(sha256=repeat('c',64))
      and bool_and(safe_metadata->>'template_version'='integritas-report-v1')
    from public.integritas_case_job_outputs
    where case_job_id=:'pdf_job_case_job_id'::uuid
  ),
  'PDF output is registered with typed metadata and digest'
);

set role service_role;
do $$ declare v_command uuid; v_job uuid; begin
  select command_id,job_id into v_command,v_job from pdf_context;
  perform public.integritas_register_report_pdf_output(
    v_command,'wrong-worker',v_job,1,
    'cases/a1111111-1111-4111-8111-111111111111/jobs/'||v_job::text||'/outputs/report_pdf/'||repeat('d',64)||'.pdf',
    repeat('d',64),1024,'{}'::jsonb
  );
  raise exception 'expected wrong-worker rejection';
exception when others then
  if sqlerrm not like '%access denied%' then raise; end if;
end $$;

do $$ declare v_command uuid; v_job uuid; begin
  select command_id,job_id into v_command,v_job from pdf_context;
  perform public.integritas_register_report_pdf_output(
    v_command,'oracle-primary',v_job,1,
    'cases/a1111111-1111-4111-8111-111111111111/jobs/'||v_job::text||'/outputs/evidence/'||repeat('e',64)||'.pdf',
    repeat('e',64),1024,'{}'::jsonb
  );
  raise exception 'expected PDF path rejection';
exception when others then
  if sqlerrm <> 'invalid investigation PDF output path' then raise; end if;
end $$;

reset role;
delete from public.integritas_case_job_outputs
where case_job_id=:'pdf_job_case_job_id'::uuid;

select 'report PDF artifact assertions passed' as result;
