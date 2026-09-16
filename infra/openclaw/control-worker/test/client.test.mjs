import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlClient } from '../src/client.mjs';

test('sends worker id in the authentication header', async () => {
  let captured;
  const fetchImpl = async (_url, init) => {
    captured = init;
    return { ok: true, status: 200, text: async () => '{}' };
  };

  const client = new ControlClient({
    baseUrl: 'https://example.invalid/control',
    workerToken: 'token',
    workerId: 'oracle-primary',
    fetchImpl,
  });

  await client.heartbeat({});

  assert.equal(captured.headers['x-integritas-worker-id'], 'oracle-primary');
});
