import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'infra/oracle/bootstrap-oracle-linux.sh',
  'infra/oracle/cloud-init-oracle-linux.yaml.tpl',
  'infra/oracle/provision-always-free-a1.sh',
  'infra/oracle/run-command.sh',
  'infra/oracle/deploy-integritas-release.sh',
  'infra/oracle/test-release-rollback.sh',
  'infra/openclaw/install-native.sh',
  'infra/openclaw/openclaw-gateway.service',
  'infra/openclaw/openclaw.json5',
  'infra/openclaw/integritas-gateway.json5',
  'infra/openclaw/ROLLBACK.md',
];

const errors = [];
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) errors.push(`missing ${file}`);
}
for (const file of [
  'infra/oracle/deploy-integritas-release.sh',
  'infra/oracle/test-release-rollback.sh',
]) {
  if (fs.existsSync(path.join(root, file)) && (fs.statSync(path.join(root, file)).mode & 0o111) === 0) {
    errors.push(`release script must be executable in the Git tree: ${file}`);
  }
}

if (!errors.length) {
  const config = read('infra/openclaw/openclaw.json5');
  const unit = read('infra/openclaw/openclaw-gateway.service');
  const gatewayOverlay = read('infra/openclaw/integritas-gateway.json5');
  const installer = read('infra/openclaw/install-native.sh');
  const cloudInit = read('infra/oracle/cloud-init-oracle-linux.yaml.tpl');
  const runCommand = read('infra/oracle/run-command.sh');
  const releaseDeploy = read('infra/oracle/deploy-integritas-release.sh');
  const rollbackTest = read('infra/oracle/test-release-rollback.sh');
  const rollback = read('infra/openclaw/ROLLBACK.md');
  const provision = read('infra/oracle/provision-always-free-a1.sh');

  const mustContain = [
    [config, 'mode: "local"', 'local Gateway mode'],
    [config, 'bind: "loopback"', 'loopback-only gateway'],
    [config, 'backend: "docker"', 'Docker sandbox backend'],
    [config, 'network: "none"', 'sandbox network disabled'],
    [config, 'readOnlyRoot: true', 'read-only sandbox root'],
    [config, 'capDrop: ["ALL"]', 'sandbox capability drop'],
    [config, 'visibility: "tree"', 'tree session visibility'],
    [config, 'agentToAgent: { enabled: false }', 'agent-to-agent disabled'],
    [config, 'alsoAllow: ["browser"]', 'browser tool explicitly added above coding profile'],
    [config, 'watch: true', 'skill watcher enabled for session refresh'],
    [unit, 'User=openclaw', 'non-root Gateway user'],
    [unit, 'NoNewPrivileges=true', 'systemd no-new-privileges'],
    [unit, 'ProtectSystem=strict', 'systemd filesystem protection'],
    [unit, 'EnvironmentFile=-/etc/integritas/provider-secrets.env', 'provider secret environment'],
    [unit, 'OPENCLAW_CONFIG_PATH=/etc/openclaw/integritas-gateway.json', 'provider-aware Gateway config path'],
    [gatewayOverlay, '$include: "./openclaw.json"', 'Gateway base-config include'],
    [gatewayOverlay, 'primary: "nvidia/nemotron-3-ultra-550b-a55b"', 'Gateway NVIDIA primary'],
    [gatewayOverlay, '"nvidia/nemotron-3-ultra-550b-a55b"', 'Gateway NVIDIA fallback'],
    [gatewayOverlay, '"integritas-openrouter/openrouter/free"', 'Gateway dynamic free fallback'],
    [installer, 'OPENCLAW_VERSION="2026.9.4"', 'pinned OpenClaw stable version'],
    [installer, 'chmod 0755 "${PREFIX}/bin/openclaw"', 'readable executable OpenClaw CLI'],
    [installer, 'v${TARGET_VERSION}', 'pinned OpenClaw source tag'],
    [cloudInit, 'ocarun', 'OCI Run Command user'],
    [runCommand, 'oci instance-agent command create', 'OCI Run Command create call'],
    [releaseDeploy, '[0-9a-f]{40}', 'exact release SHA validation'],
    [releaseDeploy, 'systemctl stop', 'worker quiesce before release switch'],
    [releaseDeploy, 'integritas-openclaw-investigation@*.service', 'active investigation deployment guard'],
    [releaseDeploy, 'rollback()', 'automatic release rollback handler'],
    [releaseDeploy, 'snapshot_managed_files', 'pre-deploy managed-file snapshot'],
    [releaseDeploy, 'restore_managed_files', 'exact managed-file rollback restore'],
    [releaseDeploy, 'INTEGRITAS_ROLLBACK_TEST', 'explicit rollback-test gate'],
    [releaseDeploy, 'after-install', 'post-install rollback fault injection point'],
    [rollbackTest, 'INTEGRITAS_FAULT_INJECT_PHASE=after-install', 'privileged rollback acceptance injection'],
    [rollbackTest, 'diff -u', 'rollback before/after state comparison'],
    [releaseDeploy, 'mv -Tf', 'atomic current-release symlink switch'],
    [releaseDeploy, 'systemctl restart "${GATEWAY}"', 'provider-aware Gateway restart'],
    [rollback, 'previous-version', 'rollback version record'],
    [provision, 'VM.Standard.A1.Flex', 'Always Free A1 shape'],
  ];

  for (const [text, needle, label] of mustContain) {
    if (!text.includes(needle)) errors.push(`missing ${label}`);
  }

  if (config.includes('workspaceAccess: "rw"')) errors.push('rw workspace access is forbidden');
  if (unit.includes('User=root')) errors.push('Gateway must not run as root');
  if (cloudInit.includes('NOPASSWD: ALL')) errors.push('unbounded sudo is forbidden');
  if (runCommand.includes('bash -c "$')) errors.push('arbitrary remote shell is forbidden');
  if (runCommand.includes('commandString')) errors.push('OCI Run Command must use TEXT source only; commandString duplication is forbidden');
  if (releaseDeploy.includes('curl ') || releaseDeploy.includes('wget ')) errors.push('release deploy must not fetch executable content from the network');
  if (releaseDeploy.includes('eval ')) errors.push('release deploy must not use eval');
  if (/\blatest\b/.test(installer)) errors.push('mutable latest release reference is forbidden');
  if (config.includes('/var/run/docker.sock')) errors.push('model config must not expose the Docker socket');
  if (/gsk_[A-Za-z0-9_-]+|sk-or-v1-[A-Za-z0-9_-]+|nvapi-[A-Za-z0-9_-]+/.test(gatewayOverlay)) errors.push('Gateway overlay must not contain provider secret values');
}

if (errors.length) {
  console.error(errors.map((e) => `- ${e}`).join('\n'));
  process.exit(1);
}
console.log('Oracle/OpenClaw infrastructure policy verified.');
