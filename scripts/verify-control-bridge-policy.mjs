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
const releaseUnit = read('infra/openclaw/integritas-release-deploy@.service');
const controlledDeploy = read('infra/oracle/deploy-integritas-controlled.sh');
const investigationRunner = read('infra/openclaw/investigation-agent-runner.mjs');
const largeInvestigationRunner = read('infra/openclaw/large-investigation-agent-runner-v2.mjs');
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
assert.match(polkit, /integritas-release-deploy@/, 'Polkit must name only the bounded release template');
assert.match(polkit, /\[0-9a-f\]\{40\}/, 'Polkit release unit match must constrain exact lowercase Git SHAs');
assert.match(polkit, /verb === "start"[\s\S]*integritas-release-deploy@/, 'Polkit release permission must be start-only');

assert.match(commands, /execFile/, 'bounded worker may use execFile');
assert.ok(!commands.match(/\bexec\s*\(/), 'generic child_process exec must not be used');
assert.ok(!commands.includes('shell: true'), 'shell execution must remain disabled');
assert.ok(!commands.includes('/var/run/docker.sock'), 'worker dispatcher must not expose Docker socket');
for (const prohibited of ['exec_shell', 'read_environment', 'read_secret', 'plugin_install', 'send_email', 'delete_evidence']) {
  assert.ok(!commands.includes(`'${prohibited}'`), `worker must not implement ${prohibited}`);
}
assert.ok(commands.includes("'deploy_verified_update'"), 'worker must expose only the named bounded release command');
assert.match(commands, /\^\[0-9a-f\]\{40\}\$/, 'worker must validate one exact lowercase release SHA');
assert.match(commands, /integritas-release-deploy@\$\{releaseSha\}\.service/, 'worker must map release SHA only to the fixed systemd template');
assert.match(commands, /\['start', '--no-block', unit\]/, 'worker release command must only start the fixed oneshot asynchronously');

assert.match(investigationUnit, /^User=openclaw$/m, 'investigation runner must execute as openclaw');
assert.match(investigationUnit, /^Group=integritas-openclaw$/m, 'investigation runner must use the shared spool group as its primary group');
assert.match(investigationUnit, /^SupplementaryGroups=openclaw docker$/m, 'runner keeps only OpenClaw config and sandbox supplementary groups');
assert.match(investigationUnit, /^EnvironmentFile=-\/etc\/integritas\/provider-secrets\.env$/m, 'runner must receive provider credentials only from the root-managed environment file');
assert.match(investigationUnit, /^WorkingDirectory=\/var\/lib\/integritas-runner\/jobs\/%i$/m, 'runner working directory must be the UUID-scoped spool');
assert.match(investigationUnit, /^NoNewPrivileges=true$/m, 'investigation runner must retain NoNewPrivileges');
assert.match(investigationUnit, /^ProtectSystem=strict$/m, 'investigation runner must retain a read-only system view');
assert.ok(!investigationUnit.includes('/var/run/docker.sock'), 'investigation unit must not mount the Docker socket explicitly');
assert.match(releaseUnit, /^User=root$/m, 'bounded release unit must run the fixed deployment wrapper as root');
assert.match(releaseUnit, /^ExecStartPre=\/usr\/bin\/sleep 8$/m, 'bounded release unit must delay long enough for command acknowledgement');
assert.match(releaseUnit, /^ExecStart=\/usr\/bin\/bash \/opt\/integritas\/current\/infra\/oracle\/deploy-integritas-controlled\.sh %i$/m, 'bounded release unit must execute only the fixed SHA wrapper');
assert.match(releaseUnit, /^NoNewPrivileges=true$/m, 'bounded release unit must retain no-new-privileges');
assert.match(releaseUnit, /^ProtectHome=true$/m, 'bounded release unit must not read operator home directories');
assert.ok(!releaseUnit.includes('EnvironmentFile='), 'bounded release unit must not accept caller-controlled environment files');
assert.match(controlledDeploy, /^SOURCE_URL=https:\/\/github\.com\/Ruan05\/integritas\.git$/m, 'controlled deployment must pin the approved GitHub repository');
assert.match(controlledDeploy, /^APPROVED_BRANCH=integritas-command-center-foundation$/m, 'controlled deployment must pin the approved feature branch');
assert.match(controlledDeploy, /git init --quiet "\$\{SOURCE_REPO\}"/, 'controlled deployment must use an isolated root-owned checkout');
assert.match(controlledDeploy, /--depth=512/, 'controlled deployment must fetch bounded approved branch history');
assert.ok(!controlledDeploy.includes('/home/opc'), 'controlled deployment must not trust the mutable operator checkout');
assert.ok(!controlledDeploy.includes('runuser'), 'controlled deployment must not cross into an operator-owned Git workspace');
assert.match(controlledDeploy, /\^\[0-9a-f\]\{40\}\$/, 'controlled deployment must validate one exact lowercase Git SHA');
assert.match(controlledDeploy, /REMOTE_HEAD=/, 'controlled deployment must resolve the current approved remote branch head');
assert.match(controlledDeploy, /\[\[ "\$\{SHA\}" == "\$\{REMOTE_HEAD\}" \]\]/, 'controlled deployment must require the requested SHA to equal the approved branch head');
assert.match(controlledDeploy, /merge-base --is-ancestor/, 'controlled deployment must refuse automated non-fast-forward releases');
assert.match(controlledDeploy, /git -C "\$\{SOURCE_REPO\}" archive "\$\{SHA\}"/, 'controlled deployment must extract the target release script from the exact requested commit');
assert.ok(!controlledDeploy.match(/\b(eval|curl|wget)\b/), 'controlled deployment must not evaluate strings or download executable content');

assert.match(investigationRunner, /const args = \[\s*'agent', 'exec'/, 'runner arguments must begin with OpenClaw agent exec');
assert.match(investigationRunner, /execFileAsync\('\/opt\/openclaw\/bin\/openclaw', buildArgs\(messageFile, phaseRoute\)/, 'runner must execute only the fixed OpenClaw binary with bounded phase arguments');
assert.match(investigationRunner, /--config/, 'runner must pin the dedicated exec config');
assert.ok(!investigationRunner.includes("'--state-dir'"), 'runner must use OpenClaw isolated temporary exec state while the Gateway owns persistent state');
assert.match(investigationRunner, /OPENCLAW_STATE_DIR:\s*'\/var\/lib\/openclaw'/, 'runner may discover existing provider credentials only through the bounded OpenClaw environment');
assert.ok(investigationRunner.includes("const NVIDIA_PRIMARY = 'integritas-nvidia/nvidia/nemotron-3-ultra-550b-a55b'"), 'verified explicit NVIDIA Ultra must remain available for bounded fallback');
assert.ok(investigationRunner.includes("const FREE_FAST = 'integritas-openrouter/nvidia/nemotron-3-super-120b-a12b:free'"), 'verified free Super must remain in the bounded fallback set');
assert.ok(investigationRunner.includes("SYNTHETIC_MODEL_ROUTES = routes(NVIDIA_PRIMARY, ACTIVE_FREE_FALLBACKS)"), 'synthetic validation must use the verified explicit NVIDIA route plus conditionally activated bounded free fallbacks');
assert.ok(!investigationRunner.includes('NVIDIA_LIGHTNING'), 'unhealthy Lightning route must not be auto-selected');
assert.ok(investigationRunner.includes("const DEEPSEEK_FLASH = 'integritas-openrouter/deepseek/deepseek-v4.1-flash'"), 'real research must expose DeepSeek V4.1 Flash');
assert.ok(investigationRunner.includes("const GLM_53 = 'integritas-openrouter/z-ai/glm-5.3'"), 'real planning/critic must expose GLM 5.3');
assert.ok(investigationRunner.includes("const GLM_53_FLASH = 'integritas-openrouter/z-ai/glm-5.3-flash'"), 'real investigation fallback must expose GLM 5.3 Flash');
assert.ok(investigationRunner.includes("planner: { model: GLM_53"), 'standard/deep planning must prefer GLM 5.3');
assert.ok(investigationRunner.includes("research: { model: DEEPSEEK_FLASH"), 'real research must prefer DeepSeek V4.1 Flash');
assert.ok(investigationRunner.includes("'integritas-openrouter/nvidia/nemotron-3-ultra-550b-a55b:free'"), 'free Nemotron Ultra may remain as an emergency fallback');
assert.ok(investigationRunner.includes("'integritas-openrouter/nvidia/nemotron-3-super-120b-a12b:free'"), 'verified free Nemotron Super must be routable');
assert.ok(investigationRunner.includes("'integritas-openrouter/nex-agi/nex-n2.5-pro:free'"), 'verified free Nex Pro must be routable');
assert.ok(investigationRunner.includes('ACTIVE_FREE_FALLBACKS = process.env.OPENCODE_ZEN_API_KEY'), 'Zen fallback activation must be conditional on a server-side Zen key');
assert.ok(investigationRunner.includes("'integritas-opencode-zen/big-pickle'"), 'Big Pickle must be staged as a conditional Zen fallback');
assert.ok(investigationRunner.includes("'--model', phaseRoute.model"), 'runner must explicitly pin each bounded phase model');
assert.ok(investigationRunner.includes("args.push('--fallback', fallback)"), 'legacy bounded phases must use only their explicit fallback chain');
assert.ok(investigationRunner.includes("'integritas-openrouter/openrouter/free'"), 'dynamic OpenRouter free routing may be used only as synthetic emergency fallback');
assert.ok(!investigationRunner.includes("model: 'integritas-openrouter/openrouter/free'"), 'dynamic OpenRouter free routing must never be a primary investigation route');
assert.ok(!investigationRunner.includes('opencode-go/deepseek-v4-pro'), 'DeepSeek Pro must not be a default investigation fallback');
assert.ok(!investigationRunner.includes("'integritas-groq/openai/gpt-oss-20b'"), 'Groq 20B is not approved for production investigation routing');
assert.ok(!investigationRunner.includes('shell: true'), 'runner must never execute through a shell');
assert.match(investigationConfig, /\$include:\s*["']\.\/openclaw\.json["']/, 'investigation config must inherit the pinned OpenClaw config');
assert.match(investigationConfig, /workspaceAccess:\s*["']ro["']/, 'investigation evidence workspace must remain read-only');
assert.match(investigationConfig, /profile:\s*["']minimal["']/, 'investigation agent must start from the minimal tool profile');
assert.match(investigationConfig, /modelPolicy:\s*\{[\s\S]*allow:/, 'investigation overlay must own its model allowlist');
assert.ok(!investigationConfig.includes('integritas-groq'), 'unprovisioned Groq must not make production config validation fail');
assert.ok(!investigationConfig.includes('GROQ_API_KEY'), 'unprovisioned Groq SecretRef must not be required by the production overlay');
for (const model of ['deepseek/deepseek-v4.1-flash', 'z-ai/glm-5.3', 'z-ai/glm-5.3-flash']) {
  assert.ok(investigationConfig.includes(model), `production investigation profile must expose ${model}`);
}
assert.match(installer, /for name in OPENROUTER_API_KEY NVIDIA_API_KEY; do/, 'only provisioned NVIDIA/OpenRouter secrets may be mandatory');
assert.ok(installer.includes('OPENROUTER_API_KEY|NVIDIA_API_KEY|GROQ_API_KEY|OPENCODE_ZEN_API_KEY'), 'Groq and OpenCode Zen may remain approved optional staged variables');
assert.match(investigationConfig, /"integritas-openrouter"/, 'investigation config must define a fixed OpenRouter provider');
assert.match(investigationConfig, /"integritas-nvidia"/, 'investigation config must define an explicit NVIDIA provider');
assert.match(investigationConfig, /"integritas-opencode-zen"/, 'investigation config must define the OpenCode Zen chat provider');
assert.match(investigationConfig, /"integritas-opencode-zen-responses"/, 'investigation config must define the OpenCode Zen responses provider');
assert.match(investigationConfig, /id:\s*["']OPENCODE_ZEN_API_KEY["']/, 'OpenCode Zen must use the optional Zen SecretRef');
assert.match(investigationConfig, /id:\s*["']NVIDIA_API_KEY["']/, 'explicit NVIDIA provider must use the NVIDIA environment SecretRef');
assert.match(investigationConfig, /apiKey:\s*\{\s*source:\s*["']env["'],\s*provider:\s*["']default["'],\s*id:\s*["']OPENROUTER_API_KEY["']\s*\}/, 'OpenRouter key must be an environment SecretRef');
assert.match(investigationConfig, /id:\s*["']openrouter\/free["']/, 'investigation config may register the dynamic free router only for emergency fallback');
assert.match(investigationConfig, /deny:\s*\[[^\]]*["']write["'][^\]]*["']edit["'][^\]]*["']exec["'][^\]]*["']apply_patch["']/s, 'investigation agent must not mutate files or invoke execution tools');
assert.match(investigationRunner, /'--code-mode', 'direct'/, 'investigation agent must use direct tool mode');
assert.ok(largeInvestigationRunner.includes("const NVIDIA_ULTRA = 'integritas-nvidia/nvidia/nemotron-3-ultra-550b-a55b'"), 'large-case runner must use the explicit verified NVIDIA Ultra fallback');
assert.ok(!largeInvestigationRunner.includes('NVIDIA_LIGHTNING'), 'large-case runner must not auto-route to unhealthy Lightning');
assert.ok(largeInvestigationRunner.includes("const DEEPSEEK_FLASH = 'integritas-openrouter/deepseek/deepseek-v4.1-flash'"), 'large-case runner must expose DeepSeek V4.1 Flash');
assert.ok(largeInvestigationRunner.includes("const GLM_53 = 'integritas-openrouter/z-ai/glm-5.3'"), 'large-case runner must expose GLM 5.3');
assert.ok(largeInvestigationRunner.includes("FREE_OPENROUTER_MODELS.has(model)"), 'large-case free budget must apply only to free routes');
assert.ok(largeInvestigationRunner.includes("const MAX_OPENROUTER_FREE_USES = 4"), 'large-case free-router usage must be globally bounded per investigation');
assert.ok(largeInvestigationRunner.includes("const MAX_ZEN_FREE_USES = 4"), 'large-case Zen free usage must be bounded per investigation');
assert.match(largeInvestigationRunner, /buildDocumentShards\(manifest, 4\)/, 'large-case runner must shard documents into bounded groups');
assert.match(largeInvestigationRunner, /mapLimit\(shards, 2/, 'document shard concurrency must remain bounded');
assert.match(largeInvestigationRunner, /mapLimit\(plan\.research_lanes, 2/, 'research lane concurrency must remain bounded');
assert.match(largeInvestigationRunner, /failed every validated model route/, 'large-case runner must fail over on validation failure, not only transport failure');
assert.match(largeInvestigationRunner, /validateInvestigationBundle\(finalBundle, manifest, reportMarkdown\)/, 'large-case deterministic assembly must pass canonical validation');
assert.ok(!largeInvestigationRunner.includes('synthesis-task'), 'large-case final canonical bundle must not depend on giant model synthesis');
assert.ok(!largeInvestigationRunner.includes('shell: true'), 'large-case runner must never execute through a shell');
assert.match(investigationRunner, /parseAgentBundle\(researchStdout, manifest\)/, 'trusted runner must validate the primary research bundle');
assert.match(investigationRunner, /parseAgentBundle\(finalStdout, manifest\)/, 'trusted runner must validate the final synthesis bundle');
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
assert.ok(edge.includes("'deploy_verified_update'"), 'control API must explicitly name the bounded verified-update command');
assert.match(edge, /commandType === 'deploy_verified_update' && principal\.kind !== 'connector'/, 'verified deployment must be connector-only');
assert.match(edge, /invalid_release_sha/, 'control API must reject malformed verified-release payloads');
for (const prohibited of ['exec_shell', 'read_environment', 'read_secret', 'plugin_install', 'send_email', 'delete_evidence']) {
  assert.ok(!edge.includes(`'${prohibited}'`), `control API must not implement ${prohibited}`);
}

assert.match(verifyHost, /systemctl is-active docker/, 'runtime verifier must check Docker health without Docker socket access');
assert.match(verifyHost, /\/usr\/sbin\/ss -ltnp/, 'runtime verifier must use an absolute ss path under the restricted worker PATH');
assert.ok(!verifyHost.includes('docker info'), 'runtime verifier must not require Docker daemon socket access');
assert.ok(!verifyHost.match(/docker ps\b/), 'runtime verifier must not enumerate containers through the Docker socket');

for (const file of [commands, worker, client, service, edge, investigationRunner, largeInvestigationRunner, investigationConfig, installer, investigationUnit, releaseUnit, controlledDeploy]) {
  assert.ok(!file.match(/sb_service_role_[A-Za-z0-9_-]+/), 'service-role credential literal must not be committed');
  assert.ok(!file.match(/sk-[A-Za-z0-9_-]{16,}/), 'provider/API key literal must not be committed');
  assert.ok(!file.match(/gsk_[A-Za-z0-9_-]{16,}/), 'Groq key literal must not be committed');
  assert.ok(!file.match(/nvapi-[A-Za-z0-9_-]{16,}/), 'NVIDIA key literal must not be committed');
}

console.log('Integritas control bridge policy checks passed');
