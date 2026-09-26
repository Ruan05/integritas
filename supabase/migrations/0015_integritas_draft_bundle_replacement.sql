begin;

-- Permit a retry to atomically replace a still-draft investigation bundle for the
-- same leased case/job/revision. Reviewed/finalized reports remain immutable.
CREATE OR REPLACE FUNCTION integritas_private.integritas_commit_investigation_bundle(p_command_id uuid, p_worker_id text, p_case_job_id uuid, p_case_revision integer, p_bundle_sha256 text, p_report_sha256 text, p_bundle jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_job public.integritas_case_jobs;
  v_command public.integritas_control_commands;
  v_case public.integritas_cases;
  v_row jsonb;
  v_key text;
  v_entity_id uuid;
  v_from_id uuid;
  v_to_id uuid;
  v_source_id uuid;
  v_finding_id uuid;
  v_existing_report public.integritas_reports;
  v_report public.integritas_reports;
  v_limitations text;
  v_count_entities integer := 0;
  v_count_relationships integer := 0;
  v_count_sources integer := 0;
  v_count_findings integer := 0;
  v_count_checks integer := 0;
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 or length(p_worker_id) > 200 then raise exception 'invalid worker id'; end if;
  if p_bundle_sha256 !~ '^[0-9a-f]{64}$' or p_report_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'invalid investigation commit digest'; end if;
  if p_bundle is null or jsonb_typeof(p_bundle) <> 'object' or octet_length(p_bundle::text) > 5242880 then raise exception 'invalid investigation bundle'; end if;
  if p_bundle::text like '%/storage/v1/object/sign/%' then raise exception 'signed URL leaked into investigation bundle'; end if;

  select j.* into v_job
  from public.integritas_case_jobs j
  join public.integritas_control_commands cmd on cmd.id = j.control_command_id
  join public.integritas_cases c on c.id = j.case_id
  where j.id = p_case_job_id and j.case_revision = p_case_revision
    and j.runtime_provider = 'openclaw-oracle'
    and cmd.id = p_command_id and cmd.command_type = 'run_case_investigation'
    and cmd.lease_owner = p_worker_id and cmd.status in ('leased','running')
    and c.revision = j.case_revision
  for update of j;
  if not found then raise exception 'investigation bundle access denied'; end if;
  select * into v_command from public.integritas_control_commands where id = p_command_id for update;
  select * into v_case from public.integritas_cases where id = v_job.case_id for update;

  if coalesce((p_bundle->>'schema_version')::integer, 0) <> 1
    or p_bundle->>'case_id' <> v_job.case_id::text
    or p_bundle->>'case_job_id' <> v_job.id::text
    or coalesce((p_bundle->>'case_revision')::integer, -1) <> v_job.case_revision
    or p_bundle->>'depth' <> v_job.depth then
    raise exception 'investigation bundle identity mismatch';
  end if;
  if p_bundle#>>'{report,status}' <> 'draft' then raise exception 'investigation report must be draft'; end if;
  if not exists (select 1 from public.integritas_case_job_outputs o where o.case_job_id=v_job.id and o.case_revision=v_job.case_revision and o.output_type='bundle' and o.sha256=p_bundle_sha256) then
    raise exception 'registered bundle output required';
  end if;
  if not exists (select 1 from public.integritas_case_job_outputs o where o.case_job_id=v_job.id and o.case_revision=v_job.case_revision and o.output_type='report_markdown' and o.sha256=p_report_sha256) then
    raise exception 'registered report output required';
  end if;
  select * into v_existing_report from public.integritas_reports r
    where r.case_job_id=v_job.id and r.report_key='draft-report' for update;
  if found and v_existing_report.status <> 'draft' then raise exception 'investigation report is no longer draft'; end if;
  if found and (v_existing_report.bundle_sha256 <> p_bundle_sha256 or v_existing_report.report_sha256 <> p_report_sha256) then
    -- Retry replacement is allowed only while the report is still draft, for the
    -- same leased case/job/revision. Clear prior materialized rows inside this
    -- transaction so keys removed from the new bundle cannot survive as stale data.
    delete from public.integritas_finding_source_links where case_job_id = v_job.id;
    delete from public.integritas_relationships where case_job_id = v_job.id;
    delete from public.integritas_checks where case_job_id = v_job.id;
    delete from public.integritas_findings where case_job_id = v_job.id;
    delete from public.integritas_sources where case_job_id = v_job.id;
    delete from public.integritas_entities where case_job_id = v_job.id;
  end if;

  for v_row in select value from jsonb_array_elements(coalesce(p_bundle->'entities','[]'::jsonb)) loop
    v_key := v_row->>'entity_key';
    insert into public.integritas_entities(case_id,case_job_id,case_revision,entity_key,entity_type,display_name,aliases,identifiers,match_status,match_confidence,updated_at)
    values(v_job.case_id,v_job.id,v_job.case_revision,v_key,v_row->>'entity_type',v_row->>'display_name',
      coalesce(array(select jsonb_array_elements_text(coalesce(v_row->'aliases','[]'::jsonb))),array[]::text[]),
      coalesce(v_row->'identifiers','{}'::jsonb),v_row->>'match_status',(v_row->>'confidence')::numeric,now())
    on conflict (case_job_id,entity_key) where case_job_id is not null and entity_key is not null do update set
      entity_type=excluded.entity_type,display_name=excluded.display_name,aliases=excluded.aliases,identifiers=excluded.identifiers,
      match_status=excluded.match_status,match_confidence=excluded.match_confidence,case_revision=excluded.case_revision,updated_at=now();
    v_count_entities := v_count_entities + 1;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_bundle->'sources','[]'::jsonb)) loop
    v_key := v_row->>'source_key';
    insert into public.integritas_sources(case_id,case_job_id,case_revision,source_key,finding_id,source_type,title,url,document_id,page_reference,excerpt,reliability_note,retrieved_at,evidence_origin)
    values(v_job.case_id,v_job.id,v_job.case_revision,v_key,null,v_row->>'source_type',v_row->>'title',nullif(v_row->>'url',''),
      nullif(v_row->>'document_id','')::uuid,nullif(v_row->>'page_reference',''),coalesce(v_row->>'excerpt',''),coalesce(v_row->>'reliability_note',''),
      (v_row->>'retrieved_at')::timestamptz,v_row->>'evidence_origin')
    on conflict (case_job_id,source_key) where case_job_id is not null and source_key is not null do update set
      source_type=excluded.source_type,title=excluded.title,url=excluded.url,document_id=excluded.document_id,page_reference=excluded.page_reference,
      excerpt=excluded.excerpt,reliability_note=excluded.reliability_note,retrieved_at=excluded.retrieved_at,evidence_origin=excluded.evidence_origin,case_revision=excluded.case_revision;
    v_count_sources := v_count_sources + 1;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_bundle->'findings','[]'::jsonb)) loop
    v_entity_id := null;
    if nullif(v_row->>'entity_key','') is not null then
      select id into v_entity_id from public.integritas_entities where case_job_id=v_job.id and entity_key=v_row->>'entity_key';
      if not found then raise exception 'investigation bundle references unknown entity key'; end if;
    end if;
    v_key := v_row->>'finding_key';
    insert into public.integritas_findings(case_id,entity_id,case_job_id,case_revision,finding_key,finding_type,claim,evidence_status,materiality,evidence_excerpt,reliability,updated_at)
    values(v_job.case_id,v_entity_id,v_job.id,v_job.case_revision,v_key,v_row->>'finding_type',v_row->>'claim',v_row->>'evidence_status',v_row->>'materiality',coalesce(v_row->>'evidence_excerpt',''),v_row->>'reliability',now())
    on conflict (case_job_id,finding_key) where case_job_id is not null and finding_key is not null do update set
      entity_id=excluded.entity_id,finding_type=excluded.finding_type,claim=excluded.claim,evidence_status=excluded.evidence_status,
      materiality=excluded.materiality,evidence_excerpt=excluded.evidence_excerpt,reliability=excluded.reliability,case_revision=excluded.case_revision,updated_at=now();
    select id into v_finding_id from public.integritas_findings where case_job_id=v_job.id and finding_key=v_key;
    for v_key in select jsonb_array_elements_text(coalesce(v_row->'source_keys','[]'::jsonb)) loop
      select id into v_source_id from public.integritas_sources where case_job_id=v_job.id and source_key=v_key;
      if not found then raise exception 'investigation bundle references unknown source key'; end if;
      insert into public.integritas_finding_source_links(case_id,case_job_id,finding_id,source_id)
      values(v_job.case_id,v_job.id,v_finding_id,v_source_id) on conflict do nothing;
    end loop;
    v_count_findings := v_count_findings + 1;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_bundle->'relationships','[]'::jsonb)) loop
    select id into v_from_id from public.integritas_entities where case_job_id=v_job.id and entity_key=v_row->>'from_entity_key';
    if not found then raise exception 'investigation relationship references unknown entity key'; end if;
    select id into v_to_id from public.integritas_entities where case_job_id=v_job.id and entity_key=v_row->>'to_entity_key';
    if not found then raise exception 'investigation relationship references unknown entity key'; end if;
    v_source_id := null;
    if jsonb_array_length(coalesce(v_row->'source_keys','[]'::jsonb)) > 0 then
      select id into v_source_id from public.integritas_sources where case_job_id=v_job.id and source_key=(v_row->'source_keys'->>0);
      if not found then raise exception 'investigation relationship references unknown source key'; end if;
    end if;
    v_key := v_row->>'relationship_key';
    insert into public.integritas_relationships(case_id,case_job_id,case_revision,relationship_key,from_entity_id,to_entity_id,relationship_type,claim,evidence_status,source_id,confidence)
    values(v_job.case_id,v_job.id,v_job.case_revision,v_key,v_from_id,v_to_id,v_row->>'relationship_type',coalesce(v_row->>'claim',''),v_row->>'evidence_status',v_source_id,(v_row->>'confidence')::numeric)
    on conflict (case_job_id,relationship_key) where case_job_id is not null and relationship_key is not null do update set
      from_entity_id=excluded.from_entity_id,to_entity_id=excluded.to_entity_id,relationship_type=excluded.relationship_type,claim=excluded.claim,
      evidence_status=excluded.evidence_status,source_id=excluded.source_id,confidence=excluded.confidence,case_revision=excluded.case_revision;
    v_count_relationships := v_count_relationships + 1;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_bundle->'checks','[]'::jsonb)) loop
    v_entity_id := null;
    if nullif(v_row->>'entity_key','') is not null then
      select id into v_entity_id from public.integritas_entities where case_job_id=v_job.id and entity_key=v_row->>'entity_key';
      if not found then raise exception 'investigation check references unknown entity key'; end if;
    end if;
    v_key := v_row->>'check_key';
    insert into public.integritas_checks(case_id,entity_id,case_job_id,case_revision,check_key,check_type,description,priority,required_source,status,outcome,related_job_id,updated_at)
    values(v_job.case_id,v_entity_id,v_job.id,v_job.case_revision,v_key,v_row->>'check_type',v_row->>'description',v_row->>'priority',coalesce(v_row->>'required_source',''),v_row->>'status',coalesce(v_row->>'outcome',''),v_job.id,now())
    on conflict (case_job_id,check_key) where case_job_id is not null and check_key is not null do update set
      entity_id=excluded.entity_id,check_type=excluded.check_type,description=excluded.description,priority=excluded.priority,
      required_source=excluded.required_source,status=excluded.status,outcome=excluded.outcome,related_job_id=excluded.related_job_id,case_revision=excluded.case_revision,updated_at=now();
    v_count_checks := v_count_checks + 1;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_bundle->'contradictions','[]'::jsonb)) loop
    v_key := 'contradiction:' || (v_row->>'contradiction_key');
    insert into public.integritas_findings(case_id,case_job_id,case_revision,finding_key,finding_type,claim,evidence_status,materiality,evidence_excerpt,reliability,analyst_note,updated_at)
    values(v_job.case_id,v_job.id,v_job.case_revision,v_key,'contradiction',v_row->>'description','conflicting','medium','','unknown',coalesce((v_row->'finding_keys')::text,'[]'),now())
    on conflict (case_job_id,finding_key) where case_job_id is not null and finding_key is not null do update set
      claim=excluded.claim,analyst_note=excluded.analyst_note,case_revision=excluded.case_revision,updated_at=now();
    select id into v_finding_id from public.integritas_findings where case_job_id=v_job.id and finding_key=v_key;
    for v_key in
      select distinct jsonb_array_elements_text(coalesce(f.value->'source_keys','[]'::jsonb))
      from jsonb_array_elements(coalesce(p_bundle->'findings','[]'::jsonb)) f(value)
      where f.value->>'finding_key' in (select jsonb_array_elements_text(coalesce(v_row->'finding_keys','[]'::jsonb)))
    loop
      select id into v_source_id from public.integritas_sources where case_job_id=v_job.id and source_key=v_key;
      if found then
        insert into public.integritas_finding_source_links(case_id,case_job_id,finding_id,source_id)
        values(v_job.case_id,v_job.id,v_finding_id,v_source_id) on conflict do nothing;
      end if;
    end loop;
    v_count_findings := v_count_findings + 1;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_bundle->'unresolved_checks','[]'::jsonb)) loop
    v_key := 'unresolved:' || (v_row->>'unresolved_key');
    insert into public.integritas_checks(case_id,case_job_id,case_revision,check_key,check_type,description,priority,required_source,status,outcome,related_job_id,updated_at)
    values(v_job.case_id,v_job.id,v_job.case_revision,v_key,'unresolved',v_row->>'description','high','manual follow-up','blocked',
      concat_ws(E'\n','Reason: '||coalesce(v_row->>'reason',''),'Blocker: '||coalesce(v_row->>'blocker',''),'Next: '||coalesce(v_row->>'next_manual_action','')),v_job.id,now())
    on conflict (case_job_id,check_key) where case_job_id is not null and check_key is not null do update set
      description=excluded.description,status=excluded.status,outcome=excluded.outcome,case_revision=excluded.case_revision,updated_at=now();
    v_count_checks := v_count_checks + 1;
  end loop;

  select coalesce(string_agg(value, E'\n' order by ordinality), '') into v_limitations
  from jsonb_array_elements_text(coalesce(p_bundle->'limitations','[]'::jsonb)) with ordinality t(value, ordinality);
  insert into public.integritas_reports(case_id,case_job_id,report_key,based_on_revision,status,summary,content_markdown,limitations,bundle_sha256,report_sha256,updated_at)
  values(v_job.case_id,v_job.id,'draft-report',v_job.case_revision,'draft',coalesce(p_bundle#>>'{report,summary}',''),p_bundle#>>'{report,markdown}',v_limitations,p_bundle_sha256,p_report_sha256,now())
  on conflict (case_job_id,report_key) where case_job_id is not null and report_key is not null do update set
    based_on_revision=excluded.based_on_revision,summary=excluded.summary,content_markdown=excluded.content_markdown,limitations=excluded.limitations,
    bundle_sha256=excluded.bundle_sha256,report_sha256=excluded.report_sha256,updated_at=now()
  returning * into v_report;

  insert into public.integritas_control_audit(command_id,event_type,actor_type,actor_id,metadata)
  values(p_command_id,'investigation_bundle_committed','worker',p_worker_id,
    jsonb_build_object('case_job_id',v_job.id,'case_revision',v_job.case_revision,'bundle_sha256',p_bundle_sha256,'report_sha256',p_report_sha256,
      'entities',v_count_entities,'relationships',v_count_relationships,'sources',v_count_sources,'findings',v_count_findings,'checks',v_count_checks));

  return jsonb_build_object('case_job_id',v_job.id,'case_revision',v_job.case_revision,'report_id',v_report.id,'report_status',v_report.status,
    'entities',v_count_entities,'relationships',v_count_relationships,'sources',v_count_sources,'findings',v_count_findings,'checks',v_count_checks);
end;
$function$;


commit;
