import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const runtimeMigration = readFileSync('supabase/migrations/0005_integritas_openclaw_investigation_runtime.sql', 'utf8');
const runtimeRollback = readFileSync('supabase/rollback/0005_integritas_openclaw_investigation_runtime.rollback.sql', 'utf8');
const bundleMigration = readFileSync('supabase/migrations/0009_integritas_investigation_bundle_commit.sql', 'utf8');
const bundleRollback = readFileSync('supabase/rollback/0009_integritas_investigation_bundle_commit.rollback.sql', 'utf8');
const bundleTest = readFileSync('supabase/tests/0012_integritas_investigation_bundle_commit.sql', 'utf8');
const recoveryMigration = readFileSync('supabase/migrations/0010_integritas_investigation_recovery.sql', 'utf8');
const recoveryRollback = readFileSync('supabase/rollback/0010_integritas_investigation_recovery.rollback.sql', 'utf8');
const recoveryTest = readFileSync('supabase/tests/0013_integritas_investigation_recovery.sql', 'utf8');
const fixture = readFileSync('supabase/tests/fixtures/integritas_rls_fixture.sql', 'utf8');

assert.match(runtimeMigration, /drop constraint integritas_case_jobs_job_kind_check/, 'migration must replace the legacy job-kind constraint');
assert.match(runtimeMigration, /'investigation'/, 'OpenClaw investigation must be an allowed job kind');
assert.match(runtimeRollback, /integritas_case_jobs_job_kind_check/, 'rollback must restore the legacy job-kind constraint');
assert.match(fixture, /constraint integritas_case_jobs_job_kind_check/, 'CI fixture must model the production job-kind constraint');

assert.match(bundleMigration, /integritas_commit_investigation_bundle/, 'bundle migration must define the atomic commit RPC');
assert.match(bundleMigration, /integritas_finding_source_links/, 'bundle migration must add many-to-many source lineage');
assert.match(bundleMigration, /report_markdown/, 'bundle migration must support canonical Markdown output');
assert.match(bundleMigration, /revoke all on function public\.integritas_commit_investigation_bundle/, 'bundle commit RPC must deny browser execution');
assert.match(bundleRollback, /drop function if exists public\.integritas_commit_investigation_bundle/, 'bundle rollback must remove the commit RPC');
assert.match(bundleRollback, /report_html/, 'bundle rollback must restore legacy output constraints');
assert.match(bundleTest, /same-name entities stay distinct|same-name entities/i, 'database test must cover same-name entity separation');
assert.match(bundleTest, /idempotent|replay/i, 'database test must cover replay idempotency');
assert.match(bundleTest, /finalized|draft/i, 'database test must enforce draft-only reports');

assert.match(recoveryMigration, /'job_stage'/, 'manifest must expose durable job stage');
assert.match(recoveryMigration, /'job_progress'/, 'manifest must expose durable job progress');
assert.match(recoveryMigration, /'cancel_requested'/, 'manifest must expose cancellation state');
assert.match(recoveryMigration, /integritas_investigation_job_state/, 'recovery migration must expose bounded worker job state');
assert.match(recoveryMigration, /integritas_retry_case_investigation/, 'recovery migration must define failed-job retry');
assert.match(recoveryMigration, /integritas_cancel_case_investigation/, 'recovery migration must define admin cancellation');
assert.match(recoveryMigration, /integritas_acknowledge_case_investigation_cancel/, 'recovery migration must define worker cancellation acknowledgement');
assert.match(recoveryRollback, /drop function if exists public\.integritas_retry_case_investigation/, 'recovery rollback must remove retry RPC');
assert.match(recoveryTest, /stale|revision/i, 'recovery database test must cover stale revision rejection');
assert.match(recoveryTest, /retry/i, 'recovery database test must cover retry');
assert.match(recoveryTest, /cancel/i, 'recovery database test must cover cancellation');

console.log('Integritas OpenClaw migration contract checks passed');
