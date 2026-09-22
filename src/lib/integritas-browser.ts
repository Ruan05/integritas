export const MAX_CASE_DOCUMENTS = 20;
export const MAX_CASE_FILE_BYTES = 50 * 1024 * 1024;
export const SUPPORTED_CASE_FILE_ACCEPT = '.pdf,.txt,.md,.csv';

export function getIntegritasFunctionUrls(
  supabaseUrl: string,
  overrides: { adminApiUrl?: string; controlApiUrl?: string } = {},
) {
  const base = supabaseUrl.replace(/\/$/, '');
  return {
    adminApiUrl: overrides.adminApiUrl?.trim() || `${base}/functions/v1/integritas-admin-api`,
    controlApiUrl: overrides.controlApiUrl?.trim() || `${base}/functions/v1/integritas-control`,
  };
}

export function getAuthRedirectUrl(configured: string | undefined, currentUrl: string) {
  return configured?.trim() || currentUrl;
}

export function canStartInvestigation(input: { authenticated: boolean; hasCase: boolean; documentCount: number; runtimeReady: boolean; busy: boolean; hasCurrentRevisionJob?: boolean }) {
  return input.authenticated
    && input.hasCase
    && input.documentCount > 0
    && input.documentCount <= MAX_CASE_DOCUMENTS
    && input.runtimeReady
    && !input.busy
    && input.hasCurrentRevisionJob !== true;
}

export type InvestigationDepth = 'fast' | 'standard' | 'deep' | 'maximum';

export type RuntimeStatus = {
  worker_id?: string;
  worker_version?: string;
  openclaw_status?: string;
  last_seen_at?: string;
  capability_flags?: Record<string, unknown>;
};

function versionAtLeast(version: string | undefined, minimum: [number, number, number]) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? '');
  if (!match) return false;
  const current = match.slice(1, 4).map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (current[i] > minimum[i]) return true;
    if (current[i] < minimum[i]) return false;
  }
  return true;
}

export function isInvestigationRuntimeReady(runtime: RuntimeStatus | null | undefined, now = Date.now()) {
  if (!runtime || runtime.openclaw_status !== 'active' || !versionAtLeast(runtime.worker_version, [0, 3, 6])) return false;
  const seen = Date.parse(runtime.last_seen_at ?? '');
  const age = now - seen;
  if (!Number.isFinite(seen) || age < 0 || age > 90_000) return false;
  const flags = runtime.capability_flags ?? {};
  return flags.bounded_control === true
    && flags.arbitrary_shell === false
    && flags.docker_socket === false
    && flags.case_investigation === true
    && flags.signed_manifests === true
    && flags.durable_checkpoints === true
    && flags.deterministic_qa === true
    && flags.atomic_bundle_commit === true;
}

export function validateCaseDocumentSelection(existingCount: number, files: File[]) {
  if (!Number.isInteger(existingCount) || existingCount < 0) {
    throw new Error('Existing document count is invalid.');
  }
  if (existingCount + files.length > MAX_CASE_DOCUMENTS) {
    throw new Error('A case can contain no more than 20 documents.');
  }
  for (const file of files) {
    if (!Number.isFinite(file.size) || file.size < 1) {
      throw new Error(`${file.name || 'Selected file'} is empty or unreadable.`);
    }
    if (file.size > MAX_CASE_FILE_BYTES) {
      throw new Error(`${file.name} exceeds the 50 MB per-file upload limit.`);
    }
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!['pdf', 'txt', 'md', 'csv'].includes(extension)) {
      throw new Error(`${file.name} is not a supported evidence file.`);
    }
  }
  return files;
}

type BrowserClientOptions = {
  adminApiUrl: string;
  controlApiUrl: string;
  fetchImpl?: typeof fetch;
};

type StartInvestigationInput = {
  caseId: string;
  caseRevision: number;
  depth: InvestigationDepth;
  idempotencyKey: string;
};
export function createIntegritasBrowserClient(options: BrowserClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  async function adminRequest(token: string, body: Record<string, unknown>) {
    const response = await fetchImpl(options.adminApiUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(payload?.error || 'Admin request failed.'));
    return payload;
  }
  async function controlRequest(token: string, body: Record<string, unknown>) {
    const response = await fetchImpl(options.controlApiUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(payload?.error || 'Control request failed.'));
    return payload;
  }
  return {
    async listCases(token: string) {
      const payload = await adminRequest(token, { action: 'list_cases' });
      return Array.isArray(payload.cases) ? payload.cases : [];
    },
    async runtimeStatus(token: string) {
      const payload = await controlRequest(token, { action: 'runtime_status' });
      return Array.isArray(payload.runtimes) ? payload.runtimes : [];
    },
    async commandStatus(token: string, commandId: string) {
      const payload = await controlRequest(token, { action: 'command_status', command_id: commandId });
      return payload.command ?? null;
    },
    async uploadFiles(token: string, caseId: string, existingCount: number, files: File[]) {
      validateCaseDocumentSelection(existingCount, files);
      const results = [];
      for (const file of files) {
        const form = new FormData();
        form.set('action', 'upload');
        form.set('caseId', caseId);
        form.set('file', file);
        const response = await fetchImpl(options.adminApiUrl, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: form,
        });
        const raw = await response.text();
        let payload: any = {};
        try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
        if (!response.ok) {
          const message = String(payload?.error || `Upload failed for ${file.name} (HTTP ${response.status}).`);
          throw new Error(message);
        }
        results.push(payload);
      }
      return results;
    },
    async startInvestigation(token: string, input: StartInvestigationInput) {
      const response = await fetchImpl(options.controlApiUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': input.idempotencyKey,
        },
        body: JSON.stringify({
          action: 'start_case_investigation',
          case_id: input.caseId,
          case_revision: input.caseRevision,
          depth: input.depth,
          idempotency_key: input.idempotencyKey,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(payload?.error || 'Investigation start failed.'));
      }
      return payload.investigation;
    },
    async retryInvestigation(token: string, caseJobId: string) {
      const payload = await controlRequest(token, {
        action: 'retry_case_investigation',
        case_job_id: caseJobId,
      });
      return payload.investigation;
    },
    async cancelInvestigation(token: string, caseJobId: string) {
      const payload = await controlRequest(token, {
        action: 'cancel_case_investigation',
        case_job_id: caseJobId,
      });
      return payload.investigation;
    },
    async pauseInvestigation(token: string, caseJobId: string) {
      const payload = await controlRequest(token, {
        action: 'pause_case_investigation',
        case_job_id: caseJobId,
      });
      return payload.investigation;
    },
    async resumeInvestigation(token: string, caseJobId: string) {
      const payload = await controlRequest(token, {
        action: 'resume_case_investigation',
        case_job_id: caseJobId,
      });
      return payload.investigation;
    },
    async deleteDocument(token: string, caseId: string, documentId: string) {
      const payload = await controlRequest(token, {
        action: 'delete_case_document',
        case_id: caseId,
        document_id: documentId,
      });
      return payload.deleted;
    },
    async getReportPdfUrl(token: string, caseJobId: string) {
      const payload = await adminRequest(token, {
        action: 'get_report_pdf',
        caseJobId,
      });
      if (typeof payload?.url !== 'string' || !payload.url.startsWith('https://')) {
        throw new Error('Canonical report PDF is not available yet.');
      }
      return payload as {
        url: string;
        expiresIn: number;
        sha256: string;
        sizeBytes: number;
        caseRevision: number;
        metadata?: Record<string, unknown>;
      };
    },
  };
}

export type InvestigationMilestoneStatus = 'waiting' | 'active' | 'complete' | 'blocked' | 'manual';
export type InvestigationMilestonePriority = 'low' | 'medium' | 'high' | 'critical';
export type InvestigationMilestone = {
  id: string;
  label: string;
  status: InvestigationMilestoneStatus;
  priority: InvestigationMilestonePriority;
};
export type InvestigationMilestoneSnapshot = {
  rows: InvestigationMilestone[];
  stage: string;
  progress: number;
  phase: string;
  message: string;
  isLive: boolean;
};
export type CheckpointRow = { id: string; stage: string; progress: number; safe_metadata: Record<string, unknown>; created_at: string };
export type EntityResultRow = { id: string; entity_key: string; entity_type: string; display_name: string; match_status: string; match_confidence: number | null; identifiers: Record<string, unknown>; aliases: string[] };
export type RelationshipResultRow = { id: string; relationship_key: string; from_entity_id: string; to_entity_id: string; relationship_type: string; claim: string; evidence_status: string; confidence: number | null };
export type FindingResultRow = { id: string; finding_key: string; finding_type: string; claim: string; evidence_status: string; materiality: string; reliability: string; source_ids: string[] };
export type SourceResultRow = { id: string; source_key: string; source_type: string; title: string; url?: string | null; page_reference?: string | null; excerpt: string; reliability_note: string };
export type FindingSourceLinkRow = { finding_id: string; source_id: string };
export type CheckResultRow = { id: string; check_key: string; check_type: string; description: string; status: string; outcome: string };
export type ReportResultRow = { id: string; status: string; based_on_revision: number; summary: string; content_markdown: string; limitations: string };
export type AuditEventRow = { id: number | string; event_type: string; created_at: string; safe_metadata: Record<string, unknown> };

export type PersistedInvestigationResults = {
  checkpoints: CheckpointRow[];
  entities: EntityResultRow[];
  relationships: RelationshipResultRow[];
  findings: FindingResultRow[];
  sources: SourceResultRow[];
  sourceLinks: FindingSourceLinkRow[];
  checks: CheckResultRow[];
  report: ReportResultRow | null;
  auditEvents: AuditEventRow[];
};

const milestoneStatuses = new Set<InvestigationMilestoneStatus>(['waiting', 'active', 'complete', 'blocked', 'manual']);
const milestonePriorities = new Set<InvestigationMilestonePriority>(['low', 'medium', 'high', 'critical']);

function normalizeMilestone(value: unknown): InvestigationMilestone | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : '';
  const label = typeof row.label === 'string' ? row.label : '';
  const status = row.status as InvestigationMilestoneStatus;
  const priority = row.priority as InvestigationMilestonePriority;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)
    || label.length < 1 || label.length > 160
    || !milestoneStatuses.has(status)
    || !milestonePriorities.has(priority)) return null;
  return { id, label, status, priority };
}

function checkStatusToMilestone(status: string): InvestigationMilestoneStatus {
  if (status === 'complete') return 'complete';
  if (status === 'in_progress') return 'active';
  if (status === 'blocked') return 'blocked';
  return 'waiting';
}

const terminalMilestoneStages = new Set(['completed', 'incomplete', 'failed', 'cancelled', 'research_limit_reached']);

function orderedCheckpoints(checkpoints: CheckpointRow[]) {
  return [...checkpoints].sort((a, b) => {
    const at = Date.parse(a.created_at || '') || 0;
    const bt = Date.parse(b.created_at || '') || 0;
    return at - bt || a.progress - b.progress;
  });
}

export function deriveInvestigationMilestoneSnapshot(
  checkpoints: CheckpointRow[],
  checks: CheckResultRow[],
  jobStage?: string,
  jobProgress?: number,
): InvestigationMilestoneSnapshot {
  const ordered = orderedCheckpoints(checkpoints);
  const latest = ordered.at(-1);
  const latestWithMilestones = [...ordered].reverse().find((checkpoint) => Array.isArray(checkpoint.safe_metadata?.milestones));
  const stage = jobStage || latest?.stage || '';
  const progress = Number.isFinite(jobProgress) ? Number(jobProgress) : (latest?.progress ?? 0);
  const isLive = !terminalMilestoneStages.has(stage);
  const raw = Array.isArray(latestWithMilestones?.safe_metadata?.milestones)
    ? latestWithMilestones.safe_metadata.milestones
    : [];
  const rows: InvestigationMilestone[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    const normalized = normalizeMilestone(value);
    if (!normalized || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    rows.push(normalized);
  }

  // Check rows are durable final outcomes. During a retry they can belong to a
  // previous attempt, so they must never overwrite the live runner checkpoint.
  if (!isLive) {
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const check of checks) {
      if (!check.check_key.startsWith('lane.')) continue;
      const existing = byId.get(check.check_key);
      const status = checkStatusToMilestone(check.status);
      if (existing) {
        if (existing.status !== 'manual') existing.status = status;
        continue;
      }
      const added: InvestigationMilestone = {
        id: check.check_key,
        label: check.description || check.check_key,
        status,
        priority: 'medium',
      };
      rows.push(added);
      byId.set(added.id, added);
    }
  }
  return {
    rows,
    stage,
    progress: Math.max(0, Math.min(100, progress || 0)),
    phase: typeof latest?.safe_metadata?.phase === 'string' ? latest.safe_metadata.phase : '',
    message: typeof latest?.safe_metadata?.message === 'string' ? latest.safe_metadata.message : '',
    isLive,
  };
}

export function deriveInvestigationMilestones(
  checkpoints: CheckpointRow[],
  checks: CheckResultRow[],
  jobStage?: string,
  jobProgress?: number,
): InvestigationMilestone[] {
  return deriveInvestigationMilestoneSnapshot(checkpoints, checks, jobStage, jobProgress).rows;
}

export function isInvestigationResultStale(caseRevision: number, jobRevision: number, reportRevision: number | null) {
  return jobRevision !== caseRevision || (reportRevision !== null && reportRevision !== caseRevision);
}

type BrowserRlsClient = { from(table: string): any };

async function readRlsRows(client: BrowserRlsClient, table: string, columns: string, caseId: string, jobId?: string) {
  let query = client.from(table).select(columns).eq('case_id', caseId);
  if (jobId) query = query.eq('case_job_id', jobId);
  const result = await query;
  if (result.error) throw result.error;
  return Array.isArray(result.data) ? result.data : [];
}

export async function loadPersistedInvestigationResults(
  client: BrowserRlsClient,
  caseId: string,
  jobId: string,
): Promise<PersistedInvestigationResults> {
  const [
    checkpoints, entities, relationships, findings, sources,
    sourceLinks, checks, reports, auditEvents,
  ] = await Promise.all([
    readRlsRows(client, 'integritas_case_job_checkpoints', 'id,stage,progress,safe_metadata,created_at', caseId, jobId),
    readRlsRows(client, 'integritas_entities', 'id,entity_key,entity_type,display_name,match_status,match_confidence,identifiers,aliases', caseId, jobId),
    readRlsRows(client, 'integritas_relationships', 'id,relationship_key,from_entity_id,to_entity_id,relationship_type,claim,evidence_status,confidence', caseId, jobId),

    readRlsRows(client, 'integritas_findings', 'id,finding_key,finding_type,claim,evidence_status,materiality,reliability', caseId, jobId),
    readRlsRows(client, 'integritas_sources', 'id,source_key,source_type,title,url,page_reference,excerpt,reliability_note', caseId, jobId),
    readRlsRows(client, 'integritas_finding_source_links', 'finding_id,source_id', caseId, jobId),
    readRlsRows(client, 'integritas_checks', 'id,check_key,check_type,description,status,outcome', caseId, jobId),
    readRlsRows(client, 'integritas_reports', 'id,status,based_on_revision,summary,content_markdown,limitations,updated_at', caseId, jobId),
    readRlsRows(client, 'integritas_audit_events', 'id,event_type,created_at,safe_metadata', caseId),
  ]);
  const sourceIdsByFinding = new Map<string, string[]>();
  for (const link of sourceLinks as FindingSourceLinkRow[]) {
    const ids = sourceIdsByFinding.get(link.finding_id) ?? [];
    ids.push(link.source_id);
    sourceIdsByFinding.set(link.finding_id, ids);
  }
  const normalizedFindings = (findings as Omit<FindingResultRow, 'source_ids'>[]).map((finding) => ({
    ...finding,
    source_ids: sourceIdsByFinding.get(finding.id) ?? [],
  }));
  return {
    checkpoints: (checkpoints as CheckpointRow[]).sort((a, b) => (Date.parse(a.created_at || '') || 0) - (Date.parse(b.created_at || '') || 0)),
    entities: entities as EntityResultRow[],
    relationships: relationships as RelationshipResultRow[],
    findings: normalizedFindings,
    sources: sources as SourceResultRow[],

    sourceLinks: sourceLinks as FindingSourceLinkRow[],
    checks: checks as CheckResultRow[],
    report: ((reports as ReportResultRow[])[0] ?? null),
    auditEvents: auditEvents as AuditEventRow[],
  };
}
