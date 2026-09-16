import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync('supabase/functions/integritas-control/index.ts', 'utf8');
const leaseSource = readFileSync('supabase/functions/integritas-control/lease.ts', 'utf8');

assert.match(source, /x-integritas-worker-token/, 'worker token header must be implemented');
assert.match(source, /x-integritas-worker-id/, 'worker id header must be required for scoped worker authentication');
assert.match(source, /integritas_control_worker_credentials/, 'worker credentials must be validated against the production credential table');
assert.match(source, /x-integritas-connector-token/, 'connector token header must be implemented');
assert.match(source, /integritas_admin_users/, 'admin membership must be checked server-side');
assert.match(source, /idempotency-key/, 'enqueue must require an idempotency key');
assert.match(source, /integritas_control_enqueue/, 'enqueue must use the bounded database RPC');
assert.match(source, /integritas_control_lease/, 'worker lease must use the atomic database RPC');
assert.match(leaseSource, /Array\.isArray\(data\)/, 'lease response must normalize PostgREST array-shaped RPC results');
assert.match(leaseSource, /data\[0\] \?\? null/, 'empty lease arrays must become null rather than a truthy empty command');
assert.match(leaseSource, /Object\.values\(record\)\.every/, 'all-null composite rows must normalize to an empty queue');
assert.match(source, /CONNECTOR_COMMANDS = new Set\(\[/, 'connector command allowlist must be explicit');
assert.match(source, /CASE_INVESTIGATION_COMMANDS = new Set\(\['run_case_investigation'\]\)/, 'case investigation command must be fixed and allowlisted');
assert.match(source, /action === 'start_case_investigation'/, 'admin case-investigation start action must be exposed');
assert.match(source, /principal\.kind !== 'admin'/, 'case investigation start must require an authenticated admin');
assert.match(source, /from\('integritas_case_access'\)/, 'case investigation start must check explicit case access');
assert.match(source, /integritas_start_case_investigation/, 'case investigation start must use the bounded start RPC');
assert.match(source, /p_case_id: caseId/, 'case investigation RPC must bind the requested case ID');
assert.match(source, /p_case_revision: caseRevision/, 'case investigation RPC must bind the requested case revision');
assert.match(source, /p_depth: depth/, 'case investigation RPC must bind the bounded depth');
assert.match(source, /action === 'worker_manifest'/, 'worker manifest action must be explicit');
assert.match(source, /integritas_investigation_manifest_context/, 'manifest action must use server-verified job context');
assert.match(source, /createSignedUrls/, 'manifest action must create short-lived signed URLs server-side');
assert.match(source, /action === 'worker_checkpoint'/, 'worker checkpoint action must be explicit');
assert.match(source, /integritas_checkpoint_case_investigation/, 'checkpoint action must use a bounded database RPC');
assert.match(source, /action === 'worker_publish_output'/, 'worker output publishing must be explicit');
assert.match(source, /integritas_register_case_job_output/, 'published outputs must be registered through a bounded database RPC');
assert.match(source, /integritas-case-files/, 'investigation artifacts must remain in the private case-files bucket');

for (const dangerous of [
  "'exec_shell'",
  "'read_environment'",
  "'read_secret'",
  "'plugin_install'",
  "'send_email'",
  "'delete_evidence'",
  "'payment'",
]) {
  assert.ok(!source.includes(dangerous), `dangerous connector action ${dangerous} must not be implemented`);
}

assert.ok(!source.includes("'access-control-allow-origin': '*'"), 'CORS must not allow wildcard origins');
assert.ok(!source.includes('Deno.Command'), 'Edge Function must not execute operating-system commands');
assert.ok(!source.includes('child_process'), 'Edge Function must not gain local process execution');

console.log('Integritas control Edge Function contract checks passed');
