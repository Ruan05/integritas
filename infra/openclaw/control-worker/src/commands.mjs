import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SAFE_EXEC_ENV = { PATH: '/usr/bin:/bin', LANG: 'C' };

export const ALLOWED_COMMANDS = new Set([
  'health',
  'openclaw_status',
  'restart_openclaw',
  'verify_runtime',
  'deploy_release',
  'release_status',
  'run_case_investigation',
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

  if (command.command_type === 'deploy_release') {
    const allowed = new Set(['release_sha']);
    for (const key of Object.keys(payload)) {
      if (!allowed.has(key)) throw new Error(`unexpected payload key: ${key}`);
    }
    if (typeof payload.release_sha !== 'string' || !/^[0-9a-f]{40}$/.test(payload.release_sha)) {
      throw new Error('invalid release_sha');
    }
  }

  if (command.command_type === 'release_status' && Object.keys(payload).length > 0) {
    throw new Error('release_status payload must be empty');
  }

  if (command.command_type === 'run_case_investigation') {
    const allowed = new Set(['case_id', 'case_job_id', 'case_revision', 'depth']);
    for (const key of Object.keys(payload)) {
      if (!allowed.has(key)) throw new Error(`unexpected payload key: ${key}`);
    }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (typeof payload.case_id !== 'string' || !uuid.test(payload.case_id)) throw new Error('invalid case_id');
    if (typeof payload.case_job_id !== 'string' || !uuid.test(payload.case_job_id)) throw new Error('invalid case_job_id');
    if (!Number.isInteger(payload.case_revision) || payload.case_revision < 0) throw new Error('invalid case_revision');
    if (!['fast', 'standard', 'deep', 'maximum'].includes(payload.depth)) throw new Error('invalid depth');
  }

  return { ...command, payload };
}

async function defaultRunner(file, args, options = {}) {
  const result = await execFileAsync(file, args, {
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
    ...options,
    env: SAFE_EXEC_ENV,
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
      const active = await runner('/usr/bin/systemctl', ['is-active', 'openclaw-gateway.service']);
      let version = '';
      try {
        const v = await runner('/opt/openclaw/bin/openclaw', ['--version']);
        version = v.stdout.slice(0, 200);
      } catch {
        version = 'unavailable';
      }
      return { ok: active.stdout === 'active', service: active.stdout.slice(0, 80), openclaw_version: version };
    }

    case 'restart_openclaw': {
      await runner('/usr/bin/systemctl', ['restart', 'openclaw-gateway.service']);
      const active = await runner('/usr/bin/systemctl', ['is-active', 'openclaw-gateway.service']);
      if (active.stdout !== 'active') throw new Error('openclaw gateway did not return active');
      return { ok: true, service: 'active' };
    }

    case 'verify_runtime': {
      const result = await runner('/usr/bin/bash', [`${repoRoot}/infra/oracle/verify-host.sh`], { cwd: repoRoot });
      return { ok: true, summary: result.stdout.slice(-4000) };
    }

    case 'deploy_release': {
      const releaseSha = validated.payload.release_sha;
      const unit = `integritas-release-deploy@${releaseSha}.service`;
      await runner('/usr/bin/systemctl', ['start', '--no-block', unit]);
      return { ok: true, accepted: true, release_sha: releaseSha, unit };
    }

    case 'release_status': {
      const [release, current, gateway, worker] = await Promise.all([
        runner('/usr/bin/cat', ['/opt/integritas/deployed-release']).catch(() => ({ stdout: 'unknown', stderr: '' })),
        runner('/usr/bin/readlink', ['-f', '/opt/integritas/current']).catch(() => ({ stdout: 'unknown', stderr: '' })),
        runner('/usr/bin/systemctl', ['is-active', 'openclaw-gateway.service']).catch(() => ({ stdout: 'inactive', stderr: '' })),
        runner('/usr/bin/systemctl', ['is-active', 'integritas-control-worker.service']).catch(() => ({ stdout: 'inactive', stderr: '' })),
      ]);
      const deployed = release.stdout.trim();
      return {
        ok: /^[0-9a-f]{40}$/.test(deployed),
        deployed_release: deployed.slice(0, 80),
        current_release_path: current.stdout.trim().slice(0, 300),
        gateway_status: gateway.stdout.trim().slice(0, 80),
        worker_status: worker.stdout.trim().slice(0, 80),
      };
    }

    case 'run_case_investigation':
      throw new Error('investigation command requires dedicated investigation executor');

    default:
      throw new Error('unsupported command');
  }
}
