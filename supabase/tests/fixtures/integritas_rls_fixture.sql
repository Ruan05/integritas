\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

do $$
declare
  t text;
begin
  create table public.integritas_admin_users (user_id uuid primary key);
  create table public.integritas_case_access (case_id uuid, user_id uuid, role text);
  create table public.integritas_cases (
    id uuid primary key,
    title text not null default 'Fixture case',
    purpose text not null default 'Fixture purpose',
    authorized_scope text not null default 'Fixture scope',
    created_by text,
    intended_subjects text not null default '',
    jurisdictions text[] not null default '{}'
  );
  create table public.integritas_documents (
    id uuid primary key,
    case_id uuid not null,
    name text not null default 'Fixture document',
    mime_type text not null default 'application/octet-stream',
    size_bytes bigint not null default 0,
    sha256 text not null default repeat('0', 64),
    storage_path text not null default 'fixture/path',
    extraction_status text not null default 'pending',
    created_at timestamptz not null default now()
  );

  foreach t in array array[
    'integritas_tool_invocations','integritas_audit_events'
  ] loop
    execute format('create table public.%I (id uuid primary key, case_id uuid)', t);
  end loop;

  create table public.integritas_agent_threads (
    id uuid primary key, case_id uuid, created_by uuid
  );
  create table public.integritas_agent_messages (
    id uuid primary key, thread_id uuid
  );
  create table public.integritas_change_sets (
    id uuid primary key, requested_by uuid, case_id uuid
  );
  create table public.integritas_repositories (
    id uuid primary key, requested_by uuid
  );
  create table public.integritas_agent_lessons (id uuid primary key);
  create table public.integritas_deploy_jobs (id uuid primary key, token_hash text);
  create table public.integritas_e2e_runs (id uuid primary key, token_hash text);
  create table public.mcp_allowed_email_hashes (email_sha256 text primary key);
  create table public.opencode_efficiency_test (id uuid primary key);
  create table public.opencode_jobs (id uuid primary key);
  create table public.integritas_case_jobs (
    id uuid primary key,
    case_id uuid not null,
    opencode_job_id uuid not null unique,
    job_kind text not null default 'research',
    constraint integritas_case_jobs_job_kind_check
      check (job_kind in ('extract','research','chat','review','verify')),
    case_revision integer not null default 0,
    requested_question text not null default '',
    depth text not null default 'standard',
    stage text not null default 'queued',
    progress integer not null default 0,
    branch_count integer not null default 1,
    unresolved integer not null default 0,
    cancel_requested boolean not null default false,
    updated_at timestamptz not null default now()
  );
  create table public.integritas_entities (
    id uuid primary key default gen_random_uuid(), case_id uuid not null,
    entity_type text not null, display_name text not null, identifiers jsonb not null default '{}'::jsonb,
    match_status text not null default 'proposed', match_confidence numeric, aliases text[] not null default '{}',
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  );
  create table public.integritas_findings (
    id uuid primary key default gen_random_uuid(), case_id uuid not null, entity_id uuid, case_job_id uuid,
    finding_type text not null, claim text not null, evidence_status text not null, materiality text not null default 'informational',
    analyst_note text not null default '', evidence_excerpt text not null default '', reliability text not null default 'unknown',
    case_revision integer not null default 0, reviewed_at timestamptz, reviewed_by uuid,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  );
  create table public.integritas_sources (
    id uuid primary key default gen_random_uuid(), case_id uuid not null, finding_id uuid not null,
    source_type text not null, title text not null, url text, document_id uuid, page_reference text, excerpt text not null default '',
    reliability_note text not null default '', retrieved_at timestamptz not null default now(),
    evidence_origin text not null default 'submitted_document', tool_invocation_id uuid
  );
  create table public.integritas_relationships (
    id uuid primary key default gen_random_uuid(), case_id uuid not null, from_entity_id uuid not null, to_entity_id uuid not null,
    relationship_type text not null, claim text not null default '', evidence_status text not null default 'uncertain', source_id uuid,
    created_at timestamptz not null default now()
  );
  create table public.integritas_checks (
    id uuid primary key default gen_random_uuid(), case_id uuid not null, entity_id uuid, check_type text not null,
    description text not null, status text not null default 'open', outcome text not null default '', priority text not null default 'medium',
    required_source text not null default '', related_job_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  );
  create table public.integritas_reports (
    id uuid primary key default gen_random_uuid(), case_id uuid not null, based_on_revision integer not null, status text not null default 'draft',
    summary text not null default '', content_markdown text not null default '', limitations text not null default '',
    reviewed_at timestamptz, finalized_at timestamptz, reviewed_by uuid, finalized_by uuid, created_at timestamptz not null default now()
  );
  create table public.opencode_runs (id uuid primary key);
  create table public.opencode_selftest (id uuid primary key);
  create table public.opencode_sessions (id uuid primary key);
end;
$$;

do $$
declare
  t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
      and (tablename like 'integritas_%' or tablename like 'opencode_%' or tablename = 'mcp_allowed_email_hashes')
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant all on table public.%I to anon, authenticated, service_role', t);
  end loop;
end;
$$;
