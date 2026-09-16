\set ON_ERROR_STOP on

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void
language plpgsql
as $$
begin
  if not coalesce(condition, false) then
    raise exception 'ASSERTION FAILED: %', message;
  end if;
end;
$$;

select pg_temp.assert_true(
  to_regclass('public.integritas_case_job_checkpoints') is not null,
  'investigation checkpoints table exists'
);
select pg_temp.assert_true(
  to_regclass('public.integritas_case_job_outputs') is not null,
  'investigation outputs table exists'
);
select pg_temp.assert_true(
  not has_function_privilege('authenticated', 'public.integritas_investigation_manifest_context(uuid,text,uuid)', 'EXECUTE'),
  'browser role cannot fetch worker manifests'
);
select pg_temp.assert_true(
  has_function_privilege('service_role', 'public.integritas_investigation_manifest_context(uuid,text,uuid)', 'EXECUTE'),
  'service role can fetch worker manifests'
);

set role service_role;
select id as case_job_id, control_command_id
from public.integritas_case_jobs
where case_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and case_revision = 4
  and runtime_provider = 'openclaw-oracle'
\gset runtime_

select id as command_id
from public.integritas_control_commands
where idempotency_key = 'wrapper-test-health-0001'
  and status = 'queued'
\gset prior_

select id as command_id
from public.integritas_control_lease('oracle-primary', 600)
\gset drained_
select pg_temp.assert_true(
  :'drained_command_id'::uuid = :'prior_command_id'::uuid,
  'persistence test drains the known older synthetic wrapper command first'
);
select pg_temp.assert_true(
  public.integritas_control_complete(
    :'drained_command_id'::uuid,
    'oracle-primary',
    '{"test_cleanup":true}'::jsonb
  ),
  'synthetic wrapper command is completed through the bounded RPC'
);

select id as command_id
from public.integritas_control_lease('oracle-primary', 600)
\gset leased_
select pg_temp.assert_true(
  :'leased_command_id'::uuid = :'runtime_control_command_id'::uuid,
  'investigation persistence uses the leased runtime command'
);

insert into public.integritas_documents(
  id, case_id, name, mime_type, size_bytes, sha256, storage_path, extraction_status
) values
  ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'alpha.pdf','application/pdf',100,repeat('a',64),'cases/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/documents/alpha.pdf','pending'),
  ('22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'beta.pdf','application/pdf',120,repeat('b',64),'cases/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/documents/beta.pdf','pending');

select public.integritas_investigation_manifest_context(
  :'runtime_control_command_id'::uuid,
  'oracle-primary',
  :'runtime_case_job_id'::uuid
) as payload
\gset manifest_
select pg_temp.assert_true(
  (:'manifest_payload'::jsonb->>'case_job_id')::uuid = :'runtime_case_job_id'::uuid,
  'manifest is bound to the leased case job'
);
select pg_temp.assert_true(
  (:'manifest_payload'::jsonb->>'case_revision')::integer = 4,
  'manifest is bound to the current case revision'
);
select pg_temp.assert_true(
  jsonb_array_length(:'manifest_payload'::jsonb->'documents') = 2,
  'manifest contains only the registered case documents'
);
select pg_temp.assert_true(
  :'manifest_payload' not like '%signed_url%'
    and :'manifest_payload' not like '%download_url%'
    and :'manifest_payload' not like '%/storage/v1/object/sign/%',
  'database manifest context never persists signed URLs'
);

create or replace function pg_temp.assert_wrong_worker_denied(p_command uuid, p_job uuid)
returns void language plpgsql as $$
begin
  perform public.integritas_investigation_manifest_context(p_command, 'wrong-worker', p_job);
  raise exception 'expected wrong worker denial';
exception when others then
  if sqlerrm <> 'investigation manifest access denied' then raise; end if;
end;
$$;
select pg_temp.assert_wrong_worker_denied(:'runtime_control_command_id'::uuid, :'runtime_case_job_id'::uuid);
select public.integritas_checkpoint_case_investigation(
  :'runtime_control_command_id'::uuid, 'oracle-primary', :'runtime_case_job_id'::uuid,
  4, 'researching', 55, '{"branch_count":2}'::jsonb
);
select pg_temp.assert_true(
  exists (
    select 1 from public.integritas_case_jobs
    where id = :'runtime_case_job_id'::uuid and stage = 'researching' and progress = 55
  ),
  'checkpoint advances durable job stage and progress'
);

create or replace function pg_temp.assert_checkpoint_rejected(
  p_command uuid, p_job uuid, p_revision integer, p_stage text, p_progress integer, p_expected text
) returns void language plpgsql as $$
begin
  perform public.integritas_checkpoint_case_investigation(
    p_command, 'oracle-primary', p_job, p_revision, p_stage, p_progress, '{}'::jsonb
  );
  raise exception 'expected checkpoint rejection';
exception when others then
  if sqlerrm <> p_expected then raise; end if;
end;
$$;
select pg_temp.assert_checkpoint_rejected(
  :'runtime_control_command_id'::uuid, :'runtime_case_job_id'::uuid,
  4, 'verifying', 40, 'investigation progress cannot move backwards'
);
select public.integritas_checkpoint_case_investigation(
  :'runtime_control_command_id'::uuid, 'oracle-primary', :'runtime_case_job_id'::uuid,
  4, 'failed', 60, '{"reason":"synthetic"}'::jsonb
);
select pg_temp.assert_checkpoint_rejected(
  :'runtime_control_command_id'::uuid, :'runtime_case_job_id'::uuid,
  4, 'researching', 70, 'terminal investigation stage is immutable'
);
select public.integritas_register_case_job_output(
  :'runtime_control_command_id'::uuid, 'oracle-primary', :'runtime_case_job_id'::uuid, 4,
  'bundle', 'application/json',
  format('cases/%s/jobs/%s/outputs/bundle.json', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', :'runtime_case_job_id'),
  repeat('c', 64), 123, '{"artifact":"bundle"}'::jsonb
);
select public.integritas_register_case_job_output(
  :'runtime_control_command_id'::uuid, 'oracle-primary', :'runtime_case_job_id'::uuid, 4,
  'bundle', 'application/json',
  format('cases/%s/jobs/%s/outputs/bundle.json', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', :'runtime_case_job_id'),
  repeat('c', 64), 123, '{"artifact":"bundle"}'::jsonb
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.integritas_case_job_outputs
   where case_job_id = :'runtime_case_job_id'::uuid and output_type = 'bundle'),
  'output registration is idempotent for the same job/type/digest'
);
select pg_temp.assert_true(
  not exists (
    select 1 from public.integritas_case_job_outputs
    where safe_metadata::text like '%/storage/v1/object/sign/%'
       or storage_path like 'http%'
  ),
  'persisted output metadata and paths contain no signed URLs'
);
update public.integritas_cases
set revision = 5
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

create or replace function pg_temp.assert_stale_manifest_denied(p_command uuid, p_job uuid)
returns void language plpgsql as $$
begin
  perform public.integritas_investigation_manifest_context(p_command, 'oracle-primary', p_job);
  raise exception 'expected stale manifest denial';
exception when others then
  if sqlerrm <> 'investigation manifest access denied' then raise; end if;
end;
$$;
select pg_temp.assert_stale_manifest_denied(
  :'runtime_control_command_id'::uuid, :'runtime_case_job_id'::uuid
);
select pg_temp.assert_checkpoint_rejected(
  :'runtime_control_command_id'::uuid, :'runtime_case_job_id'::uuid,
  4, 'failed', 60, 'investigation checkpoint access denied'
);

reset role;
