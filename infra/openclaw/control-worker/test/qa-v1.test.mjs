import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const QA = path.join(REPO_ROOT, 'tools', 'dd', 'quality_v1.py');

function bundle(report, overrides = {}) {
  return {
    schema_version: 1,
    case_id: '11111111-1111-4111-8111-111111111111',
    case_job_id: '22222222-2222-4222-8222-222222222222',
    case_revision: 7,
    depth: 'deep',
    generated_at: '2026-09-18T05:00:00Z',
    entities: [],
    relationships: [],
    sources: [{
      source_key: 'source-1', source_type: 'document', title: 'Source',
      url: null, document_id: '44444444-4444-4444-8444-444444444444',
      page_reference: 'p1', excerpt: 'Evidence', reliability_note: 'direct',
      evidence_origin: 'submitted_document', retrieved_at: '2026-09-18T05:00:00Z',
    }],
    findings: [{
      finding_key: 'finding-1', entity_key: null, finding_type: 'identity',
      claim: 'Claim', evidence_status: 'verified', materiality: 'medium',
      reliability: 'high', evidence_excerpt: 'Evidence', source_keys: ['source-1'],
    }],
    checks: [{
      check_key: 'check-1', entity_key: null, check_type: 'identity',
      description: 'Verify identity', priority: 'high', required_source: 'registry',
      status: 'complete', outcome: 'matched',
    }],
    contradictions: [],
    unresolved_checks: [],
    limitations: [],
    report: { summary: 'Summary', markdown: report, status: 'draft' },
    execution: {
      started_at: '2026-09-18T04:00:00Z', completed_at: '2026-09-18T05:00:00Z',
      stages: ['verifying'], tool_results: [{ tool: 'registry', status: 'completed', summary: 'done' }],
      warnings: [], terminal_outcome: 'completed',
    },
    ...overrides,
  };
}

async function runQa(value, report) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'integritas-qa-v1-'));
  const bundlePath = path.join(root, 'bundle.json');
  const reportPath = path.join(root, 'report.md');
  const manifestPath = path.join(root, 'manifest.json');
  await writeFile(bundlePath, JSON.stringify(value));
  await writeFile(reportPath, report);
  await writeFile(manifestPath, JSON.stringify({
    case_id: value.case_id, case_job_id: value.case_job_id,
    case_revision: value.case_revision, depth: value.depth,
    documents: [{ id: '44444444-4444-4444-8444-444444444444' }],
  }));
  try {
    return await execFileAsync('python3', [
      QA, bundlePath, '--manifest', manifestPath, '--report', reportPath,
      '--current-revision', String(value.case_revision),
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('v1 deterministic QA accepts a source-linked draft bundle', async () => {
  const report = '# MASTER SUMMARY — READ THIS FIRST\nCase summary.\n\n# DIRECT NEXT STEPS — WHAT TO DO NOW\nVerify material claims independently.';
  const { stdout } = await runQa(bundle(report), report);
  const result = JSON.parse(stdout);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('v1 deterministic QA rejects report divergence and unsupported completed gaps', async () => {
  const report = '# MASTER SUMMARY — READ THIS FIRST\nCase summary.\n\n# DIRECT NEXT STEPS — WHAT TO DO NOW\nVerify material claims independently.';
  const bad = bundle(report, {
    unresolved_checks: [{
      unresolved_key: 'u1', description: 'Registry blocked', reason: 'timeout',
      attempted_methods: ['registry'], blocker: 'timeout', next_manual_action: 'retry',
    }],
  });
  await assert.rejects(
    runQa(bad, '# Different report'),
    (error) => {
      const parsed = JSON.parse(error.stdout);
      assert.equal(parsed.valid, false);
      assert.ok(parsed.errors.some((entry) => /report markdown mismatch/i.test(entry)));
      assert.ok(parsed.errors.some((entry) => /completed outcome cannot retain unresolved checks/i.test(entry)));
      return true;
    },
  );
});
