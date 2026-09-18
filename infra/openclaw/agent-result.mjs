import { validateInvestigationBundle } from './control-worker/src/bundle.mjs';

const MAX_AGENT_ENVELOPE_BYTES = 5 * 1024 * 1024;

function canonicalizeAgentBundle(bundle, manifest) {
  if (!bundle || Array.isArray(bundle) || typeof bundle !== 'object') return bundle;

  // Some providers add a harmless top-level metadata object even when instructed
  // to return only the requested schema. Metadata is never trusted or persisted.
  // Remove only this one known non-canonical field; every other unknown field
  // remains subject to the strict bundle validator.
  let canonical = bundle;
  if (Object.prototype.hasOwnProperty.call(canonical, 'metadata')) {
    const { metadata: _ignoredMetadata, ...withoutMetadata } = canonical;
    canonical = withoutMetadata;
  }

  if (!Array.isArray(canonical.sources) || !Array.isArray(manifest?.documents)) return canonical;
  const documents = manifest.documents;
  let changed = false;
  const sources = canonical.sources.map((source) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)
      || source.evidence_origin !== 'submitted_document' || source.document_id != null) {
      return source;
    }
    const exactMatches = documents.filter((document) => document?.name === source.title);
    const match = exactMatches.length === 1 ? exactMatches[0] : (documents.length === 1 ? documents[0] : null);
    if (!match?.id) return source;
    changed = true;
    return { ...source, document_id: match.id };
  });
  return changed ? { ...canonical, sources } : canonical;
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
  bundle = canonicalizeAgentBundle(bundle, manifest);
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
