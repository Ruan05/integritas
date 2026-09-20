import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScalePlan,
  buildLaneGroups,
  mapLimit,
  mergeCanonicalBundles,
  validateRepairPatch,
  applyRepairPatch,
} from '../../scale-orchestration.mjs';

const CASE_ID = '73bef14a-2f8a-44a4-ab73-f09eb1f0efd6';
const JOB_ID = '5c4316f7-2ee4-4c43-b903-f774abf80af5';

function manifest(count = 20) {
  return {
    case_id: CASE_ID,
    case_job_id: JOB_ID,
    case_revision: count,
    depth: 'maximum',
    documents: Array.from({ length: count }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      name: `doc-${i + 1}.txt`,
      local_path: `documents/doc-${i + 1}.txt`,
      mime_type: 'text/plain',
      size_bytes: 512 * 1024,
    })),
  };
}

function bundle({
  sourceKey = 'src',
  findingKey = 'fnd',
  entityId = 'REG-1',
  documentId = manifest(1).documents[0].id,
  checkKey = 'lane.identity',
} = {}) {
  return {
    schema_version: 1,
    case_id: CASE_ID,
    case_job_id: JOB_ID,
    case_revision: 20,
    depth: 'maximum',
    generated_at: '2026-09-20T12:00:00Z',
    entities: [{
      entity_key: 'target-company',
      entity_type: 'company',
      display_name: 'Target Company',
      aliases: [],
      identifiers: { registration: entityId },
      match_status: 'proposed',
      confidence: 80,
    }],
    relationships: [],
    sources: [{
      source_key: sourceKey,
      source_type: 'document',
      title: 'Submitted document',
      url: null,
      document_id: documentId,
      page_reference: null,
      excerpt: 'Submitted evidence.',
      reliability_note: 'Unverified submitted evidence.',
      evidence_origin: 'submitted_document',
      retrieved_at: '2026-09-20T12:00:00Z',
    }],
    findings: [{
      finding_key: findingKey,
      entity_key: 'target-company',
      finding_type: 'identity',
      claim: 'Submitted evidence contains an identity claim.',
      evidence_status: 'alleged',
      materiality: 'high',
      reliability: 'medium',
      evidence_excerpt: 'Identity claim.',
      source_keys: [sourceKey],
    }],
    checks: [{
      check_key: checkKey,
      entity_key: 'target-company',
      check_type: 'identity',
      description: 'Verify identity.',
      priority: 'high',
      required_source: 'Official registry',
      status: 'open',
      outcome: 'Pending.',
    }],
    contradictions: [],
    unresolved_checks: [],
    limitations: [],
    report: { summary: 'Shard evidence.', markdown: '# Shard evidence\n', status: 'draft' },
    execution: {
      started_at: '2026-09-20T12:00:00Z',
      completed_at: '2026-09-20T12:01:00Z',
      stages: ['shard'],
      tool_results: [],
      warnings: [],
      terminal_outcome: 'incomplete',
    },
  };
}

test('maximum-depth scale plan shards all 20 documents exactly once with at most three per shard', () => {
  const value = buildScalePlan(manifest(20), 'maximum');
  assert.equal(value.document_count, 20);
  assert.equal(value.mode, 'sharded');
  assert.equal(value.parallelism, 2);
  assert.equal(value.shards.length, 7);
  assert.ok(value.shards.every((shard) => shard.document_ids.length >= 1 && shard.document_ids.length <= 3));
  const ids = value.shards.flatMap((shard) => shard.document_ids);
  assert.equal(ids.length, 20);
  assert.equal(new Set(ids).size, 20);
  assert.deepEqual(new Set(ids), new Set(manifest(20).documents.map((row) => row.id)));
});

test('oversized document is isolated without dropping subsequent documents', () => {
  const value = manifest(4);
  value.documents[0].size_bytes = 8 * 1024 * 1024;
  const plan = buildScalePlan(value, 'maximum');
  assert.equal(plan.shards[0].document_ids.length, 1);
  assert.equal(plan.shards.flatMap((row) => row.document_ids).length, 4);
});

test('maximum-depth research lanes are grouped in pairs', () => {
  const groups = buildLaneGroups({
    research_lanes: Array.from({ length: 5 }, (_, i) => ({ lane_id: `lane-${i + 1}` })),
  }, 'maximum');
  assert.deepEqual(groups.map((group) => group.lanes.length), [2, 2, 1]);
});

test('mapLimit preserves result order and obeys concurrency', async () => {
  let active = 0;
  let peak = 0;
  const results = await mapLimit([40, 30, 20, 10], 2, async (delay, index) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, delay));
    active -= 1;
    return `r${index}`;
  });
  assert.deepEqual(results, ['r0', 'r1', 'r2', 'r3']);
  assert.equal(peak, 2);
});

test('deterministic merge namespaces shard evidence and marks conflicting identifiers without duplicate keys', () => {
  const m = manifest(2);
  const one = bundle({ sourceKey: 'src', findingKey: 'fnd', entityId: 'REG-1', documentId: m.documents[0].id });
  const two = bundle({ sourceKey: 'src', findingKey: 'fnd', entityId: 'REG-2', documentId: m.documents[1].id });
  const merged = mergeCanonicalBundles([
    { namespace: 'sh01', bundle: one },
    { namespace: 'sh02', bundle: two },
  ], m);
  assert.equal(merged.entities.length, 1);
  assert.equal(merged.entities[0].match_status, 'conflicting');
  assert.deepEqual(merged.entities[0].identifiers.registration, ['REG-1', 'REG-2']);
  assert.deepEqual(merged.sources.map((row) => row.source_key), ['sh01.src', 'sh02.src']);
  assert.deepEqual(merged.findings.map((row) => row.finding_key), ['sh01.fnd', 'sh02.fnd']);
  assert.deepEqual(merged.findings.map((row) => row.source_keys[0]), ['sh01.src', 'sh02.src']);
  assert.equal(merged.checks.length, 1, 'stable lane check must merge instead of duplicating');
  assert.equal(merged.checks[0].check_key, 'lane.identity');
});

test('repair patch may downgrade or clarify but cannot invent verification', () => {
  const base = bundle();
  assert.throws(
    () => validateRepairPatch({
      finding_updates: [{ finding_key: 'fnd', evidence_status: 'verified' }],
    }, base),
    /cannot upgrade a finding to verified/,
  );

  const patch = validateRepairPatch({
    finding_updates: [{
      finding_key: 'fnd',
      claim: 'Identity remains unresolved after independent review.',
      evidence_status: 'uncertain',
      reliability: 'low',
    }],
    check_updates: [{ check_key: 'lane.identity', status: 'blocked', outcome: 'Official registry unavailable.' }],
    unresolved_additions: [{
      unresolved_key: 'manual.identity',
      description: 'Identity requires manual verification.',
      reason: 'Authoritative registry confirmation unavailable.',
      attempted_methods: ['Submitted evidence review'],
      blocker: 'No authoritative confirmation.',
      next_manual_action: 'Obtain official registry extract.',
    }],
    warnings: ['Independent review downgraded the identity claim.'],
  }, base);
  const repaired = applyRepairPatch(base, patch);
  assert.equal(repaired.findings[0].evidence_status, 'uncertain');
  assert.equal(repaired.checks[0].status, 'blocked');
  assert.equal(repaired.unresolved_checks.length, 1);
  assert.equal(repaired.execution.terminal_outcome, 'incomplete');
});
