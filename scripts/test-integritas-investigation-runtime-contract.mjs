import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const migration = readFileSync('supabase/migrations/0006_integritas_investigation_persistence.sql', 'utf8');
const rollback = readFileSync('supabase/rollback/0006_integritas_investigation_persistence.rollback.sql', 'utf8');
const edge = readFileSync('supabase/functions/integritas-control/index.ts', 'utf8');

assert.match(migration, /create table public\.integritas_case_job_checkpoints/, 'checkpoint table is required');
assert.match(migration, /create table public\.integritas_case_job_outputs/, 'output metadata table is required');
assert.match(migration, /integritas_investigation_manifest_context/, 'manifest context RPC is required');
assert.match(migration, /integritas_checkpoint_case_investigation/, 'checkpoint RPC is required');
assert.match(migration, /integritas_register_case_job_output/, 'output registration RPC is required');
assert.match(migration, /lease_owner = p_worker_id/, 'worker lease ownership must be enforced');
assert.match(migration, /c\.revision = j\.case_revision/, 'current case revision must be enforced');
assert.ok(!migration.includes('signed_url'), 'signed URLs must never be persisted');
assert.match(rollback, /drop table public\.integritas_case_job_outputs/, 'rollback must remove output metadata');
assert.match(rollback, /drop table public\.integritas_case_job_checkpoints/, 'rollback must remove checkpoints');

const fixture = readFileSync('supabase/tests/fixtures/integritas_rls_fixture.sql', 'utf8');
assert.match(fixture, /create table public\.integritas_documents \(/, 'CI fixture must model document metadata explicitly');
for (const required of ['name text', 'mime_type text', 'size_bytes bigint', 'sha256 text', 'storage_path text', 'extraction_status text', 'created_at timestamptz']) {
  assert.ok(fixture.includes(required), `CI document fixture missing ${required}`);
}
for (const required of ['title text', 'purpose text', 'authorized_scope text', 'intended_subjects text', 'jurisdictions text[]']) {
  assert.ok(fixture.includes(required), `CI case fixture missing ${required}`);
}
assert.ok(fixture.includes('updated_at timestamptz'), 'CI job fixture must support checkpoint timestamps');
assert.match(migration, /terminal investigation stage is immutable/, 'terminal investigation stages must not resume through checkpoint updates');
