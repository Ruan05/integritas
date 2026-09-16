import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCommand, validateCommand } from '../src/commands.mjs';

test('rejects commands outside the fixed allowlist', () => {
  assert.throws(() => validateCommand({ command_type: 'exec_shell', payload: {} }), /unsupported command/);
});

test('rejects payload keys that could smuggle shell or secrets', () => {
  for (const key of ['shell', 'command', 'env', 'sudo', 'dockerSocket', 'secret', 'token']) {
    assert.throws(() => validateCommand({ command_type: 'health', payload: { [key]: 'x' } }), /forbidden payload key/);
  }
});

test('health requires no host execution', async () => {
  const result = await executeCommand({ command_type: 'health', payload: {} }, {
    runner: async () => { throw new Error('runner must not be called'); },
  });
  assert.equal(result.ok, true);
});

test('restart uses exact bounded systemctl invocations', async () => {
  const calls = [];
  const runner = async (file, args) => {
    calls.push([file, args]);
    if (args.includes('is-active')) return { stdout: 'active', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const result = await executeCommand({ command_type: 'restart_openclaw', payload: {} }, { runner });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    ['/usr/bin/systemctl', ['restart', 'openclaw-gateway.service']],
    ['/usr/bin/systemctl', ['is-active', 'openclaw-gateway.service']],
  ]);
});

test('verify_runtime uses the fixed repository verifier path', async () => {
  const calls = [];
  const runner = async (file, args, options) => {
    calls.push([file, args, options]);
    return { stdout: 'verified', stderr: '' };
  };
  const result = await executeCommand({ command_type: 'verify_runtime', payload: {} }, { runner, repoRoot: '/srv/integritas' });
  assert.equal(result.ok, true);
  assert.equal(calls[0][0], '/usr/bin/bash');
  assert.deepEqual(calls[0][1], ['/srv/integritas/infra/oracle/verify-host.sh']);
});

test('run_case_investigation accepts only bounded UUID payloads', () => {
  const command = validateCommand({
    command_type: 'run_case_investigation',
    payload: {
      case_id: '11111111-1111-4111-8111-111111111111',
      case_job_id: '22222222-2222-4222-8222-222222222222',
      case_revision: 3,
      depth: 'deep',
    },
  });
  assert.equal(command.payload.depth, 'deep');
  assert.equal(command.payload.case_revision, 3);
});

test('run_case_investigation rejects unbounded or malformed payloads', () => {
  const base = {
    case_id: '11111111-1111-4111-8111-111111111111',
    case_job_id: '22222222-2222-4222-8222-222222222222',
    case_revision: 3,
    depth: 'standard',
  };
  assert.throws(() => validateCommand({ command_type: 'run_case_investigation', payload: { ...base, case_id: 'bad' } }), /case_id/);
  assert.throws(() => validateCommand({ command_type: 'run_case_investigation', payload: { ...base, case_revision: -1 } }), /case_revision/);
  assert.throws(() => validateCommand({ command_type: 'run_case_investigation', payload: { ...base, depth: 'unlimited' } }), /depth/);
  assert.throws(() => validateCommand({ command_type: 'run_case_investigation', payload: { ...base, prompt: 'arbitrary' } }), /unexpected payload key/);
});

test('run_case_investigation is not executed by the generic host dispatcher', async () => {
  let called = false;
  await assert.rejects(
    executeCommand({
      command_type: 'run_case_investigation',
      payload: {
        case_id: '11111111-1111-4111-8111-111111111111',
        case_job_id: '22222222-2222-4222-8222-222222222222',
        case_revision: 3,
        depth: 'maximum',
      },
    }, { runner: async () => { called = true; return { stdout: '', stderr: '' }; } }),
    /dedicated investigation executor/,
  );
  assert.equal(called, false);
});
