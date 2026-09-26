import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcilePlanChecks } from '../../plan-checks.mjs';

const plan = {
  research_lanes: [
    {
      lane_id: 'registry',
      priority: 'critical',
      question: 'Verify the legal entity in the official registry.',
      preferred_sources: ['Official company registry'],
      manual_only: false,
    },
    {
      lane_id: 'bank-beneficiary',
      priority: 'critical',
      question: 'Confirm the beneficiary account directly with the bank.',
      preferred_sources: ['Direct bank confirmation'],
      manual_only: true,
    },
  ],
};

test('omitted planner lanes are retained as truthful open/manual checks', () => {
  const bundle = { checks: [] };
  const result = reconcilePlanChecks(bundle, plan);
  assert.deepEqual(result, { total_lanes: 2, inserted: 2, restored: 0 });
  const registry = bundle.checks.find((row) => row.check_key === 'lane.registry');
  const bank = bundle.checks.find((row) => row.check_key === 'lane.bank-beneficiary');
  assert.equal(registry.status, 'open');
  assert.equal(registry.priority, 'critical');
  assert.match(registry.outcome, /must not be treated as complete/i);
  assert.equal(bank.status, 'blocked');
  assert.match(bank.outcome, /manual or issuer-side verification/i);
});

test('existing model lane checks are never overwritten or duplicated', () => {
  const existing = {
    check_key: 'lane.registry',
    check_type: 'registry',
    description: 'Verified against official registry',
    priority: 'critical',
    required_source: 'Official company registry',
    status: 'complete',
    outcome: 'Matched official filing',
  };
  const bundle = { checks: [existing] };
  reconcilePlanChecks(bundle, { research_lanes: [plan.research_lanes[0]] });
  assert.equal(bundle.checks.length, 1);
  assert.equal(bundle.checks[0], existing);
});

test('synthesis restores earlier lane results when the model drops them', () => {
  const prior = {
    checks: [{
      check_key: 'lane.registry',
      check_type: 'registry',
      description: 'Verify legal entity',
      priority: 'critical',
      required_source: 'Official company registry',
      status: 'complete',
      outcome: 'Verified',
    }],
  };
  const bundle = { checks: [] };
  const result = reconcilePlanChecks(bundle, { research_lanes: [plan.research_lanes[0]] }, prior);
  assert.deepEqual(result, { total_lanes: 1, inserted: 0, restored: 1 });
  assert.equal(bundle.checks[0].status, 'complete');
  assert.equal(bundle.checks[0].outcome, 'Verified');
});
