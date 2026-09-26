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
  exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='integritas_case_jobs'
      and column_name='runtime_provider' and is_nullable='NO'
  ),
  'case jobs expose a required runtime provider'
);

select pg_temp.assert_true(
  exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='integritas_case_jobs'
      and column_name='control_command_id'
  ),
  'case jobs can link to a control command'
);

select pg_temp.assert_true(
  not has_function_privilege(
    'authenticated',
    'public.integritas_start_case_investigation(uuid,integer,text,uuid,text)',
    'EXECUTE'
  ),
  'browser roles cannot invoke the investigation-start wrapper'
);
select pg_temp.assert_true(
  has_function_privilege(
    'service_role',
    'public.integritas_start_case_investigation(uuid,integer,text,uuid,text)',
    'EXECUTE'
  ),
  'only the server wrapper can invoke investigation start'
);
select pg_temp.assert_true(
  to_regclass('public.integritas_case_jobs_openclaw_revision_key') is not null,
  'one OpenClaw job is allowed per case revision'
);

set role service_role;

insert into public.integritas_cases(id, created_by, revision) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'runtime-test', 4);
insert into public.integritas_admin_users(user_id) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.integritas_case_access(case_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'admin');

select * from public.integritas_start_case_investigation(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  4,
  'deep',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'investigation-start-0001'
) \gset first_

select * from public.integritas_start_case_investigation(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  4,
  'deep',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'investigation-start-0001'
) \gset retry_

select pg_temp.assert_true(
  :'first_case_job_id'::uuid = :'retry_case_job_id'::uuid
    and :'first_control_command_id'::uuid = :'retry_control_command_id'::uuid,
  'retries return the original job and command'
);

select pg_temp.assert_true(
  (select count(*) = 1 from public.integritas_case_jobs
   where case_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and case_revision = 4
     and runtime_provider = 'openclaw-oracle')
  and
  (select count(*) = 1 from public.integritas_control_commands
   where case_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and command_type = 'run_case_investigation'),
  'idempotent start creates exactly one job and one command'
);

select pg_temp.assert_true(
  exists (
    select 1
    from public.integritas_case_jobs j
    join public.integritas_control_commands c on c.id = j.control_command_id
    where j.id = :'first_case_job_id'::uuid
      and j.case_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and j.case_revision = 4
      and j.runtime_provider = 'openclaw-oracle'
      and c.case_id = j.case_id
      and c.command_type = 'run_case_investigation'
      and c.payload = jsonb_build_object(
        'case_id', j.case_id,
        'case_job_id', j.id,
        'case_revision', j.case_revision,
        'depth', j.depth
      )
  ),
  'job, command, payload, case, and revision stay linked'
);

do $$
begin
  perform public.integritas_start_case_investigation(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    3,
    'deep',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'investigation-start-stale'
  );
  raise exception 'expected stale case revision rejection';
exception when others then
  if sqlerrm <> 'case revision is stale' then
    raise;
  end if;
end;
$$;

do $$
begin
  perform public.integritas_control_enqueue(
    'run_case_investigation',
    '{}'::jsonb,
    'edge:test',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'investigation-generic-0001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );
  raise exception 'expected generic investigation enqueue rejection';
exception when others then
  if sqlerrm <> 'unsupported control command' then
    raise;
  end if;
end;
$$;

reset role;

select 'OpenClaw investigation runtime assertions passed' as result;
