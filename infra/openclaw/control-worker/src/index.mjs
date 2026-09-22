import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { ControlClient } from './client.mjs';
import { executeCommand, validateCommand } from './commands.mjs';
import { executeInvestigation } from './investigation.mjs';

const execFileAsync = promisify(execFile);
const baseUrl = process.env.INTEGRITAS_CONTROL_URL;
const workerTokenFile = process.env.INTEGRITAS_CONTROL_WORKER_TOKEN_FILE;
const workerToken = process.env.INTEGRITAS_CONTROL_WORKER_TOKEN || (
  workerTokenFile ? readFileSync(workerTokenFile, 'utf8').trim() : ''
);
const workerId = process.env.INTEGRITAS_WORKER_ID || 'oracle-primary';
const pollMs = Number(process.env.INTEGRITAS_CONTROL_POLL_MS || 5000);
function readPackagedWorkerVersion() {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const version = String(pkg.version ?? '').trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error('invalid packaged worker version');
  return version;
}
const workerVersion = readPackagedWorkerVersion();

function readDeployedRelease() {
  try {
    const value = readFileSync('/opt/integritas/deployed-release', 'utf8').trim();
    return /^[0-9a-f]{40}$/.test(value) ? value : 'unknown';
  } catch {
    return 'unknown';
  }
}

if (!baseUrl || !workerToken) {
  console.error('INTEGRITAS_CONTROL_URL and a worker-token credential are required');
  process.exit(2);
}

const client = new ControlClient({ baseUrl, workerToken, workerId });
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function probeOpenClaw() {
  const [service, version] = await Promise.all([
    execFileAsync('/usr/bin/systemctl', ['is-active', 'openclaw-gateway.service'])
      .then(({ stdout }) => stdout.trim().slice(0, 80))
      .catch(() => 'inactive'),
    execFileAsync('/opt/openclaw/bin/openclaw', ['--version'])
      .then(({ stdout }) => stdout.trim().slice(0, 200))
      .catch(() => 'unavailable'),
  ]);
  return { service, version };
}

let heartbeatInFlight = null;

async function sendHeartbeat() {
  if (heartbeatInFlight) return heartbeatInFlight;
  heartbeatInFlight = (async () => {
    try {
      const openclaw = await probeOpenClaw();
      await client.heartbeat({
        runtime_version: process.version,
        openclaw_version: openclaw.version,
        openclaw_status: openclaw.service,
        worker_version: workerVersion,
        capability_flags: {
          bounded_control: true, arbitrary_shell: false, docker_socket: false,
          case_investigation: true, signed_manifests: true, durable_checkpoints: true,
          deterministic_qa: true, atomic_bundle_commit: true,
          bounded_release_deploy: true,
          large_case_orchestration_v2: true,
          deployed_release: readDeployedRelease(),
        },
      });
    } catch (error) {
      console.error(`heartbeat failed: ${error.message}`);
    } finally {
      heartbeatInFlight = null;
    }
  })();
  return heartbeatInFlight;
}

await sendHeartbeat();
const heartbeatInterval = setInterval(() => {
  sendHeartbeat().catch((error) => console.error(`heartbeat loop failed: ${error.message}`));
}, 30_000);
heartbeatInterval.unref();

while (!stopping) {
  try {

    const leased = await client.lease();
    const command = leased.command ?? null;
    if (!command) {
      await sleep(pollMs);
      continue;
    }

    const keepalive = setInterval(() => {
      client.touch(command.id).catch((error) => console.error(`touch failed: ${error.message}`));
    }, 25_000);
    keepalive.unref();

    try {
      await client.touch(command.id);
      const validated = validateCommand(command);
      const result = validated.command_type === 'run_case_investigation'
        ? await executeInvestigation(validated, {
          client,
          repoRoot: process.env.INTEGRITAS_REPO_ROOT || '/opt/integritas/current',
          retainWorkspace: true,
        })
        : await executeCommand(validated);
      if (!result?.cancelled && !result?.paused) {
        if (result?.terminal_outcome && result.terminal_outcome !== 'completed') {
          await client.fail(command.id, `investigation_${result.terminal_outcome}`, JSON.stringify({ terminal_outcome: result.terminal_outcome }).slice(0, 1000));
        } else {
          await client.complete(command.id, result);
        }
      }
    } catch (error) {
      await client.fail(command.id, 'execution_failed', String(error.message || error).slice(0, 1000));
    } finally {
      clearInterval(keepalive);
    }
  } catch (error) {
    console.error(`control loop error: ${error.message}`);
    await sleep(Math.min(pollMs * 2, 30_000));
  }
}
clearInterval(heartbeatInterval);
