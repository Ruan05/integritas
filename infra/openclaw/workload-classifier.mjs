import { readFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_DETERMINISTIC_TEXT_BYTES = 8 * 1024;
const SYNTHETIC_MARKER = /\b(?:synthetic|test control|test fixture|regression fixture|no real[- ]world|no real person|no real company|no real entit(?:y|ies)|no confidential data)\b/i;
const EMPTY_SUBJECT = /^(?:none|n\/a|not applicable|synthetic|test(?: control| fixture)?)$/i;
const GENERIC_SUBJECT_SCOPE = /^(?:people,? companies,? representatives,? identifiers? and relationships? identified in (?:the )?submitted evidence|people,? companies,? representatives,? identifiers? and relationships? identified in (?:the )?evidence|entities? identified in (?:the )?submitted evidence|subjects? identified in (?:the )?submitted evidence)[.]?$/i;
const SYNTHETIC_CONTROL_SUMMARY = /synthetic test control document/i;
function isExplicitSyntheticControlSummary(row) {
  if (!row || typeof row !== 'object') return false;
  const text = [
    row.document_type,
    ...(Array.isArray(row.material_terms) ? row.material_terms : []),
    ...(Array.isArray(row.risk_flags) ? row.risk_flags : []),
    row.evidence_excerpt,
  ].filter((value) => typeof value === 'string').join(' ');
  return SYNTHETIC_CONTROL_SUMMARY.test(text)
    && /no real (?:person|company|identifier|entity|world)|no confidential data/i.test(text);
}
const INVESTIGABLE_TOKEN = new RegExp([
  'https?://',
  '[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}',
  '\\b(?:IBAN|SWIFT|BIC|IMO|passport|registration(?: number)?|company number|tax number|VAT|licen[cs]e)\\b',
  '\\b(?:MT103|MT199|MT700|MT760|MT799|SBLC|letter of credit|bank guarantee)\\b',
  '\\b(?:USD|EUR|GBP|ZAR|TRY|AED|KZT)\\s*[0-9]',
  '\\b[0-9]+(?:\\.[0-9]+)?\\s*(?:barrels?|bbl|metric tons?|mt|tonnes?|litres?|gallons?)\\b',
  '\\b(?:Ltd|Limited|LLC|LLP|Inc|Corp|Corporation|GmbH|FZE|FZC|Pty)\\b',
].join('|'), 'i');

function values(row, key) {
  return Array.isArray(row?.[key]) ? row[key].filter((value) => String(value).trim().length > 0) : [];
}

function summarySignalCount(documentSummaries) {
  let count = 0;
  for (const row of documentSummaries) {
    count += values(row, 'parties').length;
    count += values(row, 'identifiers').length;
    count += values(row, 'material_terms').length;
    count += values(row, 'risk_flags').length;
    if (row?.instruction_like_text === true) count += 1;
  }
  return count;
}

function intendedSubjectRequiresResearch(manifest) {
  const subject = String(manifest?.case?.intended_subjects ?? '').trim();
  if (!subject) return false;
  if (EMPTY_SUBJECT.test(subject) || GENERIC_SUBJECT_SCOPE.test(subject) || SYNTHETIC_MARKER.test(subject)) return false;
  return true;
}

async function readDeterministicText(jobDir, document) {
  if (document?.mime_type !== 'text/plain') return { eligible: false, text: '' };
  if (!Number.isFinite(document?.size_bytes) || document.size_bytes > MAX_DETERMINISTIC_TEXT_BYTES) {
    return { eligible: false, text: '' };
  }
  const relative = String(document.local_path ?? '');
  if (!relative || relative.includes('..') || path.isAbsolute(relative)) return { eligible: false, text: '' };
  const fullPath = path.join(jobDir, relative);
  const text = await readFile(fullPath, 'utf8');
  return { eligible: true, text };
}

function deterministicSummary(document, text) {
  const trimmed = text.trim();
  return {
    document_id: document.id,
    document_type: trimmed ? 'synthetic test control' : 'empty text control',
    issuer_claim: '',
    parties: [],
    identifiers: [],
    material_terms: [],
    risk_flags: [],
    instruction_like_text: false,
    evidence_excerpt: trimmed.slice(0, 500),
  };
}

export async function classifyDeterministicTextPreflight({ manifest, jobDir }) {
  const metrics = {
    documents: Array.isArray(manifest?.documents) ? manifest.documents.length : 0,
    deterministic_text_documents: 0,
    explicit_subject: intendedSubjectRequiresResearch(manifest),
  };
  if (!metrics.documents) return { route: 'substantive', reason_code: 'no_documents', metrics, document_summaries: [] };
  if (metrics.explicit_subject) return { route: 'substantive', reason_code: 'explicit_subject_present', metrics, document_summaries: [] };

  const summaries = [];
  for (const document of manifest.documents) {
    let inspected;
    try {
      inspected = await readDeterministicText(jobDir, document);
    } catch {
      return { route: 'substantive', reason_code: 'deterministic_text_read_failed', metrics, document_summaries: [] };
    }
    if (!inspected.eligible) {
      return { route: 'substantive', reason_code: 'document_not_safe_for_short_circuit', metrics, document_summaries: [] };
    }
    metrics.deterministic_text_documents += 1;
    const text = inspected.text.trim();
    if (text && !SYNTHETIC_MARKER.test(text)) {
      return { route: 'substantive', reason_code: 'nonempty_unmarked_document', metrics, document_summaries: [] };
    }
    if (text && INVESTIGABLE_TOKEN.test(text)) {
      return { route: 'substantive', reason_code: 'deterministic_investigable_token_present', metrics, document_summaries: [] };
    }
    if (/\b(?:ignore (?:all |previous |prior )?(?:instructions|rules)|system prompt|developer message|reveal (?:secrets|credentials))\b/i.test(text)) {
      return { route: 'substantive', reason_code: 'instruction_like_text_present', metrics, document_summaries: [] };
    }
    summaries.push(deterministicSummary(document, inspected.text));
  }

  return {
    route: 'no_investigable_evidence',
    reason_code: 'deterministic_text_preflight_no_investigable_evidence',
    metrics,
    document_summaries: summaries,
  };
}

export async function classifyInvestigationWorkload({ manifest, documentSummaries, jobDir }) {
  const metrics = {
    documents: Array.isArray(manifest?.documents) ? manifest.documents.length : 0,
    extracted_signals: summarySignalCount(documentSummaries),
    deterministic_text_documents: 0,
    explicit_subject: intendedSubjectRequiresResearch(manifest),
  };

  const explicitSyntheticControl = documentSummaries.length === metrics.documents
    && documentSummaries.length > 0
    && documentSummaries.every(isExplicitSyntheticControlSummary);
  if (explicitSyntheticControl && !metrics.explicit_subject) {
    return { route: 'no_investigable_evidence', reason_code: 'synthetic_control_document', metrics };
  }
  if (metrics.extracted_signals > 0) {
    return { route: 'substantive', reason_code: 'extracted_evidence_present', metrics };
  }
  if (metrics.explicit_subject) {
    return { route: 'substantive', reason_code: 'explicit_subject_present', metrics };
  }
  if (!metrics.documents || documentSummaries.length !== metrics.documents) {
    return { route: 'substantive', reason_code: 'coverage_not_proven', metrics };
  }

  for (const document of manifest.documents) {
    let inspected;
    try {
      inspected = await readDeterministicText(jobDir, document);
    } catch {
      return { route: 'substantive', reason_code: 'deterministic_text_read_failed', metrics };
    }
    if (!inspected.eligible) {
      return { route: 'substantive', reason_code: 'document_not_safe_for_short_circuit', metrics };
    }
    metrics.deterministic_text_documents += 1;
    const text = inspected.text.trim();
    if (!text) continue;
    if (!SYNTHETIC_MARKER.test(text)) {
      return { route: 'substantive', reason_code: 'nonempty_unmarked_document', metrics };
    }
    if (INVESTIGABLE_TOKEN.test(text)) {
      return { route: 'substantive', reason_code: 'deterministic_investigable_token_present', metrics };
    }
  }

  return { route: 'no_investigable_evidence', reason_code: 'no_investigable_evidence', metrics };
}

export function buildNoEvidenceReport({ manifest, workload }) {
  const documentCount = manifest.documents.length;
  return `# MASTER SUMMARY — READ THIS FIRST

This case contains ${documentCount} submitted document(s). Deterministic intake and evidence classification found no real-world entity, material claim, transaction term, usable identifier, contradiction, or explicit subject requiring external verification. The case therefore stopped before research planning, external browsing, independent model criticism, or maximum-depth narrative expansion.

**Diligence status:** completed for the evidence actually supplied. This does not clear any person, company, transaction, product, bank account, asset, or authority that was not present in the evidence.

## DIRECT NEXT STEPS — WHAT TO DO NOW

No external due-diligence action is required for the current evidence package. Archive this run as a control/regression result. If substantive evidence or an explicit subject is later added, increment the case revision and run a new evidence-proportional investigation.

## Evidence and execution note

- Route: \`${workload.route}\`
- Reason: \`${workload.reason_code}\`
- Submitted documents: ${documentCount}
- Extracted investigable signals: ${workload.metrics.extracted_signals}
- External research calls: 0
- Independent critic calls: 0
- Research/report synthesis model calls after classification: 0

The uploaded documents remain preserved as submitted evidence with their existing hashes and provenance. The result is intentionally compact because no substantive subject or transaction was present to investigate.
`;
}
