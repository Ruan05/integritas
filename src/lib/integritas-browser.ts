export const MAX_CASE_DOCUMENTS = 20;
export const SUPPORTED_CASE_FILE_ACCEPT = '.pdf,.txt,.md,.csv';

export function getIntegritasFunctionUrls(supabaseUrl: string) {
  const base = supabaseUrl.replace(/\/$/, '');
  return {
    adminApiUrl: `${base}/functions/v1/integritas-admin-api`,
    controlApiUrl: `${base}/functions/v1/integritas-control`,
  };
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
  if (!runtime || runtime.openclaw_status !== 'active' || !versionAtLeast(runtime.worker_version, [0, 2, 0])) return false;
  const seen = Date.parse(runtime.last_seen_at ?? '');
  const age = now - seen;
  if (!Number.isFinite(seen) || age < 0 || age > 90_000) return false;
  const flags = runtime.capability_flags ?? {};
  return flags.bounded_control === true
    && flags.arbitrary_shell === false
    && flags.docker_socket === false
    && flags.case_investigation === true
    && flags.signed_manifests === true
    && flags.durable_checkpoints === true;
}

export function validateCaseDocumentSelection(existingCount: number, files: File[]) {
  if (!Number.isInteger(existingCount) || existingCount < 0) {
    throw new Error('Existing document count is invalid.');
  }
  if (existingCount + files.length > MAX_CASE_DOCUMENTS) {
    throw new Error('A case can contain no more than 20 documents.');
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
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(String(payload?.error || `Upload failed for ${file.name}.`));
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
  };
}
