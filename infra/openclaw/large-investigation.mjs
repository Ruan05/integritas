import { parseSingleJsonObject } from './agent-result.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function fail(message) { throw new Error(message); }
function obj(value, label) {
  if (!value || Array.isArray(value) || typeof value !== 'object') fail(`${label} must be an object`);
  return value;
}
function arr(value, label, max = 1000) {
  if (!Array.isArray(value) || value.length > max) fail(`${label} must be an array`);
  return value;
}
function str(value, label, max = 4000, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && value.length < 1) || value.length > max) fail(`${label} is invalid`);
  return value;
}
function enumValue(value, allowed, label) {
  if (!allowed.includes(value)) fail(`${label} is invalid`);
  return value;
}
function stringArray(value, label, maxItems = 40, maxLength = 1000) {
  const rows = arr(value, label, maxItems);
  for (const row of rows) str(row, label, maxLength, true);
  return rows;
}
function plannerNarrativeArray(value, label, kind, maxItems = 80, maxLength = 1500) {
  const rows = arr(value, label, maxItems);
  return rows.map((row0, index) => {
    if (typeof row0 === 'string') return str(row0, label, maxLength, true);
    const row = obj(row0, `${label} ${index}`);
    if (kind === 'cross_document_test') {
      allowedKeys(row, new Set(['test_id','description','expected_outcome']), `${label} ${index}`);
      str(row.test_id, `${label} ${index} test_id`, 160);
      str(row.description, `${label} ${index} description`, 1000);
      str(row.expected_outcome, `${label} ${index} expected_outcome`, 1000, true);
      return str(`[${row.test_id}] ${row.description} Expected outcome: ${row.expected_outcome}`, label, maxLength, true);
    }
    if (kind === 'specialist_check') {
      allowedKeys(row, new Set(['check_id','specialist','required_action','trigger_condition']), `${label} ${index}`);
      str(row.check_id, `${label} ${index} check_id`, 160);
      str(row.specialist, `${label} ${index} specialist`, 300);
      str(row.required_action, `${label} ${index} required_action`, 1000);
      str(row.trigger_condition, `${label} ${index} trigger_condition`, 1000, true);
      return str(`[${row.check_id}] ${row.specialist}: ${row.required_action} Trigger: ${row.trigger_condition}`, label, maxLength, true);
    }
    fail(`${label} ${index} has unsupported structured shape`);
  });
}
function allowedKeys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label} contains unknown field ${key}`);
}
function key(value, label) {
  if (typeof value !== 'string' || !KEY.test(value)) fail(`${label} is invalid`);
  return value;
}
function confidence(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) fail(`${label} is invalid`);
  return value;
}
function isoDate(value, label) {
  str(value, label, 80);
  if (Number.isNaN(Date.parse(value))) fail(`${label} is invalid`);
  return value;
}
function uniqueBy(rows, field, label) {
  const seen = new Set();
  for (const row of rows) {
    const value = row[field];
    if (seen.has(value)) fail(`${label} contains duplicate ${field}`);
    seen.add(value);
  }
  return rows;
}
export function documentSourceKey(documentId) {
  if (!UUID.test(documentId)) fail('document id is invalid');
  return `doc.${documentId.replaceAll('-', '')}`;
}

export function shouldUseLargeInvestigation(manifest) {
  const count = Array.isArray(manifest?.documents) ? manifest.documents.length : 0;
  return manifest?.depth === 'maximum' || count >= 8;
}

export function buildDocumentShards(manifest, shardSize = 4) {
  const documents = arr(manifest?.documents, 'manifest documents', 20);
  if (documents.length < 1) fail('manifest documents are empty');
  if (!Number.isInteger(shardSize) || shardSize < 1 || shardSize > 6) fail('invalid shard size');
  const shards = [];
  for (let i = 0; i < documents.length; i += shardSize) {
    shards.push({
      shard_id: `d${String(shards.length + 1).padStart(2, '0')}`,
      documents: documents.slice(i, i + shardSize).map((row) => ({
        id: row.id,
        name: row.name,
        local_path: row.local_path,
        mime_type: row.mime_type,
        sha256: row.sha256,
        size_bytes: row.size_bytes,
      })),
    });
  }
  return shards;
}

function flattenShardEvidenceValue(value, maxLength, path = '', depth = 0) {
  const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const leaf = clean(value);
    return (path ? `${path}=${leaf}` : leaf).slice(0, maxLength);
  }
  if (depth >= 3) {
    const fallback = clean(JSON.stringify(value));
    return (path ? `${path}=${fallback}` : fallback).slice(0, maxLength);
  }
  if (Array.isArray(value)) {
    const rows = value.map((item, index) => flattenShardEvidenceValue(item, maxLength, path ? `${path}[${index}]` : '', depth + 1))
      .filter(Boolean);
    return rows.join('; ').slice(0, maxLength);
  }
  if (typeof value === 'object') {
    const rows = Object.entries(value).flatMap(([key, item]) => {
      const next = path ? `${path}.${key}` : key;
      const text = flattenShardEvidenceValue(item, maxLength, next, depth + 1);
      return text ? [text] : [];
    });
    return rows.join('; ').slice(0, maxLength);
  }
  return '';
}

function normalizeShardEvidenceArray(value, label, maxItems, maxLength) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  const normalized = value.slice(0, maxItems).map((item) => flattenShardEvidenceValue(item, maxLength))
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((item) => item.slice(0, maxLength));
  if (normalized.length > maxItems) fail(`${label} exceeds maximum items`);
  return normalized;
}

export function parseDocumentShardFinal(finalText, expectedDocumentIds) {
  const parsed = obj(parseSingleJsonObject(finalText, 'document shard final response'), 'document shard');
  allowedKeys(parsed, new Set(['documents']), 'document shard');
  const expected = new Set(expectedDocumentIds);
  const rows = arr(parsed.documents, 'document shard documents', 6);
  if (rows.length !== expected.size) fail('document shard must cover every expected document exactly once');
  const seen = new Set();
  for (const [index, row0] of rows.entries()) {
    const row = obj(row0, `document shard row ${index}`);
    allowedKeys(row, new Set([
      'document_id', 'document_type', 'issuer_claim', 'parties', 'identifiers',
      'material_terms', 'risk_flags', 'instruction_like_text', 'evidence_excerpt', 'page_references',
    ]), `document shard row ${index}`);
    if (!UUID.test(row.document_id) || !expected.has(row.document_id) || seen.has(row.document_id)) {
      fail(`document shard row ${index} document_id is invalid`);
    }
    seen.add(row.document_id);
    str(row.document_type, 'document_type', 160);
    str(row.issuer_claim, 'issuer_claim', 500, true);
    // Some capable vision models return richer JSON objects despite the compact-string
    // contract. Normalize those bounded structures deterministically rather than
    // discarding a successful page-level extraction and exhausting provider fallbacks.
    row.parties = normalizeShardEvidenceArray(row.parties, 'parties', 30, 500);
    row.identifiers = normalizeShardEvidenceArray(row.identifiers, 'identifiers', 60, 500);
    row.material_terms = normalizeShardEvidenceArray(row.material_terms, 'material_terms', 40, 700);
    row.risk_flags = normalizeShardEvidenceArray(row.risk_flags, 'risk_flags', 30, 700);
    stringArray(row.parties, 'parties', 30, 500);
    stringArray(row.identifiers, 'identifiers', 60, 500);
    stringArray(row.material_terms, 'material_terms', 40, 700);
    stringArray(row.risk_flags, 'risk_flags', 30, 700);
    if (typeof row.instruction_like_text !== 'boolean') fail('instruction_like_text is invalid');
    // Provider output is untrusted and may exceed the requested bound. Keep the
    // evidence excerpt useful while enforcing the canonical bundle size deterministically.
    if (typeof row.evidence_excerpt === 'string') row.evidence_excerpt = row.evidence_excerpt.slice(0, 500);
    str(row.evidence_excerpt, 'evidence_excerpt', 500, true);
    if (row.page_references == null) row.page_references = [];
    stringArray(row.page_references, 'page_references', 100, 600);
  }
  return { documents: rows };
}

export function buildSubmittedSources(manifest, documentSummaries, retrievedAt) {
  isoDate(retrievedAt, 'retrievedAt');
  const summaryById = new Map(documentSummaries.map((row) => [row.document_id, row]));
  return manifest.documents.map((document) => {
    const summary = summaryById.get(document.id);
    if (!summary) fail(`missing document summary for ${document.id}`);
    const detailLines = [
      `Document type: ${summary.document_type || 'not classified'}`,
      `Issuer claim: ${summary.issuer_claim || 'not stated'}`,
      `Parties: ${(summary.parties ?? []).join('; ') || 'not extracted'}`,
      `Identifiers: ${(summary.identifiers ?? []).join('; ') || 'not extracted'}`,
      `Material terms: ${(summary.material_terms ?? []).join('; ') || 'not extracted'}`,
      `Forensic/risk signals: ${(summary.risk_flags ?? []).join('; ') || 'none recorded'}`,
      `Page evidence: ${(summary.page_references ?? []).join(' | ') || 'not supplied'}`,
      `Evidence excerpt: ${summary.evidence_excerpt ?? ''}`,
    ];
    const pageNumbers = [...new Set((summary.page_references ?? []).flatMap((value) =>
      [...String(value).matchAll(/(?:^|\b)p(?:age)?\.?\s*(\d{1,4})\b/gi)].map((match) => Number(match[1]))
    ))].filter((value) => Number.isInteger(value) && value > 0).sort((a, b) => a - b);
    return {
      source_key: documentSourceKey(document.id),
      source_type: 'document',
      title: document.name,
      url: null,
      document_id: document.id,
      page_reference: pageNumbers.length ? pageNumbers.map((value) => `p.${value}`).join(', ') : null,
      excerpt: detailLines.join('\\n'),
      reliability_note: 'Submitted evidence; authenticity and claims require independent verification unless otherwise established.',
      evidence_origin: 'submitted_document',
      verification_state: 'submitted',
      retrieved_at: retrievedAt,
    };
  });
}

export function parseLargePlanFinal(finalText, { allowZeroLanes = false } = {}) {
  const parsed = obj(parseSingleJsonObject(finalText, 'large plan final response'), 'large plan');
  allowedKeys(parsed, new Set([
    'case_profile', 'research_lanes', 'cross_document_tests', 'specialist_checks', 'automatic_stop_conditions',
  ]), 'large plan');
  const profile = obj(parsed.case_profile, 'large plan case_profile');
  allowedKeys(profile, new Set([
    'case_type', 'jurisdictions', 'assets_or_products', 'incoterms',
    'payment_instruments', 'critical_transaction_features',
  ]), 'large plan case_profile');
  str(profile.case_type, 'case_type', 240);
  stringArray(profile.jurisdictions, 'jurisdictions', 30, 240);
  stringArray(profile.assets_or_products, 'assets_or_products', 30, 500);
  stringArray(profile.incoterms, 'incoterms', 20, 160);
  stringArray(profile.payment_instruments, 'payment_instruments', 30, 240);
  stringArray(profile.critical_transaction_features, 'critical_transaction_features', 60, 1200);

  const lanes = arr(parsed.research_lanes, 'research_lanes', 16);
  if (!allowZeroLanes && lanes.length < 1) fail('large plan requires at least one research lane');
  const seen = new Set();
  for (const row0 of lanes) {
    const row = obj(row0, 'research lane');
    allowedKeys(row, new Set([
      'lane_id', 'priority', 'question', 'preferred_sources', 'fallback_sources',
      'tools', 'search_identifiers', 'stop_condition', 'manual_only',
    ]), 'research lane');
    key(row.lane_id, 'lane_id');
    if (seen.has(row.lane_id)) fail('duplicate lane_id');
    seen.add(row.lane_id);
    enumValue(row.priority, ['critical','high','medium','low'], 'lane priority');
    str(row.question, 'lane question', 2000);
    stringArray(row.preferred_sources, 'preferred_sources', 20, 500);
    stringArray(row.fallback_sources, 'fallback_sources', 20, 500);
    stringArray(row.tools, 'lane tools', 12, 80);
    stringArray(row.search_identifiers, 'search_identifiers', 40, 500);
    str(row.stop_condition, 'stop_condition', 1500);
    if (typeof row.manual_only !== 'boolean') fail('lane manual_only is invalid');
  }
  parsed.cross_document_tests = plannerNarrativeArray(
    parsed.cross_document_tests, 'cross_document_tests', 'cross_document_test', 80, 1500,
  );
  parsed.specialist_checks = plannerNarrativeArray(
    parsed.specialist_checks, 'specialist_checks', 'specialist_check', 80, 1500,
  );
  stringArray(parsed.automatic_stop_conditions, 'automatic_stop_conditions', 60, 1500);
  return parsed;
}

export function buildCompatiblePlan(documentSummaries, largePlan) {
  return {
    document_profiles: documentSummaries.map((row) => ({
      document_id: row.document_id,
      document_type: row.document_type,
      purpose: row.material_terms.slice(0, 4).join('; ') || 'Submitted evidence requiring due-diligence assessment.',
      issuer_claim: row.issuer_claim,
      parties: row.parties,
      material_identifiers: row.identifiers,
      material_terms: row.material_terms,
      priority_questions: row.risk_flags,
    })),
    case_profile: largePlan.case_profile,
    research_lanes: largePlan.research_lanes,
    cross_document_tests: largePlan.cross_document_tests,
    specialist_checks: largePlan.specialist_checks,
    automatic_stop_conditions: largePlan.automatic_stop_conditions,
  };
}

export function parseCaseAnalysisFinal(finalText, allowedDocumentSourceKeys) {
  const parsed = obj(parseSingleJsonObject(finalText, 'case analysis final response'), 'case analysis');
  allowedKeys(parsed, new Set([
    'entities', 'relationships', 'findings', 'contradictions', 'unresolved_checks', 'limitations',
  ]), 'case analysis');
  const entities = arr(parsed.entities, 'entities', 60);
  const entityKeys = new Set();
  for (const [i, row0] of entities.entries()) {
    const row = obj(row0, `entity ${i}`);
    allowedKeys(row, new Set(['entity_key','entity_type','display_name','aliases','identifiers','match_status','confidence']), `entity ${i}`);
    key(row.entity_key, 'entity_key');
    if (entityKeys.has(row.entity_key)) fail('duplicate entity_key');
    entityKeys.add(row.entity_key);
    enumValue(row.entity_type, ['person','company','organization','bank','vessel','other'], 'entity_type');
    str(row.display_name, 'display_name', 240);
    stringArray(row.aliases, 'aliases', 50, 240);
    obj(row.identifiers, 'identifiers');
    enumValue(row.match_status, ['proposed','probable','verified','conflicting','rejected'], 'match_status');
    confidence(row.confidence, 'confidence');
  }
  const allowedSources = new Set(allowedDocumentSourceKeys);
  const relationships = arr(parsed.relationships, 'relationships', 80);
  uniqueBy(relationships, 'relationship_key', 'relationships');
  for (const row0 of relationships) {
    const row = obj(row0, 'relationship');
    allowedKeys(row, new Set(['relationship_key','from_entity_key','to_entity_key','relationship_type','claim','evidence_status','source_keys','confidence']), 'relationship');
    key(row.relationship_key, 'relationship_key');
    if (!entityKeys.has(row.from_entity_key) || !entityKeys.has(row.to_entity_key)) fail('relationship entity key is unknown');
    str(row.relationship_type, 'relationship_type', 160);
    str(row.claim, 'relationship claim', 2000, true);
    enumValue(row.evidence_status, ['verified','alleged','conflicting','uncertain'], 'relationship evidence_status');
    for (const sourceKey of stringArray(row.source_keys, 'relationship source_keys', 40, 128)) if (!allowedSources.has(sourceKey)) fail('relationship source key is unknown');
    confidence(row.confidence, 'relationship confidence');
  }
  const findings = arr(parsed.findings, 'findings', 60);
  uniqueBy(findings, 'finding_key', 'findings');
  const findingKeys = new Set();
  for (const row0 of findings) {
    const row = obj(row0, 'finding');
    allowedKeys(row, new Set(['finding_key','entity_key','finding_type','claim','evidence_status','materiality','reliability','evidence_excerpt','source_keys']), 'finding');
    key(row.finding_key, 'finding_key');
    findingKeys.add(row.finding_key);
    if (row.entity_key != null && !entityKeys.has(row.entity_key)) fail('finding entity_key is unknown');
    str(row.finding_type, 'finding_type', 160);
    str(row.claim, 'finding claim', 2500);
    enumValue(row.evidence_status, ['verified','alleged','conflicting','uncertain'], 'finding evidence_status');
    enumValue(row.materiality, ['informational','low','medium','high','critical'], 'finding materiality');
    enumValue(row.reliability, ['high','medium','low','unknown'], 'finding reliability');
    str(row.evidence_excerpt, 'finding evidence_excerpt', 800, true);
    for (const sourceKey of stringArray(row.source_keys, 'finding source_keys', 40, 128)) if (!allowedSources.has(sourceKey)) fail('finding source key is unknown');
    if (row.evidence_status === 'verified' && row.source_keys.length < 1) fail('verified finding requires source');
  }
  const contradictions = arr(parsed.contradictions, 'contradictions', 40);
  uniqueBy(contradictions, 'contradiction_key', 'contradictions');
  for (const row0 of contradictions) {
    const row = obj(row0, 'contradiction');
    allowedKeys(row, new Set(['contradiction_key','finding_keys','description']), 'contradiction');
    key(row.contradiction_key, 'contradiction_key');
    const keys = stringArray(row.finding_keys, 'contradiction finding_keys', 20, 128);
    if (keys.length < 2 || keys.some((findingKey) => !findingKeys.has(findingKey))) fail('contradiction finding_keys are invalid');
    str(row.description, 'contradiction description', 2500);
  }
  const unresolved = arr(parsed.unresolved_checks, 'unresolved_checks', 30);
  uniqueBy(unresolved, 'unresolved_key', 'unresolved_checks');
  for (const row0 of unresolved) {
    const row = obj(row0, 'unresolved');
    allowedKeys(row, new Set(['unresolved_key','description','reason','attempted_methods','blocker','next_manual_action']), 'unresolved');
    key(row.unresolved_key, 'unresolved_key');
    str(row.description, 'unresolved description', 2500);
    str(row.reason, 'unresolved reason', 1500);
    stringArray(row.attempted_methods, 'attempted_methods', 30, 800);
    str(row.blocker, 'unresolved blocker', 1500, true);
    str(row.next_manual_action, 'next_manual_action', 1500, true);
  }
  stringArray(parsed.limitations, 'limitations', 30, 1200);
  return parsed;
}

export function parseLaneFinal(finalText, expectedLaneId, allowedEntityKeys, allowedDocumentSourceKeys) {
  const parsed = obj(parseSingleJsonObject(finalText, 'research lane final response'), 'research lane');
  allowedKeys(parsed, new Set(['lane_id','sources','findings','check','unresolved_checks','limitations']), 'research lane');
  if (parsed.lane_id !== expectedLaneId) fail('research lane id mismatch');
  const sourceRefs = new Set();
  for (const row0 of arr(parsed.sources, 'lane sources', 8)) {
    const row = obj(row0, 'lane source');
    allowedKeys(row, new Set(['source_ref','source_type','title','url','excerpt','reliability_note','verification_state','retrieved_at']), 'lane source');
    key(row.source_ref, 'source_ref');
    if (sourceRefs.has(row.source_ref)) fail('duplicate source_ref');
    sourceRefs.add(row.source_ref);
    enumValue(row.source_type, ['official','primary','secondary','other'], 'lane source_type');
    str(row.title, 'lane source title', 500);
    if (typeof row.url !== 'string' || !row.url.startsWith('https://') || row.url.length > 2048) fail('lane source url is invalid');
    str(row.excerpt, 'lane source excerpt', 1500, true);
    str(row.reliability_note, 'lane reliability_note', 1000, true);
    if (row.verification_state != null) enumValue(row.verification_state, ['discovered','opened','validated','claim_supporting'], 'lane verification_state');
    isoDate(row.retrieved_at, 'lane retrieved_at');
  }
  for (const row0 of arr(parsed.findings, 'lane findings', 8)) {
    const row = obj(row0, 'lane finding');
    allowedKeys(row, new Set(['entity_key','finding_type','claim','evidence_status','materiality','reliability','evidence_excerpt','source_refs','document_source_keys']), 'lane finding');
    if (row.entity_key != null && !allowedEntityKeys.has(row.entity_key)) fail('lane finding entity_key is unknown');
    str(row.finding_type, 'lane finding_type', 160);
    str(row.claim, 'lane finding claim', 2000);
    enumValue(row.evidence_status, ['verified','alleged','conflicting','uncertain'], 'lane evidence_status');
    enumValue(row.materiality, ['informational','low','medium','high','critical'], 'lane materiality');
    enumValue(row.reliability, ['high','medium','low','unknown'], 'lane reliability');
    str(row.evidence_excerpt, 'lane evidence_excerpt', 800, true);
    for (const ref of stringArray(row.source_refs, 'lane source_refs', 8, 128)) if (!sourceRefs.has(ref)) fail('lane source_ref is unknown');
    for (const sourceKey of stringArray(row.document_source_keys, 'lane document_source_keys', 20, 128)) if (!allowedDocumentSourceKeys.has(sourceKey)) fail('lane document source key is unknown');
    if (row.evidence_status === 'verified' && row.source_refs.length + row.document_source_keys.length < 1) fail('verified lane finding requires source');
  }
  const check = obj(parsed.check, 'lane check');
  allowedKeys(check, new Set(['status','outcome','required_source']), 'lane check');
  enumValue(check.status, ['open','in_progress','complete','blocked'], 'lane check status');
  str(check.outcome, 'lane check outcome', 2500, true);
  str(check.required_source, 'lane check required_source', 1000, true);
  for (const row0 of arr(parsed.unresolved_checks, 'lane unresolved_checks', 8)) {
    const row = obj(row0, 'lane unresolved');
    allowedKeys(row, new Set(['description','reason','attempted_methods','blocker','next_manual_action']), 'lane unresolved');
    str(row.description, 'lane unresolved description', 2000);
    str(row.reason, 'lane unresolved reason', 1200);
    stringArray(row.attempted_methods, 'lane attempted_methods', 20, 600);
    str(row.blocker, 'lane blocker', 1000, true);
    str(row.next_manual_action, 'lane next_manual_action', 1000, true);
  }
  stringArray(parsed.limitations, 'lane limitations', 10, 1000);
  return parsed;
}

function safeLanePart(value) {
  return String(value).replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 60) || 'lane';
}
export function materializeLaneResult(parsed, lane, laneIndex) {
  const lanePart = safeLanePart(lane.lane_id);
  const refMap = new Map();
  const sources = parsed.sources.map((row, index) => {
    const sourceKey = `ext.${lanePart}.${String(index + 1).padStart(2, '0')}`;
    refMap.set(row.source_ref, sourceKey);
    return {
      source_key: sourceKey,
      source_type: row.source_type,
      title: row.title,
      url: row.url,
      document_id: null,
      page_reference: null,
      excerpt: row.excerpt,
      reliability_note: row.reliability_note,
      evidence_origin: 'external_research',
      verification_state: row.verification_state,
      retrieved_at: row.retrieved_at,
    };
  });
  const findings = parsed.findings.map((row, index) => ({
    finding_key: `lane.${lanePart}.f${String(index + 1).padStart(2, '0')}`,
    entity_key: row.entity_key ?? null,
    finding_type: row.finding_type,
    claim: row.claim,
    evidence_status: row.evidence_status,
    materiality: row.materiality,
    reliability: row.reliability,
    evidence_excerpt: row.evidence_excerpt,
    source_keys: [...row.source_refs.map((ref) => refMap.get(ref)), ...row.document_source_keys],
  }));
  const unresolved_checks = parsed.unresolved_checks.map((row, index) => ({
    unresolved_key: `lane.${lanePart}.u${String(index + 1).padStart(2, '0')}`,
    ...row,
  }));
  const check = {
    check_key: `lane.${lane.lane_id}`,
    entity_key: null,
    check_type: 'research_lane',
    description: lane.question,
    priority: lane.priority,
    required_source: parsed.check.required_source || lane.preferred_sources?.[0] || '',
    status: parsed.check.status,
    outcome: parsed.check.outcome,
  };
  return { sources, findings, unresolved_checks, check, limitations: parsed.limitations, lane_index: laneIndex };
}

export function parseCriticIssuesFinal(finalText) {
  const parsed = obj(parseSingleJsonObject(finalText, 'large critic final response'), 'large critic');
  allowedKeys(parsed, new Set(['verdict','issues','missing_document_ids','report_gaps']), 'large critic');
  enumValue(parsed.verdict, ['pass','revise'], 'critic verdict');
  for (const row0 of arr(parsed.issues, 'critic issues', 30)) {
    const row = obj(row0, 'critic issue');
    allowedKeys(row, new Set(['severity','category','description','recommended_correction']), 'critic issue');
    enumValue(row.severity, ['critical','high','medium','low'], 'critic severity');
    str(row.category, 'critic category', 120);
    str(row.description, 'critic description', 2000);
    str(row.recommended_correction, 'critic recommended_correction', 2000);
  }
  for (const id of arr(parsed.missing_document_ids, 'missing_document_ids', 20)) if (!UUID.test(id)) fail('critic missing document id is invalid');
  stringArray(parsed.report_gaps, 'report_gaps', 30, 500);
  return parsed;
}

export function parseReportSectionFinal(finalText, expectedHeading, maxChars = 9000) {
  str(finalText, 'report section', maxChars);
  const trimmed = finalText.trim();
  if (!trimmed.startsWith(expectedHeading)) fail(`report section must begin with ${expectedHeading}`);
  if (/output token limit|response was truncated|\[truncated\]/i.test(trimmed)) fail('report section is truncated');
  return trimmed;
}

export function assembleLargeBundle({
  manifest,
  documentSummaries,
  caseAnalysis,
  laneResults,
  critic,
  reportMarkdown,
  reportSummary,
  startedAt,
  completedAt,
  executionTools = [],
}) {
  const submittedSources = buildSubmittedSources(manifest, documentSummaries, completedAt);
  const sources = [...submittedSources];
  const findings = [...caseAnalysis.findings];
  const checks = [];
  const unresolved = [...caseAnalysis.unresolved_checks];
  const limitations = [...caseAnalysis.limitations];
  for (const lane of laneResults) {
    sources.push(...lane.sources);
    findings.push(...lane.findings);
    checks.push(lane.check);
    unresolved.push(...lane.unresolved_checks);
    limitations.push(...lane.limitations);
  }
  for (const [index, issue] of (critic?.issues ?? []).entries()) {
    if (!['critical','high'].includes(issue.severity)) continue;
    unresolved.push({
      unresolved_key: `critic.u${String(index + 1).padStart(2, '0')}`,
      description: issue.description,
      reason: `Independent critic flagged a ${issue.severity} ${issue.category} issue.`,
      attempted_methods: ['Independent critic review'],
      blocker: 'Requires analyst resolution or additional authoritative evidence before finalization.',
      next_manual_action: issue.recommended_correction,
    });
  }
  for (const documentId of critic?.missing_document_ids ?? []) {
    unresolved.push({
      unresolved_key: `critic.doc.${documentId.replaceAll('-', '').slice(0, 24)}`,
      description: `Independent critic reported missing coverage for document ${documentId}.`,
      reason: 'Document coverage requires manual confirmation.',
      attempted_methods: ['Independent critic review'],
      blocker: 'Coverage could not be established confidently in the automated pass.',
      next_manual_action: 'Review the document and add or correct evidence-linked findings before finalization.',
    });
  }
  const anyIncompleteCheck = checks.some((row) => row.status !== 'complete');
  const terminalOutcome = unresolved.length || anyIncompleteCheck ? 'incomplete' : 'completed';
  return {
    schema_version: 1,
    case_id: manifest.case_id,
    case_job_id: manifest.case_job_id,
    case_revision: manifest.case_revision,
    depth: manifest.depth,
    generated_at: completedAt,
    entities: caseAnalysis.entities,
    relationships: caseAnalysis.relationships,
    sources,
    findings,
    checks,
    contradictions: caseAnalysis.contradictions,
    unresolved_checks: unresolved,
    limitations: [...new Set(limitations)].slice(0, 100),
    report: {
      summary: reportSummary,
      markdown: reportMarkdown,
      status: 'draft',
    },
    execution: {
      started_at: startedAt,
      completed_at: completedAt,
      stages: [
        'adaptive_planning',
        'document_shards',
        'case_analysis',
        'research_lanes',
        'independent_critic',
        'sectioned_report',
        'deterministic_assembly',
      ],
      tool_results: executionTools.slice(0, 200),
      warnings: [],
      terminal_outcome: terminalOutcome,
    },
  };
}

export const LARGE_REPORT_SECTIONS = Object.freeze([
  { id: '01', heading: '# MASTER SUMMARY — READ THIS FIRST', focus: 'Executive decision-useful summary, principal verified/conflicting facts, risk-reducing evidence, and overall evidence limitations. End with ## DIRECT NEXT STEPS — WHAT TO DO NOW and concrete next actions.' },
  { id: '02', heading: '# DOCUMENT, FORENSIC & ENTITY REVIEW', focus: 'Document-by-document coverage, forensic observations, identities, aliases, identifiers, relationships, same-name separation, issuer claims, and provenance.' },
  { id: '03', heading: '# TRANSACTION, RESEARCH & CONTRADICTION ANALYSIS', focus: 'Commercial structure, material terms, external research results, contradictions, adverse and risk-reducing evidence, fraud-pattern indicators, checks performed, and blocked/manual-only verification gates.' },
  { id: '04', heading: '# EVIDENCE, UNRESOLVED CHECKS & METHODOLOGY', focus: 'Evidence/source register in readable form, unresolved checks, limitations, confidence/evidence-status discipline, methodology, auditability, and analyst review requirements.' },
]);

export function extractExecutiveSummary(markdown) {
  const text = String(markdown ?? '').replace(/^# MASTER SUMMARY — READ THIS FIRST\s*/i, '').trim();
  const nextSection = text.search(/\n#{1,2}\s+/);
  return (nextSection >= 0 ? text.slice(0, nextSection) : text).trim().slice(0, 6000);
}

export function joinReportSections(sections) {
  const ordered = LARGE_REPORT_SECTIONS.map((spec) => sections.get(spec.id));
  if (ordered.some((value) => typeof value !== 'string' || !value.trim())) fail('missing report section');
  return `${ordered.join('\n\n')}\n`;
}
