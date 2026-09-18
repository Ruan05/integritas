[Reading 53 lines from start (total: 53 lines, 0 remaining)]

import { validateInvestigationBundle } from './control-worker/src/bundle.mjs';

const MAX_AGENT_ENVELOPE_BYTES = 5 * 1024 * 1024;

function canonicalizeAgentBundle(bundle) {
  if (!bundle || Array.isArray(bundle) || typeof bundle !== 'object') return bundle;
  if (!Object.prototype.hasOwnProperty.call(bundle, 'metadata')) return bundle;

  // Some providers add a harmless top-level metadata object even when instructed
  // to return only the requested schema. Metadata is never trusted or persisted.
  // Remove only this one known non-canonical field; every other unknown field
  // remains subject to the strict bundle validator.
  const { metadata: _ignoredMetadata, ...canonical } = bundle;
  return canonical;
}

export function parseAgentBundle(stdout, manifest) {
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout) < 2 || Buffer.byteLength(stdout) > MAX_AGENT_ENVELOPE_BYTES) {
    throw new Error('agent exec envelope is invalid');
  }
  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new Error('agent exec envelope is not valid JSON');
  }
  if (!envelope || envelope.ok !== true || envelope.status !== 'ok' || typeof envelope.final !== 'string') {
    throw new Error('agent exec did not complete successfully');
  }
  const finalText = envelope.final.trim();
  let bundle;
  try {
    bundle = JSON.parse(finalText);
  } catch {
    throw new Error('agent final response must be raw JSON');
  }
  if (!bundle || Array.isArray(bundle) || typeof bundle !== 'object') {
    throw new Error('agent final response must be a JSON object');
  }
  bundle = canonicalizeAgentBundle(bundle);
  const reportMarkdown = bundle?.report?.markdown;
  validateInvestigationBundle(bundle, manifest, reportMarkdown);
  return {
    bundle,
    reportMarkdown,
    executionMeta: {
      model: typeof envelope.model === 'string' ? envelope.model : null,
      provider: typeof envelope.provider === 'string' ? envelope.provider : null,
      costUsd: typeof envelope.costUsd === 'number' ? envelope.costUsd : null,
      sessionId: typeof envelope.sessionId === 'string' ? envelope.sessionId : null,
    },
  };
}

[executed on device: integritas-openclaw-a1 (9d9982e8-9052-45b2-b91d-0faeaae0cc0d)]