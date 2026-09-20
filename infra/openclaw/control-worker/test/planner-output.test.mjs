import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlannerJsonObject, filterSyntheticExternalResearchLanes } from '../../planner-output.mjs';

test('accepts one bounded fenced planner JSON object wrapped in prose', () => {
  const value = {
    document_profiles: [],
    case_profile: {},
    research_lanes: [],
    cross_document_tests: [],
    specialist_checks: [],
    automatic_stop_conditions: [],
  };
  const wrapped = [
    'Planner summary without braces.',
    '',
    '~~~ignored prose~~~',
    '',
    '```json',
    JSON.stringify(value, null, 2),
    '```',
    '',
    'Done.',
  ].join('\n');
  assert.deepEqual(parsePlannerJsonObject(wrapped), value);
});

test('rejects ambiguous or structurally unsafe fenced planner wrappers', () => {
  const value = JSON.stringify({ ok: true });
  const fence = String.fromCharCode(96, 96, 96);
  assert.throws(
    () => parsePlannerJsonObject(fence + 'json\n' + value + '\n' + fence + '\n'
      + fence + 'json\n' + value + '\n' + fence),
    /must contain one valid JSON object/,
  );
  assert.throws(
    () => parsePlannerJsonObject('Unsafe {brace} wrapper\n' + fence + 'json\n' + value + '\n' + fence),
    /must contain one valid JSON object/,
  );
});

test('trusted synthetic plans keep internal lanes and remove only external-research lanes', () => {
  const plan = {
    research_lanes: [
      { lane_id: 'external', tools: ['browser', 'web_fetch'] },
      { lane_id: 'internal', tools: ['file_tools'] },
      { lane_id: 'manual-internal', tools: [] },
    ],
  };
  const filtered = filterSyntheticExternalResearchLanes(plan, true);
  assert.deepEqual(filtered.research_lanes.map((row) => row.lane_id), ['internal', 'manual-internal']);
  assert.equal(plan.research_lanes.length, 3, 'input plan must remain immutable');
  assert.equal(filterSyntheticExternalResearchLanes(plan, false), plan, 'real investigations must remain unchanged');
});
