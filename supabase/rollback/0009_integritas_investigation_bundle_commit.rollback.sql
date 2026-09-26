begin;

do $$ begin
  if exists (select 1 from public.integritas_sources where finding_id is null) then
    raise exception 'cannot rollback bundle commit migration while source rows without legacy finding links exist';
  end if;
end $$;

drop function if exists public.integritas_commit_investigation_bundle(uuid,text,uuid,integer,text,text,jsonb);
drop function if exists integritas_private.integritas_commit_investigation_bundle(uuid,text,uuid,integer,text,text,jsonb);

drop table if exists public.integritas_finding_source_links;

drop index if exists public.integritas_reports_job_key;
drop index if exists public.integritas_checks_job_key;
drop index if exists public.integritas_sources_job_key;
drop index if exists public.integritas_findings_job_key;
drop index if exists public.integritas_relationships_job_key;
drop index if exists public.integritas_entities_job_key;

alter table public.integritas_reports
  drop constraint if exists integritas_reports_report_key_check,
  drop constraint if exists integritas_reports_bundle_sha256_check,
  drop constraint if exists integritas_reports_report_sha256_check,
  drop column if exists updated_at,
  drop column if exists report_sha256,
  drop column if exists bundle_sha256,
  drop column if exists report_key,
  drop column if exists case_job_id;
alter table public.integritas_checks
  drop constraint if exists integritas_checks_case_revision_check,
  drop constraint if exists integritas_checks_check_key_check,
  drop column if exists check_key,
  drop column if exists case_revision,
  drop column if exists case_job_id;
alter table public.integritas_sources
  drop constraint if exists integritas_sources_case_revision_check,
  drop constraint if exists integritas_sources_source_key_check,
  drop column if exists source_key,
  drop column if exists case_revision,
  drop column if exists case_job_id,
  alter column finding_id set not null;
alter table public.integritas_findings
  drop constraint if exists integritas_findings_finding_key_check,
  drop column if exists finding_key;
alter table public.integritas_relationships
  drop constraint if exists integritas_relationships_case_revision_check,
  drop constraint if exists integritas_relationships_relationship_key_check,
  drop constraint if exists integritas_relationships_confidence_check,
  drop column if exists confidence,
  drop column if exists relationship_key,
  drop column if exists case_revision,
  drop column if exists case_job_id;
alter table public.integritas_entities
  drop constraint if exists integritas_entities_case_revision_check,
  drop constraint if exists integritas_entities_entity_key_check,
  drop column if exists entity_key,
  drop column if exists case_revision,
  drop column if exists case_job_id;

alter table public.integritas_case_job_outputs
  drop constraint if exists integritas_case_job_outputs_output_type_check,
  drop constraint if exists integritas_case_job_outputs_content_type_check;
alter table public.integritas_case_job_outputs
  add constraint integritas_case_job_outputs_output_type_check
    check (output_type in ('bundle','report_html','evidence','execution_log')),
  add constraint integritas_case_job_outputs_content_type_check
    check (content_type in ('application/json','text/html','application/octet-stream','text/plain'));

commit;
