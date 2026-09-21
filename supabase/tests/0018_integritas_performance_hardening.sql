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
  to_regclass('public.integritas_case_job_checkpoints_case_id_idx') is not null,
  'case-job checkpoints case_id FK must have a covering index'
);
select pg_temp.assert_true(
  to_regclass('public.integritas_case_job_outputs_case_id_idx') is not null,
  'case-job outputs case_id FK must have a covering index'
);
select pg_temp.assert_true(
  to_regclass('public.integritas_control_audit_command_id_idx') is not null,
  'control audit command_id FK must have a covering index'
);
select pg_temp.assert_true(
  to_regclass('public.integritas_finding_source_links_case_id_idx') is not null,
  'finding-source case_id FK must have a covering index'
);
select pg_temp.assert_true(
  to_regclass('public.integritas_finding_source_links_finding_id_idx') is not null,
  'finding-source finding_id FK must have a covering index'
);
select pg_temp.assert_true(
  to_regclass('public.integritas_finding_source_links_source_id_idx') is not null,
  'finding-source source_id FK must have a covering index'
);

select pg_temp.assert_true(
  (
    select count(*) = 5
       and bool_and(lower(pg_get_expr(p.polqual,p.polrelid)) ~ 'select[[:space:]]+auth\.uid\(\)')
    from pg_policy p
    join pg_class c on c.oid=p.polrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and (c.relname,p.polname) in (
        ('integritas_admin_users','read own admin identity'),
        ('integritas_case_access','read own case access'),
        ('integritas_agent_threads','read authorized agent threads'),
        ('integritas_change_sets','read own change sets'),
        ('integritas_repositories','read own repositories')
      )
  ),
  'browser RLS policies must initialize auth.uid once per statement'
);

select 'performance hardening assertions passed' as result;
