import { validateInvestigationBundle } from './control-worker/src/bundle.mjs';

const MAX_AGENT_ENVELOPE_BYTES = 5 * 1024 * 1024;

export function parseSingleJsonObject(text, label = 'agent final response') {
  if (typeof text !== 'string') throw new Error(`${label} must contain one valid JSON object`);
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Providers occasionally wrap otherwise valid structured output in a single
    // Markdown JSON fence despite an explicit raw-JSON instruction.
  }

  const fenced = trimmed.match(/^\`\`\`(?:json)?\\s*([\\s\\S]*?)\\s*\`\`\`$/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      throw new Error(`${label} must contain one valid JSON object`);
    }
  }

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const prefix = trimmed.slice(0, first).trim();
    const suffix = trimmed.slice(last + 1).trim();
    const wrapperIsBounded = prefix.length <= 500 && suffix.length <= 500
      && !/[{}]/.test(prefix) && !/[{}]/.test(suffix);
    if (wrapperIsBounded) {
      try {
        return JSON.parse(trimmed.slice(first, last + 1));
      } catch {
        // Fall through to the single deterministic error below.
      }
    }
  }

  throw new Error(`${label} must contain one valid JSON object`);
}


function repairSingleMissingFindingKey(text) {
  const pattern = /(\{\s*)"([A-Za-z0-9][A-Za-z0-9._:-]{0,127})"\s*,(\s*"finding_type"\s*:)/g;
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) return null;
  return text.replace(pattern, '$1"finding_key":"$2",$3');
}

function canonicalizeReportFrontMatter(markdown) {
  if (typeof markdown !== 'string') return markdown;
  return markdown
    .replace(
      /^\s*(?:#{1,6}\s*)?MASTER\s+SUMMARY\s*[—-]\s*READ\s+THIS\s+FIRST\s*$/im,
      '# MASTER SUMMARY — READ THIS FIRST',
    )
    .replace(
      /^\s*(?:#{1,6}\s*)?DIRECT\s+NEXT\s+STEPS\s*[—-]\s*WHAT\s+TO\s+DO\s+NOW\s*$/im,
      '# DIRECT NEXT STEPS — WHAT TO DO NOW',
    );
}

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

  if (canonical.report && typeof canonical.report === 'object' && !Array.isArray(canonical.report)
    && typeof canonical.report.markdown === 'string') {
    const markdown = canonicalizeReportFrontMatter(canonical.report.markdown);
    if (markdown !== canonical.report.markdown) {
      canonical = { ...canonical, report: { ...canonical.report, markdown } };
    }
  }

  if (Array.isArray(canonical.sources) && Array.isArray(manifest?.documents)) {
    const documents = manifest.documents;
    let sourcesChanged = false;
    const sources = canonical.sources.map((source) => {
      if (!source || typeof source !== 'object' || Array.isArray(source)
        || source.evidence_origin !== 'submitted_document' || source.document_id != null) {
        return source;
      }
      const exactMatches = documents.filter((document) => document?.name === source.title);
      const match = exactMatches.length === 1 ? exactMatches[0] : (documents.length === 1 ? documents[0] : null);
      if (!match?.id) return source;
      sourcesChanged = true;
      return { ...source, document_id: match.id };
    });
    if (sourcesChanged) canonical = { ...canonical, sources };
  }

  const hasUnresolvedChecks = Array.isArray(canonical.unresolved_checks) && canonical.unresolved_checks.length > 0;
  const hasIncompleteChecks = Array.isArray(canonical.checks)
    && canonical.checks.some((check) => check && typeof check === 'object' && !Array.isArray(check) && check.status !== 'complete');
  if (canonical.execution?.terminal_outcome === 'completed' && (hasUnresolvedChecks || hasIncompleteChecks)) {
    canonical = {
      ...canonical,
      execution: { ...canonical.execution, terminal_outcome: 'incomplete' },
    };
  }

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
    bundle = parseSingleJsonObject(finalText);
  } catch (error) {
    const repaired = repairSingleMissingFindingKey(finalText);
    if (!repaired) throw error;
    bundle = parseSingleJsonObject(repaired, 'repaired agent final response');
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
