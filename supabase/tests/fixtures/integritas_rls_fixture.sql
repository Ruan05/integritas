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
    name text not null,
    mime_type text not null,
    size_bytes bigint not null,
    sha256 text not null,
    storage_path text not null,
    extraction_status text not null default 'pending',
    created_at timestamptz not null default now()
  );

  foreach t in array array[
    'integritas_entities','integritas_checks','integritas_findings',
    'integritas_relationships','integritas_reports','integritas_sources',
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
