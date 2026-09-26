begin;

drop function if exists public.integritas_register_report_pdf_output(
  uuid,text,uuid,integer,text,text,bigint,jsonb
);
drop function if exists integritas_private.integritas_register_report_pdf_output(
  uuid,text,uuid,integer,text,text,bigint,jsonb
);

do $$
begin
  if exists (
    select 1 from public.integritas_case_job_outputs where output_type = 'report_pdf'
  ) then
    raise exception 'cannot rollback report PDF artifact support while report_pdf outputs exist';
  end if;
end;
$$;

alter table public.integritas_case_job_outputs
  drop constraint if exists integritas_case_job_outputs_output_type_check;
alter table public.integritas_case_job_outputs
  add constraint integritas_case_job_outputs_output_type_check
  check (output_type in ('bundle','report_markdown','report_html','evidence','execution_log'));

alter table public.integritas_case_job_outputs
  drop constraint if exists integritas_case_job_outputs_content_type_check;
alter table public.integritas_case_job_outputs
  add constraint integritas_case_job_outputs_content_type_check
  check (content_type in ('application/json','text/html','application/octet-stream','text/plain','text/markdown'));

commit;
