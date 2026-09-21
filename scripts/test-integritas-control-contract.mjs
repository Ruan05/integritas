import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync('supabase/functions/integritas-control/index.ts', 'utf8');
const leaseSource = readFileSync('supabase/functions/integritas-control/lease.ts', 'utf8');
const runtimeContractSource = readFileSync('supabase/functions/_shared/investigation-runtime-contract.ts', 'utf8');
const e2eSelftestSource = readFileSync('supabase/functions/integritas-e2e-selftest/index.ts', 'utf8');

assert.match(source, /x-integritas-worker-token/, 'worker token header must be implemented');
assert.match(source, /x-integritas-worker-id/, 'worker id header must be required for scoped worker authentication');
assert.match(source, /integritas_control_worker_credentials/, 'worker credentials must be validated against the production credential table');
assert.match(source, /x-integritas-connector-token/, 'connector token header must be implemented');
assert.match(source, /x-integritas-crm-token/, 'CRM site token header must be preserved for live password login');
assert.match(source, /CRM_BACKEND_TOKEN_SHA256/, 'CRM site token must be verified by stored SHA-256 digest');
assert.match(source, /actor:\s*'crm-site'/, 'CRM site authentication must retain its bounded actor identity');
assert.match(source, /userId:\s*CRM_USER_ID/, 'CRM site authentication must map to the authorized admin identity');
assert.ok(
  source.indexOf("req.headers.get('x-integritas-crm-token')") < source.indexOf("req.headers.get('x-integritas-connector-token')"),
  'CRM authentication must be evaluated before connector authentication as in the verified live control function',
);
assert.match(source, /INTEGRITAS_CONTROL_ALLOWED_ORIGINS/, 'control API must support an explicit origin allowlist');
assert.match(source, /integritas-private-admin\.ruansch1\.chatgpt\.site/, 'private admin origin must be explicitly allowlisted');
assert.ok(!source.includes("'access-control-allow-origin': '*'"), 'CORS must not allow wildcard origins');
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
assert.match(source, /action === 'worker_storage_selftest'/, 'worker storage readiness self-test must be explicit');
assert.match(source, /storage\.updateBucket\(CASE_FILES_BUCKET/, 'storage readiness must use the Storage API rather than direct storage-schema SQL');
assert.match(source, /allowedMimeTypes: CASE_FILES_BUCKET_ALLOWED_MIME_TYPES/, 'storage readiness must enforce the bounded MIME allowlist');
assert.match(source, /storage self-test cleanup failed/, 'storage self-test artifacts must be removed');
assert.ok((source.match(/ensureCaseFilesStorageReady\(workerId, commandId\)/g) ?? []).length >= 2, 'storage readiness must guard both explicit preflight and publication fallback');
assert.match(source, /investigation artifact cleanup failed/, 'failed output registration must clean up the uploaded object');
assert.match(source, /contentType === 'text\/markdown'/, 'Markdown outputs must be treated as text for signed-URL leak checks');
assert.match(source, /return 'md'/, 'Markdown outputs must use the .md extension');
assert.match(source, /integritas_register_case_job_output/, 'published outputs must be registered through a bounded database RPC');
assert.match(source, /action === 'worker_commit_bundle'/, 'worker bundle commit action must be explicit');
assert.match(source, /integritas_commit_investigation_bundle/, 'worker bundle commit must use the atomic database RPC');
assert.match(source, /action === 'worker_job_state'/, 'worker recovery-state action must be explicit');
assert.match(source, /integritas_investigation_job_state/, 'worker recovery state must use a bounded database RPC');
assert.match(source, /action === 'worker_cancel_ack'/, 'worker cancellation acknowledgement must be explicit');
assert.match(source, /integritas_acknowledge_case_investigation_cancel/, 'worker cancellation must use a bounded database RPC');
assert.match(source, /action === 'retry_case_investigation'/, 'admin retry action must be explicit');
assert.match(source, /integritas_retry_case_investigation/, 'admin retry must use the bounded database RPC');
assert.match(source, /action === 'cancel_case_investigation'/, 'admin cancel action must be explicit');
assert.match(source, /integritas_cancel_case_investigation/, 'admin cancellation must use the bounded database RPC');
assert.match(source, /new TextEncoder\(\)\.encode\(encodedBundle\)\.byteLength/, 'bundle commit limit must be enforced in UTF-8 bytes');
assert.match(source, /\.\.\/_shared\/investigation-runtime-contract\.ts/, 'control API must import the shared investigation runtime contract');
for (const key of ['document_count', 'bundle_sha256', 'report_sha256', 'qa_summary', 'commit_summary', 'milestones']) {
  assert.match(runtimeContractSource, new RegExp(`'${key}'`), `shared checkpoint contract must allow ${key}`);
}
assert.match(source, /validMilestones/, 'checkpoint metadata must validate bounded milestone arrays');
assert.match(source, /\['waiting', 'active', 'complete', 'blocked', 'manual'\]/, 'milestone status vocabulary must remain bounded');
assert.match(source, /encoded\.length <= 32768/, 'checkpoint payloads must remain size-bounded');
assert.match(runtimeContractSource, /'report_markdown'/, 'shared output contract must allow canonical Markdown reports');
assert.match(runtimeContractSource, /'text\/markdown'/, 'shared content-type contract must allow Markdown output');
assert.match(source, /integritas-case-files/, 'investigation artifacts must remain in the private case-files bucket');

assert.match(e2eSelftestSource, /phase\s*===\s*["']start["']/, 'E2E self-test must expose a bounded start phase');
assert.match(e2eSelftestSource, /phase\s*===\s*["']poll["']/, 'E2E self-test must expose a bounded poll phase');
assert.match(e2eSelftestSource, /cleanup_pending/, 'E2E self-test must persist a cleanup-pending recovery phase');
assert.match(e2eSelftestSource, /storage\.from\(CASE_FILES_BUCKET\)\.remove/, 'E2E self-test must remove synthetic Storage objects through the Storage API');
assert.match(e2eSelftestSource, /integritas_case_job_outputs/, 'E2E cleanup must include persisted investigation output objects');
assert.match(e2eSelftestSource, /integritas_documents/, 'E2E cleanup must include submitted document objects');
assert.match(e2eSelftestSource, /syntheticDataDeleted:\s*true/, 'E2E self-test must record verified synthetic cleanup');
assert.ok(!/for\s*\(let\s+i\s*=\s*0;\s*i\s*<\s*24/.test(e2eSelftestSource), 'E2E self-test must not poll a long-running investigation inside one Edge invocation');
assert.ok(!/setTimeout\([^,]+,\s*6000\)/.test(e2eSelftestSource), 'E2E self-test must not hold an Edge invocation open with six-second polling sleeps');

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

assert.ok(!source.includes('Deno.Command'), 'Edge Function must not execute operating-system commands');
assert.ok(!source.includes('child_process'), 'Edge Function must not gain local process execution');

console.log('Integritas control Edge Function contract checks passed');
