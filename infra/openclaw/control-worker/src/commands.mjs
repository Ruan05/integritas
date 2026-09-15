import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const ALLOWED_COMMANDS = new Set([
  'health',
  'openclaw_status',
  'restart_openclaw',
  'verify_runtime',
]);

const FORBIDDEN_PAYLOAD_KEYS = new Set([
  'shell', 'command', 'cmd', 'env', 'sudo', 'dockerSocket', 'docker_socket',
  'secret', 'token', 'password', 'gatewayToken', 'serviceRoleKey',
]);

export function validateCommand(command) {
  if (!command || typeof command !== 'object') throw new Error('command must be an object');
  if (!ALLOWED_COMMANDS.has(command.command_type)) throw new Error('unsupported command');
  const payload = command.payload ?? {};
  if (payload === null || Array.isArray(payload) || typeof payload !== 'object') {
    throw new Error('payload must be an object');
  }
  for (const key of Object.keys(payload)) {
    if (FORBIDDEN_PAYLOAD_KEYS.has(key)) throw new Error(`forbidden payload key: ${key}`);
  }
  if (JSON.stringify(payload).length > 32768) throw new Error('payload too large');
  return { ...command, payload };
}

async function defaultRunner(file, args, options = {}) {
  const result = await execFileAsync(file, args, {
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
    ...options,
  });
  return {
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
  };
}

export async function executeCommand(command, {
  runner = defaultRunner,
  repoRoot = process.env.INTEGRITAS_REPO_ROOT || '/opt/integritas/current',
} = {}) {
  const validated = validateCommand(command);

  switch (validated.command_type) {
    case 'health':
      return { ok: true, component: 'integritas-control-worker' };

    case 'openclaw_status': {
      const active = await runner('/usr/bin/sudo', ['-n', '/usr/bin/systemctl', 'is-active', 'openclaw-gateway.service']);
      let version = '';
      try {
        const v = await runner('/usr/bin/openclaw', ['--version']);
        version = v.stdout.slice(0, 200);
      } catch {
        version = 'unavailable';
      }
      return { ok: active.stdout === 'active', service: active.stdout.slice(0, 80), openclaw_version: version };
    }

    case 'restart_openclaw': {
      await runner('/usr/bin/sudo', ['-n', '/usr/bin/systemctl', 'restart', 'openclaw-gateway.service']);
      const active = await runner('/usr/bin/sudo', ['-n', '/usr/bin/systemctl', 'is-active', 'openclaw-gateway.service']);
      if (active.stdout !== 'active') throw new Error('openclaw gateway did not return active');
      return { ok: true, service: 'active' };
    }

    case 'verify_runtime': {
      const result = await runner('/usr/bin/bash', [`${repoRoot}/infra/oracle/verify-host.sh`], { cwd: repoRoot });
      return { ok: true, summary: result.stdout.slice(-4000) };
    }

    default:
      throw new Error('unsupported command');
  }
}
