const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA_SIGNED_PATH = '/storage/v1/object/sign/';
const TOP_LEVEL = new Set([
  'schema_version', 'case_id', 'case_job_id', 'case_revision', 'depth', 'generated_at',
  'entities', 'relationships', 'sources', 'findings', 'checks', 'contradictions',
  'unresolved_checks', 'limitations', 'report', 'execution',
]);
const FORBIDDEN_KEYS = new Set([
  'password', 'secret', 'token', 'api_key', 'authorization', 'shell', 'command', 'cmd',
  'env', 'sudo', 'docker_socket', 'executable', 'script',
]);

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function assertAllowedKeys(value, allowed, label) {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`unknown ${label} field: ${key}`);
  }
}
function assertString(value, label, max = 12000, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.length < 1) || value.length > max) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function assertDate(value, label) {
  assertString(value, label, 100);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} is invalid`);
}

function assertKey(value, label) {
  if (typeof value !== 'string' || !KEY.test(value)) throw new Error(`${label} is invalid`);
}

function assertUuid(value, label) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error(`${label} is invalid`);
}

function assertArray(value, label, max) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} is invalid`);
  return value;
}

function assertNoForbiddenFields(value, path = 'bundle') {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoForbiddenFields(item, `${path}[${index}]`));
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) throw new Error(`forbidden bundle field: ${path}.${key}`);
    assertNoForbiddenFields(child, `${path}.${key}`);
  }
}
function keyed(rows, keyName, label) {
  const map = new Map();
  for (const row of rows) {
    if (!isObject(row)) throw new Error(`${label} row must be an object`);
    assertKey(row[keyName], `${label}.${keyName}`);
    if (map.has(row[keyName])) throw new Error(`duplicate ${label} key: ${row[keyName]}`);
    map.set(row[keyName], row);
  }
  return map;
}

function assertOptionalEntityKey(value, entities, label) {
  if (value == null) return;
  assertKey(value, label);
  if (!entities.has(value)) throw new Error(`unknown entity key: ${value}`);
}

function assertSourceKeys(values, sources, label) {
  assertArray(values, label, 100);
  for (const key of values) {
    assertKey(key, `${label} item`);
    if (!sources.has(key)) throw new Error(`unknown source key: ${key}`);
  }
}

function assertConfidence(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${label} is invalid`);
  }
}
export function validateInvestigationBundle(bundle, manifest, reportMarkdown) {
  assertAllowedKeys(bundle, TOP_LEVEL, 'bundle');
  assertNoForbiddenFields(bundle);
  const encoded = JSON.stringify(bundle);
  if (encoded.includes(SHA_SIGNED_PATH)) throw new Error('signed URL leaked into investigation bundle');

  if (bundle.schema_version !== 1) throw new Error('unsupported bundle schema version');
  if (!manifest || bundle.case_id !== manifest.case_id || bundle.case_job_id !== manifest.case_job_id
    || bundle.case_revision !== manifest.case_revision || bundle.depth !== manifest.depth) {
    throw new Error('bundle manifest mismatch');
  }
  assertUuid(bundle.case_id, 'case_id');
  assertUuid(bundle.case_job_id, 'case_job_id');
  if (!Number.isInteger(bundle.case_revision) || bundle.case_revision < 0) throw new Error('case_revision is invalid');
  if (!['fast', 'standard', 'deep', 'maximum'].includes(bundle.depth)) throw new Error('depth is invalid');
  assertDate(bundle.generated_at, 'generated_at');

  const entityRows = assertArray(bundle.entities, 'entities', 500);
  const relationshipRows = assertArray(bundle.relationships, 'relationships', 1000);
  const sourceRows = assertArray(bundle.sources, 'sources', 2000);
  const findingRows = assertArray(bundle.findings, 'findings', 2000);
  const checkRows = assertArray(bundle.checks, 'checks', 2000);
  const contradictionRows = assertArray(bundle.contradictions, 'contradictions', 1000);
  const unresolvedRows = assertArray(bundle.unresolved_checks, 'unresolved_checks', 1000);
  const limitationRows = assertArray(bundle.limitations, 'limitations', 100);
  const entityFields = new Set(['entity_key', 'entity_type', 'display_name', 'aliases', 'identifiers', 'match_status', 'confidence']);
  for (const entity of entityRows) {
    assertAllowedKeys(entity, entityFields, 'entity');
    assertString(entity.display_name, 'entity.display_name', 240);
    if (!['person', 'company', 'organization', 'bank', 'vessel', 'other'].includes(entity.entity_type)) throw new Error('entity.entity_type is invalid');
    assertArray(entity.aliases, 'entity.aliases', 100).forEach((alias) => assertString(alias, 'entity.alias', 240, { allowEmpty: true }));
    if (!isObject(entity.identifiers) || Object.keys(entity.identifiers).length > 100) throw new Error('entity.identifiers is invalid');
    if (!['proposed', 'probable', 'verified', 'conflicting', 'rejected'].includes(entity.match_status)) throw new Error('entity.match_status is invalid');
    assertConfidence(entity.confidence, 'entity.confidence');
  }
  const entities = keyed(entityRows, 'entity_key', 'entity');

  const sourceFields = new Set(['source_key', 'source_type', 'title', 'url', 'document_id', 'page_reference', 'excerpt', 'reliability_note', 'evidence_origin', 'verification_state', 'retrieved_at']);
  const manifestDocumentIds = new Set((manifest.documents ?? []).map((document) => document.id));
  for (const source of sourceRows) {
    assertAllowedKeys(source, sourceFields, 'source');
    if (!['document', 'official', 'primary', 'secondary', 'other'].includes(source.source_type)) throw new Error('source.source_type is invalid');
    assertString(source.title, 'source.title', 500);
    if (source.url != null && (typeof source.url !== 'string' || source.url.length > 2048 || !source.url.startsWith('https://'))) throw new Error('source.url is invalid');
    if (source.document_id != null && (!UUID.test(source.document_id) || !manifestDocumentIds.has(source.document_id))) throw new Error('source document is not in the manifest');
    if (source.evidence_origin === 'submitted_document') {
      if (source.source_type !== 'document') throw new Error('submitted document evidence requires document source type');
      if (source.document_id == null) throw new Error('submitted document evidence requires a document_id');
      if (source.verification_state != null && source.verification_state !== 'submitted') throw new Error('submitted document verification_state is invalid');
    }
    if (source.evidence_origin === 'external_research') {
      if (source.url == null) throw new Error('external research evidence requires an https url');
      if (source.document_id != null) throw new Error('external research evidence cannot reference a submitted document');
      if (source.verification_state != null && !['discovered', 'opened', 'validated', 'claim_supporting'].includes(source.verification_state)) throw new Error('external research verification_state is invalid');
    }
    if (source.page_reference != null) assertString(source.page_reference, 'source.page_reference', 500, { allowEmpty: true });
    if (typeof source.excerpt !== 'string') throw new Error('source.excerpt is invalid');
    if (source.excerpt.length > 8000) throw new Error('source excerpt too large');
    assertString(source.reliability_note, 'source.reliability_note', 4000, { allowEmpty: true });
    if (!['submitted_document', 'external_research'].includes(source.evidence_origin)) throw new Error('source.evidence_origin is invalid');
    assertDate(source.retrieved_at, 'source.retrieved_at');
  }
  const sources = keyed(sourceRows, 'source_key', 'source');

  const findingFields = new Set(['finding_key', 'entity_key', 'finding_type', 'claim', 'evidence_status', 'materiality', 'reliability', 'evidence_excerpt', 'source_keys']);
  for (const finding of findingRows) {
    assertAllowedKeys(finding, findingFields, 'finding');
    assertOptionalEntityKey(finding.entity_key, entities, 'finding.entity_key');
    assertString(finding.finding_type, 'finding.finding_type', 160);
    assertString(finding.claim, 'finding.claim', 12000);
    if (!['verified', 'alleged', 'conflicting', 'uncertain'].includes(finding.evidence_status)) throw new Error('finding.evidence_status is invalid');
    if (!['informational', 'low', 'medium', 'high', 'critical'].includes(finding.materiality)) throw new Error('finding.materiality is invalid');
    if (!['high', 'medium', 'low', 'unknown'].includes(finding.reliability)) throw new Error('finding.reliability is invalid');
    if (typeof finding.evidence_excerpt !== 'string') throw new Error('finding.evidence_excerpt is invalid');
    if (finding.evidence_excerpt.length > 8000) throw new Error('finding excerpt too large');
    assertSourceKeys(finding.source_keys, sources, 'finding.source_keys');
    if (finding.evidence_status === 'verified' && finding.source_keys.length < 1) throw new Error('verified finding requires a source');
  }
  const findings = keyed(findingRows, 'finding_key', 'finding');
  const relationshipFields = new Set(['relationship_key', 'from_entity_key', 'to_entity_key', 'relationship_type', 'claim', 'evidence_status', 'source_keys', 'confidence']);
  for (const relationship of relationshipRows) {
    assertAllowedKeys(relationship, relationshipFields, 'relationship');
    if (!entities.has(relationship.from_entity_key) || !entities.has(relationship.to_entity_key)) throw new Error('unknown relationship entity key');
    assertString(relationship.relationship_type, 'relationship.relationship_type', 160);
    assertString(relationship.claim, 'relationship.claim', 12000, { allowEmpty: true });
    if (!['verified', 'alleged', 'conflicting', 'uncertain'].includes(relationship.evidence_status)) throw new Error('relationship.evidence_status is invalid');
    assertSourceKeys(relationship.source_keys, sources, 'relationship.source_keys');
    assertConfidence(relationship.confidence, 'relationship.confidence');
  }
  keyed(relationshipRows, 'relationship_key', 'relationship');

  const checkFields = new Set(['check_key', 'entity_key', 'check_type', 'description', 'priority', 'required_source', 'status', 'outcome']);
  for (const check of checkRows) {
    assertAllowedKeys(check, checkFields, 'check');
    assertOptionalEntityKey(check.entity_key, entities, 'check.entity_key');
    assertString(check.check_type, 'check.check_type', 160);
    assertString(check.description, 'check.description', 12000);
    if (!['low', 'medium', 'high', 'critical'].includes(check.priority)) throw new Error('check.priority is invalid');
    assertString(check.required_source, 'check.required_source', 4000, { allowEmpty: true });
    if (!['open', 'in_progress', 'complete', 'blocked'].includes(check.status)) throw new Error('check.status is invalid');
    assertString(check.outcome, 'check.outcome', 12000, { allowEmpty: true });
  }
  keyed(checkRows, 'check_key', 'check');
  const contradictionFields = new Set(['contradiction_key', 'finding_keys', 'description']);
  for (const contradiction of contradictionRows) {
    assertAllowedKeys(contradiction, contradictionFields, 'contradiction');
    assertArray(contradiction.finding_keys, 'contradiction.finding_keys', 20);
    if (contradiction.finding_keys.length < 2) throw new Error('contradiction requires at least two findings');
    for (const key of contradiction.finding_keys) {
      assertKey(key, 'contradiction.finding_key');
      if (!findings.has(key)) throw new Error(`unknown finding key: ${key}`);
    }
    assertString(contradiction.description, 'contradiction.description', 12000);
  }
  keyed(contradictionRows, 'contradiction_key', 'contradiction');

  const unresolvedFields = new Set(['unresolved_key', 'description', 'reason', 'attempted_methods', 'blocker', 'next_manual_action']);
  for (const unresolved of unresolvedRows) {
    assertAllowedKeys(unresolved, unresolvedFields, 'unresolved');
    assertString(unresolved.description, 'unresolved.description', 12000);
    assertString(unresolved.reason, 'unresolved.reason', 4000);
    assertArray(unresolved.attempted_methods, 'unresolved.attempted_methods', 100)
      .forEach((method) => assertString(method, 'unresolved.attempted_method', 2000, { allowEmpty: true }));
    assertString(unresolved.blocker, 'unresolved.blocker', 4000, { allowEmpty: true });
    assertString(unresolved.next_manual_action, 'unresolved.next_manual_action', 4000, { allowEmpty: true });
  }
  keyed(unresolvedRows, 'unresolved_key', 'unresolved');
  for (const limitation of limitationRows) assertString(limitation, 'limitation', 4000, { allowEmpty: true });

  const reportFields = new Set(['summary', 'markdown', 'status']);
  assertAllowedKeys(bundle.report, reportFields, 'report');
  assertString(bundle.report.summary, 'report.summary', 12000, { allowEmpty: true });
  assertString(bundle.report.markdown, 'report.markdown', 5 * 1024 * 1024);
  if (bundle.report.status !== 'draft') throw new Error('report status must be draft');
  if (bundle.report.markdown !== reportMarkdown) throw new Error('report markdown mismatch');

  const executionFields = new Set(['started_at', 'completed_at', 'stages', 'tool_results', 'warnings', 'terminal_outcome']);
  assertAllowedKeys(bundle.execution, executionFields, 'execution');
  assertDate(bundle.execution.started_at, 'execution.started_at');
  assertDate(bundle.execution.completed_at, 'execution.completed_at');
  assertArray(bundle.execution.stages, 'execution.stages', 32)
    .forEach((stage) => assertString(stage, 'execution.stage', 80));
  assertArray(bundle.execution.warnings, 'execution.warnings', 100)
    .forEach((warning) => assertString(warning, 'execution.warning', 4000, { allowEmpty: true }));
  if (!['completed', 'incomplete', 'research_limit_reached'].includes(bundle.execution.terminal_outcome)) throw new Error('execution.terminal_outcome is invalid');

  const toolFields = new Set(['tool', 'status', 'summary']);
  for (const result of assertArray(bundle.execution.tool_results, 'execution.tool_results', 200)) {
    assertAllowedKeys(result, toolFields, 'tool_result');
    assertString(result.tool, 'tool_result.tool', 160);
    if (!['completed', 'failed', 'unavailable', 'skipped'].includes(result.status)) throw new Error('tool_result.status is invalid');
    assertString(result.summary, 'tool_result.summary', 4000, { allowEmpty: true });
  }
  return JSON.parse(JSON.stringify(bundle));
}
