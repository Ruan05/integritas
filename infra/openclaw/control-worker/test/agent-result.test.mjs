import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAgentBundle } from '../../agent-result.mjs';

const manifest = {
  case_id: '11111111-1111-4111-8111-111111111111',
  case_job_id: '22222222-2222-4222-8222-222222222222',
  case_revision: 7,
  depth: 'deep',
  documents: [],
};

function bundle() {
  const report = '# Draft report';
  return {
    schema_version: 1,
    case_id: manifest.case_id,
    case_job_id: manifest.case_job_id,
    case_revision: manifest.case_revision,
    depth: manifest.depth,
    generated_at: '2026-09-18T08:00:00Z',
    entities: [], relationships: [], sources: [], findings: [], checks: [],
    contradictions: [], unresolved_checks: [], limitations: [],
    report: { summary: 'Summary', markdown: report, status: 'draft' },
    execution: {
      started_at: '2026-09-18T07:59:00Z',
      completed_at: '2026-09-18T08:00:00Z',
      stages: ['analyzing_documents'],
      tool_results: [],
      warnings: [],
      terminal_outcome: 'incomplete',
    },
  };
}

test('parses raw v1 JSON from successful agent-exec envelope', () => {
  const value = bundle();
  const envelope = JSON.stringify({
    ok: true, status: 'ok', final: JSON.stringify(value),
    model: 'glm-5.3-flash', provider: 'opencode-go',
  });
  const parsed = parseAgentBundle(envelope, manifest);
  assert.deepEqual(parsed.bundle, value);
  assert.equal(parsed.reportMarkdown, '# Draft report');
});

test('rejects prose, code fences, failed envelopes, and manifest mismatches', () => {
  const value = bundle();
  assert.throws(() => parseAgentBundle(JSON.stringify({ ok: true, status: 'ok', final: 'Here is the result: ' + JSON.stringify(value) }), manifest), /final response must be raw JSON/);
  const fenced = String.fromCharCode(96,96,96) + 'json\n' + JSON.stringify(value) + '\n' + String.fromCharCode(96,96,96);
  assert.throws(() => parseAgentBundle(JSON.stringify({ ok: true, status: 'ok', final: fenced }), manifest), /final response must be raw JSON/);
  assert.throws(() => parseAgentBundle(JSON.stringify({ ok: false, status: 'error', final: '' }), manifest), /agent exec did not complete successfully/);
  value.case_revision = 8;
  assert.throws(() => parseAgentBundle(JSON.stringify({ ok: true, status: 'ok', final: JSON.stringify(value) }), manifest), /bundle manifest mismatch/);
});

test('drops only provider-added top-level metadata before strict validation', () => {
  const value = bundle();
  value.metadata = { provider_note: 'non-canonical provider bookkeeping' };
  const envelope = JSON.stringify({
    ok: true, status: 'ok', final: JSON.stringify(value),
    model: 'nvidia/nemotron-3-ultra-550b-a55b', provider: 'nvidia',
  });
  const parsed = parseAgentBundle(envelope, manifest);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.bundle, 'metadata'), false);
  assert.equal(parsed.bundle.schema_version, 1);

  const bad = bundle();
  bad.unexpected = {};
  assert.throws(
    () => parseAgentBundle(JSON.stringify({ ok: true, status: 'ok', final: JSON.stringify(bad) }), manifest),
    /unknown bundle field: unexpected/,
  );
});
test('fills an unambiguous submitted document_id from the signed manifest', () => {
  const oneDocumentManifest = {
    ...manifest,
    documents: [{ id: '44444444-4444-4444-8444-444444444444', name: 'alpha.pdf' }],
  };
  const value = bundle();
  value.sources = [{
    source_key: 'source-alpha',
    source_type: 'document',
    title: 'alpha.pdf',
    excerpt: 'Submitted evidence.',
    reliability_note: 'Submitted document.',
    evidence_origin: 'submitted_document',
    retrieved_at: '2026-09-18T08:00:00Z',
  }];
  const parsed = parseAgentBundle(
    JSON.stringify({ ok: true, status: 'ok', final: JSON.stringify(value) }),
    oneDocumentManifest,
  );
  assert.equal(parsed.bundle.sources[0].document_id, oneDocumentManifest.documents[0].id);
});

test('matches a missing submitted document_id by exact title when multiple documents exist', () => {
  const multiManifest = {
    ...manifest,
    documents: [
      { id: '44444444-4444-4444-8444-444444444444', name: 'alpha.pdf' },
      { id: '55555555-5555-4555-8555-555555555555', name: 'beta.pdf' },
    ],
  };
  const value = bundle();
  value.sources = [{
    source_key: 'source-beta',
    source_type: 'document',
    title: 'beta.pdf',
    excerpt: 'Submitted evidence.',
    reliability_note: 'Submitted document.',
    evidence_origin: 'submitted_document',
    retrieved_at: '2026-09-18T08:00:00Z',
  }];
  const parsed = parseAgentBundle(
    JSON.stringify({ ok: true, status: 'ok', final: JSON.stringify(value) }),
    multiManifest,
  );
  assert.equal(parsed.bundle.sources[0].document_id, multiManifest.documents[1].id);
});

test('rejects ambiguous submitted evidence when document_id cannot be inferred safely', () => {
  const multiManifest = {
    ...manifest,
    documents: [
      { id: '44444444-4444-4444-8444-444444444444',  name: 'alpha.pdf' },
      { id: '55555555-5555-4555-8555-555555555555', name: 'beta.pdf' },
    ],
  };
  const value = bundle();
  value.sources = [{
    source_key: 'source-ambiguous',
    source_type: 'document',
    title: 'Evidence',
    excerpt: 'Submitted evidence.',
    reliability_note: 'Submitted document.',
    evidence_origin: 'submitted_document',
    retrieved_at: '2026-09-18T08:00:00Z',
  }];
  assert.throws(
    () => parseAgentBundle(JSON.stringify({ ok: true, status: 'ok', final: JSON.stringify(value) }), multiManifest),
    /submitted document evidence requires a document_id/,
  );
});
