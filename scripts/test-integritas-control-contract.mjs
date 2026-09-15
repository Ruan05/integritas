import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync('supabase/functions/integritas-control/index.ts', 'utf8');

assert.match(source, /x-integritas-worker-token/, 'worker token header must be implemented');
assert.match(source, /x-integritas-connector-token/, 'connector token header must be implemented');
assert.match(source, /integritas_admin_users/, 'admin membership must be checked server-side');
assert.match(source, /idempotency-key/, 'enqueue must require an idempotency key');
assert.match(source, /integritas_control_enqueue/, 'enqueue must use the bounded database RPC');
assert.match(source, /integritas_control_lease/, 'worker lease must use the atomic database RPC');
assert.match(source, /CONNECTOR_COMMANDS = new Set\(\[/, 'connector command allowlist must be explicit');

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
