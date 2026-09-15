import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(path, 'utf8');
const gateway = read('infra/openclaw/openclaw.json5');
const service = read('infra/openclaw/integritas-control-worker.service');
const commands = read('infra/openclaw/control-worker/src/commands.mjs');
const worker = read('infra/openclaw/control-worker/src/index.mjs');
const client = read('infra/openclaw/control-worker/src/client.mjs');
const polkit = read('infra/openclaw/49-integritas-openclaw-control.rules');
const edge = read('supabase/functions/integritas-control/index.ts');

assert.match(gateway, /bind:\s*["']loopback["']/, 'OpenClaw Gateway must remain loopback-only');
assert.match(service, /^User=integritas-control$/m, 'control worker must use dedicated non-root account');
assert.match(service, /^NoNewPrivileges=true$/m, 'control worker must retain NoNewPrivileges');
assert.match(service, /^ProtectSystem=strict$/m, 'control worker must use a read-only system view');
assert.match(service, /^CapabilityBoundingSet=$/m, 'control worker must receive no Linux capabilities');
assert.match(service, /LoadCredential=control-token:/, 'worker token must enter through a systemd credential');
assert.ok(!service.includes('/var/run/docker.sock'), 'control worker must not receive Docker socket access');
assert.ok(!service.match(/^ExecStart=.*\b(sudo|sh -c|bash -c)\b/m), 'service must not launch through sudo or a shell string');

assert.match(polkit, /subject\.user === "integritas-control"/, 'Polkit rule must be scoped to worker account');
assert.match(polkit, /action\.lookup\("unit"\) === "openclaw-gateway\.service"/, 'Polkit rule must target only OpenClaw Gateway');
assert.match(polkit, /action\.lookup\("verb"\) === "restart"/, 'Polkit rule must permit only restart');
assert.ok(!polkit.includes('polkit.Result.AUTH_ADMIN_KEEP'), 'Polkit rule must not create a reusable admin grant');

assert.match(commands, /execFile/, 'bounded worker may use execFile');
assert.ok(!commands.match(/\bexec\s*\(/), 'generic child_process exec must not be used');
assert.ok(!commands.includes('shell: true'), 'shell execution must remain disabled');
assert.ok(!commands.includes('/var/run/docker.sock'), 'worker dispatcher must not expose Docker socket');
for (const prohibited of ['exec_shell', 'read_environment', 'read_secret', 'plugin_install', 'send_email', 'delete_evidence']) {
  assert.ok(!commands.includes(`'${prohibited}'`), `worker must not implement ${prohibited}`);
}

assert.match(worker, /INTEGRITAS_CONTROL_WORKER_TOKEN_FILE/, 'worker should support credential-file token loading');
assert.ok(!worker.includes('console.log(workerToken)'), 'worker token must never be logged');
assert.match(client, /x-integritas-worker-token/, 'worker client must use scoped worker authentication');

assert.match(edge, /x-integritas-connector-token/, 'ChatGPT connector requires separate scoped authentication');
assert.match(edge, /x-integritas-worker-token/, 'Oracle worker requires separate scoped authentication');
assert.ok(!edge.includes("'access-control-allow-origin': '*'"), 'control API must not use wildcard CORS');
assert.ok(!edge.includes('Deno.Command'), 'Edge Function must not execute host commands');
assert.ok(!edge.includes('child_process'), 'Edge Function must not execute local processes');
for (const prohibited of ['exec_shell', 'read_environment', 'read_secret', 'plugin_install', 'send_email', 'delete_evidence']) {
  assert.ok(!edge.includes(`'${prohibited}'`), `control API must not implement ${prohibited}`);
}

for (const file of [commands, worker, client, service, edge]) {
  assert.ok(!file.match(/sb_service_role_[A-Za-z0-9_-]+/), 'service-role credential literal must not be committed');
  assert.ok(!file.match(/sk-[A-Za-z0-9_-]{16,}/), 'provider/API key literal must not be committed');
}

console.log('Integritas control bridge policy checks passed');
