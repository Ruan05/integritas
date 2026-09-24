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

  await client.storageSelfTest('11111111-1111-4111-8111-111111111111');
  await client.manifest('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
  await client.checkpoint('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 4, 'researching', 55, { branch_count: 2 });
  await client.publishOutput('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 4, 'bundle', 'application/json', 'abc', 'a'.repeat(64));
  await client.registerResearchSource(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    4,
    { source_key: 'source-web', url: 'https://example.com/source', title: 'Example source', verification_state: 'validated', retrieved_at: '2026-09-18T20:00:00Z' },
    { calls: 2, failures: 0, tools: ['web_fetch'] },
  );
  await client.commitBundle('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 4, 'a'.repeat(64), 'b'.repeat(64), { schema_version: 1 });
  await client.incomplete('11111111-1111-4111-8111-111111111111', { terminal_outcome: 'incomplete' });
  await client.jobState('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
  await client.acknowledgeCancel('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');

  assert.deepEqual(bodies.map((body) => body.action), [
    'worker_storage_selftest', 'worker_manifest', 'worker_checkpoint', 'worker_publish_output', 'worker_register_research_source',
    'worker_commit_bundle', 'worker_incomplete', 'worker_job_state', 'worker_cancel_ack',
  ]);
  assert.ok(bodies.every((body) => body.worker_id === 'oracle-primary'));
  assert.ok(bodies.every((body) => !JSON.stringify(body).includes('top-secret')));
});


test('retries transient provenance authorization failures without duplicating other actions', async () => {
  let calls = 0;
  const client = new ControlClient({
    baseUrl: 'https://example.invalid/control',
    workerToken: 'token',
    workerId: 'oracle-primary',
    fetchImpl: async (_url, init) => {
      calls += 1;
      if (calls < 3) return { ok: false, status: 401, text: async () => '{"error":"unauthorized"}' };
      return { ok: true, status: 201, text: async () => '{"tool_invocation_id":"id"}' };
    },
  });

  await client.registerResearchSource(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    4,
    { source_key: 'source-web', url: 'https://example.com/source', title: 'Example source', verification_state: 'opened', retrieved_at: '2026-09-18T20:00:00Z' },
    { calls: 2, failures: 0, tools: ['web_fetch'] },
  );

  assert.equal(calls, 3);
});


test('preserves bounded control error detail for diagnosis', async () => {
  const client = new ControlClient({
    baseUrl: 'https://example.invalid/control',
    workerToken: 'token',
    workerId: 'oracle-primary',
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({
        error: 'control_request_failed',
        detail: 'storage self-test upload failed: mime type application/json is not allowed',
      }),
    }),
  });

  await assert.rejects(
    client.storageSelfTest('11111111-1111-4111-8111-111111111111'),
    /mime type application\/json is not allowed/,
  );
});
