begin;

do $$
begin
  if exists (select 1 from public.integritas_case_job_outputs) then
    raise exception 'rollback blocked: investigation outputs exist';
  end if;
  if exists (select 1 from public.integritas_case_job_checkpoints) then
    raise exception 'rollback blocked: investigation checkpoints exist';
  end if;
end;
$$;

drop function if exists public.integritas_register_case_job_output(uuid,text,uuid,integer,text,text,text,text,bigint,jsonb);
drop function if exists integritas_private.integritas_register_case_job_output(uuid,text,uuid,integer,text,text,text,text,bigint,jsonb);
drop function if exists public.integritas_checkpoint_case_investigation(uuid,text,uuid,integer,text,integer,jsonb);
drop function if exists integritas_private.integritas_checkpoint_case_investigation(uuid,text,uuid,integer,text,integer,jsonb);
drop function if exists public.integritas_investigation_manifest_context(uuid,text,uuid);
drop function if exists integritas_private.integritas_investigation_manifest_context(uuid,text,uuid);

drop table public.integritas_case_job_outputs;
drop table public.integritas_case_job_checkpoints;

commit;
