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
const verifyHost = read('infra/oracle/verify-host.sh');
const investigation = read('infra/openclaw/control-worker/src/investigation.mjs');
const investigationUnit = read('infra/openclaw/integritas-openclaw-investigation@.service');
const investigationRunner = read('infra/openclaw/investigation-agent-runner.mjs');
const investigationConfig = read('infra/openclaw/integritas-investigation.json5');
const installer = read('infra/openclaw/install-control-worker.sh');
const nativeInstaller = read('infra/openclaw/install-native.sh');

assert.match(gateway, /bind:\s*["']loopback["']/, 'OpenClaw Gateway must remain loopback-only');
assert.match(service, /^User=integritas-control$/m, 'control worker must use dedicated non-root account');
assert.match(service, /^Group=integritas-openclaw$/m, 'control worker must use the shared spool group as its primary group');
assert.match(service, /^NoNewPrivileges=true$/m, 'control worker must retain NoNewPrivileges');
assert.match(service, /^ProtectSystem=strict$/m, 'control worker must use a read-only system view');
assert.match(service, /^CapabilityBoundingSet=$/m, 'control worker must receive no Linux capabilities');
assert.match(service, /LoadCredential=control-token:/, 'worker token must enter through a systemd credential');
assert.ok(!service.includes('/var/run/docker.sock'), 'control worker must not receive Docker socket access');
assert.ok(!service.match(/^ExecStart=.*\b(sudo|sh -c|bash -c)\b/m), 'service must not launch through sudo or a shell string');

assert.match(polkit, /subject\.user === "integritas-control"/, 'Polkit rule must be scoped to worker account');
assert.match(polkit, /unit === "openclaw-gateway\.service"/, 'Polkit must preserve the exact Gateway restart target');
assert.match(polkit, /verb === "restart"/, 'Polkit must preserve the Gateway restart verb');
assert.ok(!polkit.includes('polkit.Result.AUTH_ADMIN_KEEP'), 'Polkit rule must not create a reusable admin grant');
assert.match(polkit, /integritas-openclaw-investigation@/, 'Polkit must name only the investigation runner template');
assert.match(polkit, /verb === "start"/, 'Polkit must allow runner start only');
assert.match(polkit, /\[0-9a-f\]\{8\}/, 'Polkit runner unit match must constrain UUID instances');

assert.match(commands, /execFile/, 'bounded worker may use execFile');
assert.ok(!commands.match(/\bexec\s*\(/), 'generic child_process exec must not be used');
assert.ok(!commands.includes('shell: true'), 'shell execution must remain disabled');
assert.ok(!commands.includes('/var/run/docker.sock'), 'worker dispatcher must not expose Docker socket');
for (const prohibited of ['exec_shell', 'read_environment', 'read_secret', 'plugin_install', 'send_email', 'delete_evidence']) {
  assert.ok(!commands.includes(`'${prohibited}'`), `worker must not implement ${prohibited}`);
}

assert.match(investigationUnit, /^User=openclaw$/m, 'investigation runner must execute as openclaw');
assert.match(investigationUnit, /^Group=integritas-openclaw$/m, 'investigation runner must use the shared spool group as its primary group');
assert.match(investigationUnit, /^SupplementaryGroups=openclaw docker$/m, 'runner keeps only OpenClaw config and sandbox supplementary groups');
assert.match(investigationUnit, /^WorkingDirectory=\/var\/lib\/integritas-runner\/jobs\/%i$/m, 'runner working directory must be the UUID-scoped spool');
assert.match(investigationUnit, /^NoNewPrivileges=true$/m, 'investigation runner must retain NoNewPrivileges');
assert.match(investigationUnit, /^ProtectSystem=strict$/m, 'investigation runner must retain a read-only system view');
assert.ok(!investigationUnit.includes('/var/run/docker.sock'), 'investigation unit must not mount the Docker socket explicitly');
assert.match(investigationRunner, /const args = \[\s*'agent', 'exec'/, 'runner arguments must begin with OpenClaw agent exec');
assert.match(investigationRunner, /execFileAsync\('\/opt\/openclaw\/bin\/openclaw', args/, 'runner must execute only the fixed OpenClaw binary');
assert.match(investigationRunner, /--config/, 'runner must pin the dedicated exec config');
assert.ok(!investigationRunner.includes("'--state-dir'"), 'runner must use OpenClaw isolated temporary exec state while the Gateway owns persistent state');
assert.match(investigationRunner, /OPENCLAW_STATE_DIR:\s*'\/var\/lib\/openclaw'/, 'runner may discover existing provider credentials only through the bounded OpenClaw environment');
assert.match(investigationRunner, /fast:\s*'off'.*standard:\s*'off'.*deep:\s*'max'.*maximum:\s*'max'/s, 'runner depth mapping must stay within Kimi K3 supported thinking levels');
assert.ok(!investigationRunner.includes('shell: true'), 'runner must never execute through a shell');
assert.match(investigationConfig, /\$include:\s*["']\.\/openclaw\.json["']/, 'investigation config must inherit the pinned OpenClaw config');
assert.match(investigationConfig, /workspaceAccess:\s*["']ro["']/, 'investigation agent workspace must remain read-only');
assert.match(investigationConfig, /deny:\s*\[[^\]]*["']write["'][^\]]*["']edit["'][^\]]*["']exec["'][^\]]*["']apply_patch["']/s, 'investigation agent must not mutate files or invoke execution tools');
assert.match(investigationRunner, /'--code-mode', 'direct'/, 'investigation agent must use direct tool mode');
assert.match(investigationRunner, /parseAgentBundle\(result\.stdout, manifest\)/, 'trusted runner must parse and validate the structured final response');
assert.match(investigationRunner, /writeSharedAtomic\('bundle\.json'/, 'trusted runner must atomically materialize the canonical bundle');
assert.match(investigationRunner, /writeSharedAtomic\('report\.md'/, 'trusted runner must derive the canonical report from the validated bundle');
assert.match(investigationConfig, /alsoAllow:\s*\[[^\]]*["']browser["']/, 'investigation runner must explicitly permit browser research');
assert.match(installer, /integritas-openclaw/, 'installer must provision the shared investigation group');
assert.match(installer, /2770/, 'shared spool must use setgid owner-group permissions');
assert.match(installer, /integritas-openclaw-investigation@\.service/, 'installer must install the fixed runner template');
assert.match(installer, /RUNNER_SCRIPT_DEST/, 'installer must use an explicit runner destination');
assert.match(installer, /RUNNER_SCRIPT_SRC.*RUNNER_SCRIPT_DEST|RUNNER_SCRIPT_DEST.*RUNNER_SCRIPT_SRC/s, 'installer must handle source/destination identity safely');
assert.match(installer, /chown root:openclaw \"\$OPENCLAW_CONFIG_DIR\"/, 'control-worker installer must restore OpenClaw config directory ownership');
assert.match(installer, /chmod 0750 \"\$OPENCLAW_CONFIG_DIR\"/, 'control-worker installer must restore OpenClaw config directory traversal');
assert.match(installer, /chmod 0640 \"\$OPENCLAW_CONFIG_PATH\"/, 'control-worker installer must preserve service-readable main config permissions');
assert.match(nativeInstaller, /install -d -m 0750 -o root -g openclaw/, 'native installer must keep OpenClaw config directory private but service-readable');
assert.match(nativeInstaller, /chmod 0750 \"\$\{CONFIG_DIR\}\"/, 'native installer must defensively restore config directory traversal before validation');
assert.match(investigation, /document digest mismatch/, 'worker must verify downloaded evidence digests');
assert.match(investigation, /url\.hostname !== controlHost/, 'worker must bind signed downloads to the control-plane origin');
assert.match(investigation, /systemctlRunner\('\/usr\/bin\/systemctl', \['start', '--no-block'/, 'worker must start only the fixed oneshot runner without blocking durable lease renewal');
assert.match(investigation, /\['show', '--property=ActiveState', '--value', unit\]/, 'worker must poll and rejoin the scoped unit across worker restarts');

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

assert.match(verifyHost, /systemctl is-active docker/, 'runtime verifier must check Docker health without Docker socket access');
assert.ok(!verifyHost.includes('docker info'), 'runtime verifier must not require Docker daemon socket access');
assert.ok(!verifyHost.match(/docker ps\b/), 'runtime verifier must not enumerate containers through the Docker socket');

for (const file of [commands, worker, client, service, edge]) {
  assert.ok(!file.match(/sb_service_role_[A-Za-z0-9_-]+/), 'service-role credential literal must not be committed');
  assert.ok(!file.match(/sk-[A-Za-z0-9_-]{16,}/), 'provider/API key literal must not be committed');
}

console.log('Integritas control bridge policy checks passed');
