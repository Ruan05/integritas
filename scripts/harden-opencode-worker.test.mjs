import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertEfficiencyPolicy, efficiencyPolicy, harden, evidenceBoundary} from './harden-opencode-worker.mjs';

test('reject unexpected deployment shape without partial output', () => {
  assert.throws(() => harden([]), /missing/);
  assert.throws(
    () => assertEfficiencyPolicy('const MAX_PARALLEL = 3;', 'max_tokens:4000'),
    /Missing OpenCode efficiency marker/,
  );
});

test('capability instruction distinguishes inference from tool execution', () => {
  assert.match(evidenceBoundary, /model inference only/);
  assert.match(evidenceBoundary, /Missing evidence stays unresolved/);
});

test('efficiency policy locks cheap routing and bounded fan-out', () => {
  assert.equal(efficiencyPolicy.primaryModel, 'glm-5.3-flash');
  assert.equal(efficiencyPolicy.maxParallel, 2);
  assert.equal(efficiencyPolicy.maxTasks, 6);
  assert.equal(efficiencyPolicy.maxProviderTimeoutMs, 60000);
  assert.deepEqual(efficiencyPolicy.forbiddenAutomaticModels, ['kimi-k3', 'deepseek-v4-pro']);

  const index = [
    'const MAX_PARALLEL = 2;',
    'const MAX_TASKS = 6;',
    "'glm-5.3-flash'",
    'function usageFor',
    'input_tokens',
    'output_tokens',
    'cached_input_tokens',
    'failureKind',
    'usage_exhausted',
    'providerText=await response.text()',
    "taskClass==='very_large'||taskClass==='verify'?60000",
  ].join('\n');
  const worker = [
    "taskClass='medium'",
    "taskClass==='very_large'?2200",
    'max_output_tokens:maxOutputTokens',
    'max_tokens:maxOutputTokens',
  ].join('\n');
  assert.doesNotThrow(() => assertEfficiencyPolicy(index, worker));
  assert.throws(() => assertEfficiencyPolicy(index + '\nkimi-k3', worker), /Forbidden automatic OpenCode model route/);
});
