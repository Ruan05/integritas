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
  create table public.integritas_cases (id uuid primary key, created_by text);

  foreach t in array array[
    'integritas_case_jobs','integritas_documents','integritas_entities',
    'integritas_checks','integritas_findings','integritas_relationships',
    'integritas_reports','integritas_sources','integritas_tool_invocations',
    'integritas_audit_events'
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
