import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const QA = path.join(REPO_ROOT, 'tools/dd/quality_v1.py');
const CASE_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';
const DOC_ID = '44444444-4444-4444-8444-444444444444';

function baseBundle(report) {
  return {
    schema_version: 1,
    case_id: CASE_ID,
    case_job_id: JOB_ID,
    case_revision: 7,
    depth: 'deep',
    generated_at: '2026-09-18T05:00:00Z',
    entities: [], relationships: [], sources: [{
      source_key: 'submitted-doc-1',
      source_type: 'document',
      title: 'synthetic.pdf',
      url: null,
      document_id: DOC_ID,
      page_reference: 'p.1',
      excerpt: 'Synthetic submitted evidence.',
      reliability_note: 'Submitted evidence; authenticity not assumed.',
      evidence_origin: 'submitted_document',
      retrieved_at: '2026-09-18T04:00:00Z',
    }], findings: [], checks: [],
    contradictions: [], unresolved_checks: [], limitations: [],
    report: { summary: 'Synthetic', markdown: report, status: 'draft' },
    execution: {
      started_at: '2026-09-18T04:00:00Z',
      completed_at: '2026-09-18T05:00:00Z',
      stages: ['extracting', 'verifying'],
      tool_results: [],
      warnings: [],
      terminal_outcome: 'completed',
    },
  };
}

async function runQa(bundle) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'integritas-qa-'));
  const report = bundle.report.markdown;
  const manifest = {
    case_id: CASE_ID, case_job_id: JOB_ID, case_revision: 7, depth: 'deep',
    documents: [{ id: DOC_ID, sha256: 'a'.repeat(64), size_bytes: 12 }],
  };
  await writeFile(path.join(dir, 'bundle.json'), JSON.stringify(bundle));
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(path.join(dir, 'report.md'), report);
  const result = spawnSync('/usr/bin/python3', [
    QA, path.join(dir, 'bundle.json'),
    '--manifest', path.join(dir, 'manifest.json'),
    '--report', path.join(dir, 'report.md'),
    '--current-revision', '7',
  ], { encoding: 'utf8' });
  await rm(dir, { recursive: true, force: true });
  return result;
}

test('v1 deterministic QA accepts a structurally valid bundle', async () => {
  const result = await runQa(baseBundle('# Synthetic report'));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const body = JSON.parse(result.stdout);
  assert.equal(body.valid, true);
});
test('v1 deterministic QA rejects verified findings without source evidence', async () => {
  const bundle = baseBundle('# Synthetic report');
  bundle.entities.push({
    entity_key: 'entity-1', entity_type: 'company', display_name: 'Example',
    aliases: [], identifiers: {}, match_status: 'verified', confidence: 90,
  });
  bundle.findings.push({
    finding_key: 'finding-1', entity_key: 'entity-1', finding_type: 'identity',
    claim: 'Verified claim', evidence_status: 'verified', materiality: 'high',
    reliability: 'high', evidence_excerpt: 'Claimed evidence', source_keys: [],
  });
  const result = await runQa(bundle);
  assert.notEqual(result.status, 0);
  const body = JSON.parse(result.stdout);
  assert.equal(body.valid, false);
  assert.ok(body.errors.some((error) => error.includes('verified finding requires a source')));
});
