const DEPTH_SCALE = Object.freeze({
  fast: { maxDocsPerShard: 6, targetBytes: 8 * 1024 * 1024, parallelism: 1, laneGroupSize: 6, reportSections: ['master', 'details'] },
  standard: { maxDocsPerShard: 5, targetBytes: 6 * 1024 * 1024, parallelism: 2, laneGroupSize: 4, reportSections: ['master', 'evidence', 'controls'] },
  deep: { maxDocsPerShard: 4, targetBytes: 4 * 1024 * 1024, parallelism: 2, laneGroupSize: 3, reportSections: ['master', 'evidence', 'research', 'controls'] },
  maximum: { maxDocsPerShard: 3, targetBytes: 3 * 1024 * 1024, parallelism: 2, laneGroupSize: 2, reportSections: ['master', 'evidence', 'research', 'controls'] },
});

const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function uniq(values, max = 1000) {
  const out = [];
  const seen = new Set();
  for (const value of values ?? []) {
    const fingerprint = typeof value === 'string' ? value : JSON.stringify(value);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

function safeKey(namespace, key) {
  const left = String(namespace ?? '').replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 32) || 'artifact';
  const right = String(key ?? '').replace(/[^A-Za-z0-9._:-]/g, '-');
  const combined = `${left}.${right}`.slice(0, 128);
  if (!KEY.test(combined)) throw new Error('namespaced artifact key is invalid');
  return combined;
}

export function buildScalePlan(manifest, depth) {
  const profile = DEPTH_SCALE[depth];
  if (!profile) throw new Error('invalid scale-plan depth');
  if (!manifest || !Array.isArray(manifest.documents) || manifest.documents.length < 1 || manifest.documents.length > 20) {
    throw new Error('scale-plan manifest documents are invalid');
  }
  const docs = manifest.documents.map((doc, index) => {
    if (!doc || typeof doc !== 'object' || !UUID.test(doc.id)) throw new Error(`scale-plan document ${index} is invalid`);
    const sizeBytes = Number.isFinite(doc.size_bytes) && doc.size_bytes >= 0 ? Math.floor(doc.size_bytes) : 0;
    return { id: doc.id, name: String(doc.name ?? ''), local_path: String(doc.local_path ?? ''), mime_type: String(doc.mime_type ?? ''), size_bytes: sizeBytes };
  });

  const shards = [];
  let current = [];
  let currentBytes = 0;
  for (const doc of docs) {
    const wouldOverflowCount = current.length >= profile.maxDocsPerShard;
    const wouldOverflowBytes = current.length > 0 && currentBytes + doc.size_bytes > profile.targetBytes;
    if (wouldOverflowCount || wouldOverflowBytes) {
      shards.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(doc);
    currentBytes += doc.size_bytes;
  }
  if (current.length) shards.push(current);

  return {
    schema_version: 1,
    depth,
    document_count: docs.length,
    total_bytes: docs.reduce((sum, doc) => sum + doc.size_bytes, 0),
    mode: shards.length > 1 ? 'sharded' : 'single_shard',
    parallelism: profile.parallelism,
    lane_group_size: profile.laneGroupSize,
    report_sections: [...profile.reportSections],
    shards: shards.map((items, index) => ({
      shard_id: `sh${String(index + 1).padStart(2, '0')}`,
      document_ids: items.map((doc) => doc.id),
      total_bytes: items.reduce((sum, doc) => sum + doc.size_bytes, 0),
      documents: items,
    })),
  };
}

export function buildLaneGroups(plan, depth) {
  const profile = DEPTH_SCALE[depth];
  if (!profile) throw new Error('invalid lane-group depth');
  const lanes = Array.isArray(plan?.research_lanes) ? plan.research_lanes : [];
  const groups = [];
  for (let i = 0; i < lanes.length; i += profile.laneGroupSize) {
    groups.push({
      group_id: `rg${String(groups.length + 1).padStart(2, '0')}`,
      lanes: clone(lanes.slice(i, i + profile.laneGroupSize)),
    });
  }
  return groups;
}

export async function mapLimit(items, concurrency, mapper) {
  if (!Array.isArray(items)) throw new Error('mapLimit items must be an array');
  const limit = Math.max(1, Math.min(Number(concurrency) || 1, 8));
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, () => worker()));
  return results;
}

function mergeIdentifierValues(a, b) {
  if (a === undefined) return clone(b);
  if (b === undefined) return clone(a);
  if (JSON.stringify(a) === JSON.stringify(b)) return clone(a);
  const values = [];
  const add = (value) => {
    if (Array.isArray(value)) {
      for (const row of value) add(row);
      return;
    }
    if (!values.some((row) => JSON.stringify(row) === JSON.stringify(value))) values.push(clone(value));
  };
  add(a);
  add(b);
  return values.slice(0, 50);
}

function mergeEntity(existing, incoming) {
  if (!existing) return clone(incoming);
  const identifiers = { ...(existing.identifiers ?? {}) };
  for (const [key, value] of Object.entries(incoming.identifiers ?? {})) {
    identifiers[key] = mergeIdentifierValues(identifiers[key], value);
  }
  const materiallyDifferent = existing.entity_type !== incoming.entity_type
    || existing.display_name !== incoming.display_name
    || Object.keys(identifiers).some((key) => {
      const value = identifiers[key];
      return Array.isArray(value) && value.length > 1;
    });
  const matchStatus = materiallyDifferent || existing.match_status === 'conflicting' || incoming.match_status === 'conflicting'
    ? 'conflicting'
    : (existing.match_status === incoming.match_status ? existing.match_status : 'proposed');
  return {
    entity_key: existing.entity_key,
    entity_type: existing.entity_type === incoming.entity_type ? existing.entity_type : 'other',
    display_name: existing.display_name || incoming.display_name,
    aliases: uniq([...(existing.aliases ?? []), ...(incoming.aliases ?? []), existing.display_name, incoming.display_name].filter(Boolean), 100),
    identifiers,
    match_status: matchStatus,
    confidence: Math.max(0, Math.min(Number(existing.confidence) || 0, Number(incoming.confidence) || 0)),
  };
}

function rewriteBundleKeys(bundle, namespace) {
  const copy = clone(bundle);
  const sourceMap = new Map();
  const findingMap = new Map();
  for (const source of copy.sources ?? []) {
    const next = safeKey(namespace, source.source_key);
    sourceMap.set(source.source_key, next);
    source.source_key = next;
  }
  for (const finding of copy.findings ?? []) {
    const next = safeKey(namespace, finding.finding_key);
    findingMap.set(finding.finding_key, next);
    finding.finding_key = next;
    finding.source_keys = (finding.source_keys ?? []).map((key) => sourceMap.get(key) ?? safeKey(namespace, key));
  }
  for (const relationship of copy.relationships ?? []) {
    relationship.relationship_key = safeKey(namespace, relationship.relationship_key);
    relationship.source_keys = (relationship.source_keys ?? []).map((key) => sourceMap.get(key) ?? safeKey(namespace, key));
  }
  for (const check of copy.checks ?? []) {
    if (!String(check.check_key).startsWith('lane.')) check.check_key = safeKey(namespace, check.check_key);
  }
  for (const contradiction of copy.contradictions ?? []) {
    contradiction.contradiction_key = safeKey(namespace, contradiction.contradiction_key);
    contradiction.finding_keys = (contradiction.finding_keys ?? []).map((key) => findingMap.get(key) ?? safeKey(namespace, key));
  }
  for (const unresolved of copy.unresolved_checks ?? []) unresolved.unresolved_key = safeKey(namespace, unresolved.unresolved_key);
  return copy;
}

function mergeChecks(existing, incoming) {
  if (!existing) return clone(incoming);
  const statusRank = { complete: 0, in_progress: 1, open: 2, blocked: 3 };
  return {
    ...existing,
    priority: ['critical', 'high', 'medium', 'low'].indexOf(incoming.priority) < ['critical', 'high', 'medium', 'low'].indexOf(existing.priority)
      ? incoming.priority : existing.priority,
    status: (statusRank[incoming.status] ?? 2) > (statusRank[existing.status] ?? 2) ? incoming.status : existing.status,
    outcome: uniq([existing.outcome, incoming.outcome].filter(Boolean), 2).join(' | ').slice(0, 12000),
  };
}

export function mergeCanonicalBundles(entries, manifest, {
  reportSummary = 'Investigation evidence assembled; report generation pending.',
  reportMarkdown = '# Investigation evidence assembled\n',
  execution = null,
} = {}) {
  if (!Array.isArray(entries) || entries.length < 1) throw new Error('at least one bundle entry is required');
  const entities = new Map();
  const relationships = new Map();
  const sources = new Map();
  const findings = new Map();
  const checks = new Map();
  const contradictions = new Map();
  const unresolved = new Map();
  const limitations = [];
  const toolResults = [];
  const warnings = [];

  for (const [index, entry] of entries.entries()) {
    const namespace = entry?.namespace ?? `a${index + 1}`;
    const bundle = rewriteBundleKeys(entry?.bundle ?? entry, namespace);
    for (const entity of bundle.entities ?? []) entities.set(entity.entity_key, mergeEntity(entities.get(entity.entity_key), entity));
    for (const row of bundle.relationships ?? []) relationships.set(row.relationship_key, clone(row));
    for (const row of bundle.sources ?? []) sources.set(row.source_key, clone(row));
    for (const row of bundle.findings ?? []) findings.set(row.finding_key, clone(row));
    for (const row of bundle.checks ?? []) checks.set(row.check_key, mergeChecks(checks.get(row.check_key), row));
    for (const row of bundle.contradictions ?? []) contradictions.set(row.contradiction_key, clone(row));
    for (const row of bundle.unresolved_checks ?? []) unresolved.set(row.unresolved_key, clone(row));
    limitations.push(...(bundle.limitations ?? []));
    toolResults.push(...(bundle.execution?.tool_results ?? []));
    warnings.push(...(bundle.execution?.warnings ?? []));
  }

  const now = new Date().toISOString();
  const finalExecution = execution ?? {
    started_at: now,
    completed_at: now,
    stages: ['sharded_evidence_assembly'],
    tool_results: uniq(toolResults, 180),
    warnings: uniq(warnings, 100),
    terminal_outcome: unresolved.size || [...checks.values()].some((row) => row.status !== 'complete') ? 'incomplete' : 'completed',
  };

  return {
    schema_version: 1,
    case_id: manifest.case_id,
    case_job_id: manifest.case_job_id,
    case_revision: manifest.case_revision,
    depth: manifest.depth,
    generated_at: now,
    entities: [...entities.values()],
    relationships: [...relationships.values()],
    sources: [...sources.values()],
    findings: [...findings.values()],
    checks: [...checks.values()],
    contradictions: [...contradictions.values()],
    unresolved_checks: [...unresolved.values()],
    limitations: uniq(limitations.filter((row) => typeof row === 'string'), 100),
    report: { summary: String(reportSummary).slice(0, 12000), markdown: String(reportMarkdown), status: 'draft' },
    execution: finalExecution,
  };
}

const PATCH_FIELDS = new Set(['finding_updates', 'relationship_updates', 'check_updates', 'unresolved_additions', 'warnings']);

export function validateRepairPatch(value, bundle) {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('repair patch must be an object');
  if (Object.keys(value).some((key) => !PATCH_FIELDS.has(key))) throw new Error('repair patch contains unknown fields');
  const findingKeys = new Set((bundle.findings ?? []).map((row) => row.finding_key));
  const relationshipKeys = new Set((bundle.relationships ?? []).map((row) => row.relationship_key));
  const checkKeys = new Set((bundle.checks ?? []).map((row) => row.check_key));
  const out = {
    finding_updates: Array.isArray(value.finding_updates) ? value.finding_updates : [],
    relationship_updates: Array.isArray(value.relationship_updates) ? value.relationship_updates : [],
    check_updates: Array.isArray(value.check_updates) ? value.check_updates : [],
    unresolved_additions: Array.isArray(value.unresolved_additions) ? value.unresolved_additions : [],
    warnings: Array.isArray(value.warnings) ? value.warnings : [],
  };
  if (out.finding_updates.length > 80 || out.relationship_updates.length > 80 || out.check_updates.length > 100
    || out.unresolved_additions.length > 80 || out.warnings.length > 80) throw new Error('repair patch is too large');
  for (const row of out.finding_updates) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !findingKeys.has(row.finding_key)) throw new Error('repair finding update key is invalid');
    const allowed = new Set(['finding_key', 'claim', 'evidence_status', 'materiality', 'reliability', 'evidence_excerpt']);
    if (Object.keys(row).some((key) => !allowed.has(key))) throw new Error('repair finding update contains unknown fields');
    if (row.evidence_status === 'verified') {
      const original = bundle.findings.find((item) => item.finding_key === row.finding_key);
      if (original?.evidence_status !== 'verified') throw new Error('repair patch cannot upgrade a finding to verified without new evidence');
    }
  }
  for (const row of out.relationship_updates) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !relationshipKeys.has(row.relationship_key)) throw new Error('repair relationship update key is invalid');
    const allowed = new Set(['relationship_key', 'claim', 'evidence_status', 'confidence']);
    if (Object.keys(row).some((key) => !allowed.has(key))) throw new Error('repair relationship update contains unknown fields');
    if (row.evidence_status === 'verified') {
      const original = bundle.relationships.find((item) => item.relationship_key === row.relationship_key);
      if (original?.evidence_status !== 'verified') throw new Error('repair patch cannot upgrade a relationship to verified without new evidence');
    }
  }
  for (const row of out.check_updates) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !checkKeys.has(row.check_key)) throw new Error('repair check update key is invalid');
    const allowed = new Set(['check_key', 'status', 'outcome']);
    if (Object.keys(row).some((key) => !allowed.has(key))) throw new Error('repair check update contains unknown fields');
  }
  for (const row of out.unresolved_additions) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !KEY.test(String(row.unresolved_key ?? ''))) throw new Error('repair unresolved addition is invalid');
  }
  if (out.warnings.some((row) => typeof row !== 'string' || row.length > 4000)) throw new Error('repair warnings are invalid');
  return clone(out);
}

export function applyRepairPatch(bundle, patch) {
  const validated = validateRepairPatch(patch, bundle);
  const result = clone(bundle);
  const findings = new Map(result.findings.map((row) => [row.finding_key, row]));
  for (const update of validated.finding_updates) Object.assign(findings.get(update.finding_key), update);
  const relationships = new Map(result.relationships.map((row) => [row.relationship_key, row]));
  for (const update of validated.relationship_updates) Object.assign(relationships.get(update.relationship_key), update);
  const checks = new Map(result.checks.map((row) => [row.check_key, row]));
  for (const update of validated.check_updates) Object.assign(checks.get(update.check_key), update);
  const unresolvedKeys = new Set(result.unresolved_checks.map((row) => row.unresolved_key));
  for (const row of validated.unresolved_additions) {
    if (!unresolvedKeys.has(row.unresolved_key)) {
      result.unresolved_checks.push(clone(row));
      unresolvedKeys.add(row.unresolved_key);
    }
  }
  result.execution.warnings = uniq([...(result.execution.warnings ?? []), ...validated.warnings], 100);
  result.execution.terminal_outcome = result.unresolved_checks.length || result.checks.some((row) => row.status !== 'complete')
    ? 'incomplete' : result.execution.terminal_outcome;
  return result;
}

export function reportSectionsForDepth(depth) {
  const profile = DEPTH_SCALE[depth];
  if (!profile) throw new Error('invalid report depth');
  return [...profile.reportSections];
}

export function summarizeReport(markdown, max = 1200) {
  const cleaned = String(markdown ?? '').replace(/^#+\s+/gm, '').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, max);
}
