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

test('investigation methods use bounded worker actions without embedding credentials', async () => {
  const bodies = [];
  const fetchImpl = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, status: 200, text: async () => '{"ok":true}' };
  };
  const client = new ControlClient({
    baseUrl: 'https://example.invalid/control', workerToken: 'top-secret',
    workerId: 'oracle-primary', fetchImpl,
  });

  await client.manifest('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
  await client.checkpoint('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 4, 'researching', 55, { branch_count: 2 });
  await client.publishOutput('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 4, 'bundle', 'application/json', 'abc', 'a'.repeat(64));

  assert.deepEqual(bodies.map((body) => body.action), ['worker_manifest', 'worker_checkpoint', 'worker_publish_output']);
  assert.ok(bodies.every((body) => body.worker_id === 'oracle-primary'));
  assert.ok(bodies.every((body) => !JSON.stringify(body).includes('top-secret')));
});
