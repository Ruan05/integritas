import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const migration = readFileSync('supabase/migrations/0005_integritas_openclaw_investigation_runtime.sql', 'utf8');
const rollback = readFileSync('supabase/rollback/0005_integritas_openclaw_investigation_runtime.rollback.sql', 'utf8');
const fixture = readFileSync('supabase/tests/fixtures/integritas_rls_fixture.sql', 'utf8');

assert.match(migration, /drop constraint integritas_case_jobs_job_kind_check/, 'migration must replace the legacy job-kind constraint');
assert.match(migration, /'investigation'/, 'OpenClaw investigation must be an allowed job kind');
assert.match(rollback, /integritas_case_jobs_job_kind_check/, 'rollback must restore the legacy job-kind constraint');
assert.match(fixture, /constraint integritas_case_jobs_job_kind_check/, 'CI fixture must model the production job-kind constraint');

console.log('Integritas OpenClaw migration contract checks passed');
