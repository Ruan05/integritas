import { validateInvestigationBundle } from './control-worker/src/bundle.mjs';

const MAX_AGENT_ENVELOPE_BYTES = 5 * 1024 * 1024;

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
