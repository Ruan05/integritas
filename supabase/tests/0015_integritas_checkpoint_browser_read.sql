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
  has_table_privilege('authenticated', 'public.integritas_case_job_checkpoints', 'SELECT'),
  'authenticated case members can read investigation checkpoints'
);
select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.integritas_case_job_checkpoints', 'INSERT,UPDATE,DELETE'),
  'authenticated browser role cannot mutate investigation checkpoints'
);
select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.integritas_case_job_checkpoints', 'SELECT'),
  'anonymous role cannot read investigation checkpoints'
);
select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.integritas_case_job_outputs', 'SELECT'),
  'raw output-artifact registrations remain server-only'
);
select pg_temp.assert_true(
  exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='integritas_case_job_checkpoints'
      and policyname='read authorized case checkpoints'
      and cmd='SELECT'
      and 'authenticated'=any(roles)
  ),
  'checkpoint case-access policy exists'
);

insert into public.integritas_case_jobs(
  id, case_id, opencode_job_id, job_kind, case_revision, requested_question,
  depth, stage, runtime_provider
) values
  (
    '30000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '32000000-0000-0000-0000-000000000001', 'research', 0, '', 'fast', 'queued', 'opencode-go'
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002',
    '32000000-0000-0000-0000-000000000002', 'research', 0, '', 'fast', 'queued', 'opencode-go'
  );

insert into public.integritas_case_job_checkpoints(
  id,case_id,case_job_id,case_revision,stage,progress,safe_metadata
) values
  (
    '31000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    0,'queued',0,'{}'::jsonb
  ),
  (
    '31000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000002',
    0,'queued',0,'{}'::jsonb
  );

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
select pg_temp.assert_true(
  (select count(*) from public.integritas_case_job_checkpoints) = 1,
  'case member sees only checkpoints for an authorized case'
);
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select pg_temp.assert_true(
  (
    select count(*)
    from public.integritas_case_job_checkpoints
    where id in (
      '31000000-0000-0000-0000-000000000001'::uuid,
      '31000000-0000-0000-0000-000000000002'::uuid
    )
  ) = 2,
  'admin sees checkpoints across cases'
);
reset role;

delete from public.integritas_case_job_checkpoints
where id in (
  '31000000-0000-0000-0000-000000000001'::uuid,
  '31000000-0000-0000-0000-000000000002'::uuid
);
delete from public.integritas_case_jobs
where id in (
  '30000000-0000-0000-0000-000000000001'::uuid,
  '30000000-0000-0000-0000-000000000002'::uuid
);

select 'Checkpoint browser-read assertions passed' as result;
