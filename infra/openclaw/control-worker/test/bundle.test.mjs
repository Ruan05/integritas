import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInvestigationBundle } from '../src/bundle.mjs';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';
const DOC_ID = '44444444-4444-4444-8444-444444444444';
const REPORT = '# Synthetic Integritas report\n\nEvidence-backed draft.';

const manifest = {
  case_id: CASE_ID,
  case_job_id: JOB_ID,
  case_revision: 7,
  depth: 'deep',
  documents: [{ id: DOC_ID, sha256: 'a'.repeat(64), size_bytes: 12, name: 'alpha.pdf' }],
};

function validBundle() {
  return {
    schema_version: 1,
    case_id: CASE_ID,
    case_job_id: JOB_ID,
    case_revision: 7,
    depth: 'deep',
    generated_at: '2026-09-17T12:00:00Z',
    entities: [
      { entity_key: 'person-a', entity_type: 'person', display_name: 'Alex Smith', aliases: [], identifiers: { passport: 'A1' }, match_status: 'proposed', confidence: 80 },
      { entity_key: 'person-b', entity_type: 'person', display_name: 'Alex Smith', aliases: ['A. Smith'], identifiers: { passport: 'B2' }, match_status: 'proposed', confidence: 70 },
    ],
    relationships: [],
    sources: [{
      source_key: 'source-alpha', source_type: 'document', title: 'Alpha evidence', document_id: DOC_ID,
      page_reference: '1', excerpt: 'Identity details appear on page one.', reliability_note: 'Submitted evidence',
      evidence_origin: 'submitted_document', retrieved_at: '2026-09-17T11:59:00Z',
    }],
    findings: [{
      finding_key: 'finding-1', entity_key: 'person-a', finding_type: 'identity', claim: 'Submitted identity data matches the named subject.',
      evidence_status: 'verified', materiality: 'informational', reliability: 'high',
      evidence_excerpt: 'Identity details appear on page one.', source_keys: ['source-alpha'],
    }],
    checks: [{
      check_key: 'check-1', entity_key: 'person-a', check_type: 'identity', description: 'Verify submitted identity data',
      priority: 'high', required_source: 'submitted document', status: 'complete', outcome: 'Matched submitted evidence',
    }],
    contradictions: [],
    unresolved_checks: [],
    limitations: [],
    report: { summary: 'Synthetic summary', markdown: REPORT, status: 'draft' },
    execution: {
      started_at: '2026-09-17T11:50:00Z', completed_at: '2026-09-17T12:00:00Z',
      stages: ['extracting', 'analyzing_documents', 'mapping_entities', 'planning_research', 'researching', 'verifying', 'cross_checking', 'independent_review', 'drafting_report'],
      tool_results: [], warnings: [], terminal_outcome: 'completed',
    },
  };
}

test('accepts a manifest-bound v1 bundle and preserves same-name entities as distinct keys', () => {
  const result = validateInvestigationBundle(validBundle(), manifest, REPORT);
  assert.equal(result.schema_version, 1);
  assert.equal(result.entities.length, 2);
  assert.equal(result.entities[0].display_name, result.entities[1].display_name);
  assert.notEqual(result.entities[0].entity_key, result.entities[1].entity_key);
});

test('rejects manifest identity mismatches and report divergence', () => {
  assert.throws(() => validateInvestigationBundle({ ...validBundle(), case_revision: 8 }, manifest, REPORT), /manifest mismatch/);
  assert.throws(() => validateInvestigationBundle(validBundle(), manifest, '# different'), /report markdown mismatch/);
});
test('rejects unknown fields, unresolved source keys, and signed URL leakage', () => {
  const unknown = { ...validBundle(), shell: 'rm -rf /' };
  assert.throws(() => validateInvestigationBundle(unknown, manifest, REPORT), /unknown bundle field/);

  const unresolved = validBundle();
  unresolved.findings[0].source_keys = ['missing-source'];
  assert.throws(() => validateInvestigationBundle(unresolved, manifest, REPORT), /unknown source key/);

  const leaked = validBundle();
  leaked.sources[0].excerpt = 'https://project.supabase.co/storage/v1/object/sign/private/token';
  assert.throws(() => validateInvestigationBundle(leaked, manifest, REPORT), /signed URL/);
});

test('rejects oversized excerpts and non-draft reports', () => {
  const oversized = validBundle();
  oversized.sources[0].excerpt = 'x'.repeat(9000);
  assert.throws(() => validateInvestigationBundle(oversized, manifest, REPORT), /excerpt too large/);

  const finalized = validBundle();
  finalized.report.status = 'finalized';
  assert.throws(() => validateInvestigationBundle(finalized, manifest, REPORT), /report status must be draft/);
});
