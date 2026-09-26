import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const migration = readFileSync('supabase/migrations/0010_integritas_investigation_recovery.sql', 'utf8');
const rollback = readFileSync('supabase/rollback/0010_integritas_investigation_recovery.rollback.sql', 'utf8');
const edge = readFileSync('supabase/functions/integritas-control/index.ts', 'utf8');
const client = readFileSync('infra/openclaw/control-worker/src/client.mjs', 'utf8');
const worker = readFileSync('infra/openclaw/control-worker/src/investigation.mjs', 'utf8');
const loop = readFileSync('infra/openclaw/control-worker/src/index.mjs', 'utf8');
const polkit = readFileSync('infra/openclaw/49-integritas-openclaw-control.rules', 'utf8');

for (const fn of [
  'integritas_investigation_job_state',
  'integritas_cancel_case_investigation',
  'integritas_retry_case_investigation',
  'integritas_acknowledge_case_investigation_cancel',
]) assert.match(migration, new RegExp(fn), `recovery migration must define ${fn}`);

assert.match(migration, /cancel_requested/, 'recovery state must expose cancellation');
assert.match(migration, /case revision is stale/, 'retry must reject stale case revisions');
assert.match(migration, /status = 'queued'/, 'retry must requeue the same control command');
assert.match(migration, /lease_expires_at = null/, 'retry must clear stale lease state');
assert.match(migration, /stage not in \('completed','incomplete','failed','cancelled','research_limit_reached'\)/, 'retry must resume from a non-terminal checkpoint');
assert.match(rollback, /drop function if exists public\.integritas_retry_case_investigation/, 'rollback must remove retry wrapper');

for (const action of ['worker_job_state', 'worker_cancel_ack', 'cancel_case_investigation', 'retry_case_investigation']) {
  assert.match(edge, new RegExp(`action === '${action}'`), `Edge Function must expose bounded ${action}`);
}
assert.match(client, /jobState\(/, 'worker client must query durable job state');
assert.match(client, /acknowledgeCancel\(/, 'worker client must acknowledge cancellation');
assert.match(worker, /job_progress/, 'worker must honor durable progress');
assert.match(worker, /cancel_requested/, 'worker must honor cancellation state');
assert.match(loop, /result\?\.cancelled/, 'control loop must not complete an acknowledged cancelled command');

assert.match(polkit, /verb === "stop"/, 'polkit must allow bounded investigation stop');
assert.doesNotMatch(polkit, /unit === "openclaw-gateway\.service" && \(verb === "restart" \|\| verb === "stop"\)/, 'gateway stop must remain forbidden');

console.log('Integritas investigation recovery contract checks passed');
