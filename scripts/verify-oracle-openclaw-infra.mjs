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
  'infra/openclaw/install-native.sh',
  'infra/openclaw/openclaw-gateway.service',
  'infra/openclaw/openclaw.json5',
  'infra/openclaw/ROLLBACK.md',
];

const errors = [];
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) errors.push(`missing ${file}`);
}

if (!errors.length) {
  const config = read('infra/openclaw/openclaw.json5');
  const unit = read('infra/openclaw/openclaw-gateway.service');
  const installer = read('infra/openclaw/install-native.sh');
  const cloudInit = read('infra/oracle/cloud-init-oracle-linux.yaml.tpl');
  const runCommand = read('infra/oracle/run-command.sh');
  const releaseDeploy = read('infra/oracle/deploy-integritas-release.sh');
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
    [installer, 'OPENCLAW_VERSION="2026.9.4"', 'pinned OpenClaw stable version'],
    [installer, 'chmod 0755 "${PREFIX}/bin/openclaw"', 'readable executable OpenClaw CLI'],
    [installer, 'v${TARGET_VERSION}', 'pinned OpenClaw source tag'],
    [cloudInit, 'ocarun', 'OCI Run Command user'],
    [runCommand, 'oci instance-agent command create', 'OCI Run Command create call'],
    [releaseDeploy, '[0-9a-f]{40}', 'exact release SHA validation'],
    [releaseDeploy, 'systemctl stop', 'worker quiesce before release switch'],
    [releaseDeploy, 'integritas-openclaw-investigation@*.service', 'active investigation deployment guard'],
    [releaseDeploy, 'rollback()', 'automatic release rollback handler'],
    [releaseDeploy, 'mv -Tf', 'atomic current-release symlink switch'],
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
}

if (errors.length) {
  console.error(errors.map((e) => `- ${e}`).join('\n'));
  process.exit(1);
}
console.log('Oracle/OpenClaw infrastructure policy verified.');
