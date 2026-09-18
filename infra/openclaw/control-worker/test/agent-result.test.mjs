[Reading 74 lines from start (total: 74 lines, 0 remaining)]

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

[executed on device: integritas-openclaw-a1 (9d9982e8-9052-45b2-b91d-0faeaae0cc0d)]