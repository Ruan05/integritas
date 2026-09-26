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
  to_regprocedure(
    'public.integritas_register_report_pdf_output(uuid,text,uuid,integer,text,text,bigint,jsonb)'
  ) is null,
  'report PDF public registration function is removed by rollback'
);

select pg_temp.assert_true(
  to_regprocedure(
    'integritas_private.integritas_register_report_pdf_output(uuid,text,uuid,integer,text,text,bigint,jsonb)'
  ) is null,
  'report PDF private registration function is removed by rollback'
);

select pg_temp.assert_true(
  (
    select position('report_pdf' in pg_get_constraintdef(oid)) = 0
    from pg_constraint
    where conname='integritas_case_job_outputs_output_type_check'
  ),
  'output type constraint no longer permits report_pdf'
);

select pg_temp.assert_true(
  (
    select position('application/pdf' in pg_get_constraintdef(oid)) = 0
    from pg_constraint
    where conname='integritas_case_job_outputs_content_type_check'
  ),
  'content type constraint no longer permits application/pdf'
);

select 'report PDF artifact rollback assertions passed' as result;
