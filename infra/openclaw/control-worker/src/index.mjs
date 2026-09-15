import { ControlClient } from './client.mjs';
import { executeCommand } from './commands.mjs';

const baseUrl = process.env.INTEGRITAS_CONTROL_URL;
const workerToken = process.env.INTEGRITAS_CONTROL_WORKER_TOKEN;
const workerId = process.env.INTEGRITAS_WORKER_ID || 'oracle-primary';
const pollMs = Number(process.env.INTEGRITAS_CONTROL_POLL_MS || 5000);
const workerVersion = process.env.INTEGRITAS_CONTROL_WORKER_VERSION || '0.1.0';

if (!baseUrl || !workerToken) {
  console.error('INTEGRITAS_CONTROL_URL and INTEGRITAS_CONTROL_WORKER_TOKEN are required');
  process.exit(2);
}

const client = new ControlClient({ baseUrl, workerToken, workerId });
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendHeartbeat() {
  try {
    await client.heartbeat({
      runtime_version: process.version,
      openclaw_version: null,
      openclaw_status: 'unknown',
      worker_version: workerVersion,
      capability_flags: { bounded_control: true, arbitrary_shell: false, docker_socket: false },
    });
  } catch (error) {
    console.error(`heartbeat failed: ${error.message}`);
  }
}

await sendHeartbeat();
let lastHeartbeat = Date.now();

while (!stopping) {
  try {
    if (Date.now() - lastHeartbeat > 30_000) {
      await sendHeartbeat();
      lastHeartbeat = Date.now();
    }

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
      const result = await executeCommand(command);
      await client.complete(command.id, result);
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
