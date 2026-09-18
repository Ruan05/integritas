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
assert.match(investigationUnit, /^EnvironmentFile=-\/etc\/integritas\/provider-secrets\.env$/m, 'runner must receive provider credentials only from the root-managed environment file');
assert.match(investigationUnit, /^WorkingDirectory=\/var\/lib\/integritas-runner\/jobs\/%i$/m, 'runner working directory must be the UUID-scoped spool');
assert.match(investigationUnit, /^NoNewPrivileges=true$/m, 'investigation runner must retain NoNewPrivileges');
assert.match(investigationUnit, /^ProtectSystem=strict$/m, 'investigation runner must retain a read-only system view');
assert.ok(!investigationUnit.includes('/var/run/docker.sock'), 'investigation unit must not mount the Docker socket explicitly');
assert.match(investigationRunner, /const args = \[\s*'agent', 'exec'/, 'runner arguments must begin with OpenClaw agent exec');
assert.match(investigationRunner, /execFileAsync\('\/opt\/openclaw\/bin\/openclaw', args/, 'runner must execute only the fixed OpenClaw binary');
assert.match(investigationRunner, /--config/, 'runner must pin the dedicated exec config');
assert.ok(!investigationRunner.includes("'--state-dir'"), 'runner must use OpenClaw isolated temporary exec state while the Gateway owns persistent state');
assert.match(investigationRunner, /OPENCLAW_STATE_DIR:\s*'\/var\/lib\/openclaw'/, 'runner may discover existing provider credentials only through the bounded OpenClaw environment');
assert.ok(investigationRunner.includes("model: 'nvidia/nemotron-3-ultra-550b-a55b'"), 'investigations must use direct long-context NVIDIA as the primary route');
assert.ok(!investigationRunner.includes("model: 'integritas-groq/"), 'Groq must not be a primary OpenClaw investigation route because free-tier TPM is below the OpenClaw prompt baseline');
assert.ok(investigationRunner.includes("'integritas-openrouter/nvidia/nemotron-3-ultra-550b-a55b:free'"), 'OpenRouter must use a fixed free model through the deterministic custom provider');
assert.ok(investigationRunner.includes("'opencode-go/glm-5.3-flash'"), 'OpenCode Go may remain only as a last-resort routine fallback');
assert.ok(investigationRunner.includes("'opencode-go/glm-5.2'"), 'OpenCode Go may remain only as a last-resort deep fallback');
assert.ok(investigationRunner.includes("'--model', route.model"), 'runner must explicitly pin the job-scoped primary model');
assert.ok(investigationRunner.includes("args.push('--fallback', fallback)"), 'runner must use only its explicit bounded fallback chain');
assert.ok(investigationRunner.includes("'integritas-openrouter/openrouter/free'"), 'dynamic OpenRouter free routing may be used only as an emergency fallback');
assert.ok(!investigationRunner.includes("model: 'integritas-openrouter/openrouter/free'"), 'dynamic OpenRouter free routing must never be a primary investigation route');
assert.ok(!investigationRunner.includes('opencode-go/kimi-k3'), 'Kimi K3 must not be a default investigation model');
assert.ok(!investigationRunner.includes('opencode-go/deepseek-v4-pro'), 'DeepSeek Pro must not be a default investigation fallback');
assert.ok(!investigationRunner.includes("'integritas-groq/openai/gpt-oss-20b'"), 'Groq 20B must not add a guaranteed 413 fallback hop to OpenClaw investigations');
assert.ok(!investigationRunner.includes("'integritas-groq/openai/gpt-oss-120b'"), 'Groq 120B must not add a guaranteed 413 fallback hop to OpenClaw investigations');
assert.ok(!investigationRunner.includes('shell: true'), 'runner must never execute through a shell');
assert.match(investigationConfig, /\$include:\s*["']\.\/openclaw\.json["']/, 'investigation config must inherit the pinned OpenClaw config');
assert.match(investigationConfig, /workspaceAccess:\s*["']ro["']/, 'investigation evidence workspace must remain read-only');
assert.match(investigationConfig, /profile:\s*["']minimal["']/, 'investigation agent must start from the minimal tool profile');
assert.ok(!investigationConfig.includes('integritas-groq'), 'Groq must not be configured in the production investigation profile');
assert.ok(!investigationConfig.includes('GROQ_API_KEY'), 'Groq secret must not be referenced by the production investigation profile');
assert.ok(!installer.match(/for name in[^;]*GROQ_API_KEY/), 'Groq must not be a required production provider secret');
assert.match(investigationConfig, /"integritas-openrouter"/, 'investigation config must define a fixed OpenRouter provider');
assert.match(investigationConfig, /apiKey:\s*\{\s*source:\s*["']env["'],\s*provider:\s*["']default["'],\s*id:\s*["']OPENROUTER_API_KEY["']\s*\}/, 'OpenRouter key must be an environment SecretRef');
assert.match(investigationConfig, /id:\s*["']openrouter\/free["']/, 'investigation config may register the dynamic free router only for emergency fallback');
assert.match(investigationConfig, /deny:\s*\[[^\]]*["']write["'][^\]]*["']edit["'][^\]]*["']exec["'][^\]]*["']apply_patch["']/s, 'investigation agent must not mutate files or invoke execution tools');
assert.match(investigationRunner, /'--code-mode', 'direct'/, 'investigation agent must use direct tool mode');
assert.match(investigationRunner, /parseAgentBundle\(result\.stdout, manifest\)/, 'trusted runner must parse and validate the structured final response');
assert.match(investigationRunner, /writeSharedAtomic\('bundle\.json'/, 'trusted runner must atomically materialize the canonical bundle');
assert.match(investigationRunner, /writeSharedAtomic\('report\.md'/, 'trusted runner must derive the canonical report from the validated bundle');
assert.match(investigationConfig, /alsoAllow:\s*\[[^\]]*["']read["'][^\]]*["']web_search["'][^\]]*["']web_fetch["'][^\]]*["']browser["']/, 'investigation runner must expose only bounded evidence and research tools above the minimal profile');
assert.match(installer, /integritas-openclaw/, 'installer must provision the shared investigation group');
assert.match(installer, /2770/, 'shared spool must use setgid owner-group permissions');
assert.match(installer, /integritas-openclaw-investigation@\.service/, 'installer must install the fixed runner template');
assert.match(installer, /RUNNER_SCRIPT_DEST/, 'installer must use an explicit runner destination');
assert.match(installer, /RUNNER_SCRIPT_SRC.*-ef.*RUNNER_SCRIPT_DEST|RUNNER_SCRIPT_DEST.*-ef.*RUNNER_SCRIPT_SRC/s, 'installer must compare runner source/destination by filesystem identity');
assert.match(installer, /chown root:openclaw \"\$OPENCLAW_CONFIG_DIR\"/, 'control-worker installer must restore OpenClaw config directory ownership');
assert.match(installer, /chmod 0750 \"\$OPENCLAW_CONFIG_DIR\"/, 'control-worker installer must restore OpenClaw config directory traversal');
assert.match(installer, /chmod 0640 \"\$OPENCLAW_CONFIG_PATH\"/, 'control-worker installer must preserve service-readable main config permissions');
assert.match(installer, /PROVIDER_ENV_FILE=.*provider-secrets\.env/, 'installer must manage a dedicated provider secret environment');
assert.match(installer, /install -o root -g root -m 0600 \"\$PROVIDER_STAGING_FILE\" \"\$PROVIDER_ENV_FILE\"/, 'provider secrets must be installed root-only');
for (const requiredProviderKey of ['OPENROUTER_API_KEY', 'NVIDIA_API_KEY']) {
  assert.match(installer, new RegExp(requiredProviderKey), `installer must require ${requiredProviderKey}`);
}
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

for (const file of [commands, worker, client, service, edge, investigationRunner, investigationConfig, installer, investigationUnit]) {
  assert.ok(!file.match(/sb_service_role_[A-Za-z0-9_-]+/), 'service-role credential literal must not be committed');
  assert.ok(!file.match(/sk-[A-Za-z0-9_-]{16,}/), 'provider/API key literal must not be committed');
  assert.ok(!file.match(/gsk_[A-Za-z0-9_-]{16,}/), 'Groq key literal must not be committed');
  assert.ok(!file.match(/nvapi-[A-Za-z0-9_-]{16,}/), 'NVIDIA key literal must not be committed');
}

console.log('Integritas control bridge policy checks passed');
