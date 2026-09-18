import { describe, expect, it, vi } from 'vitest';
import {
  MAX_CASE_DOCUMENTS,
  SUPPORTED_CASE_FILE_ACCEPT,
  canStartInvestigation,
  createIntegritasBrowserClient,
  getIntegritasFunctionUrls,
  getAuthRedirectUrl,
  isInvestigationRuntimeReady,
  isInvestigationResultStale,
  loadPersistedInvestigationResults,
  validateCaseDocumentSelection,
} from './integritas-browser';

describe('Integritas browser adapter', () => {
  it('pins the browser picker to server-supported evidence types', () => {
    expect(SUPPORTED_CASE_FILE_ACCEPT).toBe('.pdf,.txt,.md,.csv');
  });

  it('bootstraps admin authorization through the server API before browser RLS reads', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ cases: [{ id: 'case-1', title: 'Case 1', revision: 2 }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = createIntegritasBrowserClient({ adminApiUrl: 'https://example.test/admin', controlApiUrl: 'https://example.test/control', fetchImpl });
    expect(await client.listCases('token')).toHaveLength(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://example.test/admin');
    expect(init.headers).toEqual({ authorization: 'Bearer token', 'content-type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({ action: 'list_cases' });
  });

  it('rejects selections that would take a case above 20 documents', () => {
    const files = Array.from({ length: 3 }, (_, i) => new File(['x'], `doc-${i}.txt`, { type: 'text/plain' }));
    expect(MAX_CASE_DOCUMENTS).toBe(20);
    expect(() => validateCaseDocumentSelection(18, files)).toThrow(/20 documents/i);
    expect(validateCaseDocumentSelection(17, files)).toEqual(files);
  });

  it('uploads selected evidence through the authenticated admin API one file at a time', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ documentId: 'doc-1', duplicate: false }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ documentId: 'doc-2', duplicate: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = createIntegritasBrowserClient({ adminApiUrl: 'https://example.test/admin', controlApiUrl: 'https://example.test/control', fetchImpl });
    const files = [new File(['a'], 'a.txt', { type: 'text/plain' }), new File(['b'], 'b.txt', { type: 'text/plain' })];
    const result = await client.uploadFiles('token', '11111111-1111-4111-8111-111111111111', 18, files);
    expect(result).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('starts investigations through integritas-control, not OpenCode', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ investigation: { case_job_id: 'job-1', control_command_id: 'cmd-1' } }), { status: 202, headers: { 'content-type': 'application/json' } }));
    const client = createIntegritasBrowserClient({ adminApiUrl: 'https://example.test/admin', controlApiUrl: 'https://example.test/control', fetchImpl });
    await client.startInvestigation('token', { caseId: '11111111-1111-4111-8111-111111111111', caseRevision: 3, depth: 'deep', idempotencyKey: 'case-1111-rev3-deep' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://example.test/control');
    expect(JSON.parse(String(init.body))).toMatchObject({ action: 'start_case_investigation', case_revision: 3, depth: 'deep' });
    expect(String(init.body)).not.toMatch(/opencode/i);
  });

  it('requires a fresh attested 0.3.0+ Oracle runtime with deterministic QA and atomic commit before enabling start', () => {
    const now = new Date('2026-09-16T22:00:00Z').getTime();
    const flags = {
      bounded_control: true, docker_socket: false, case_investigation: true,
      signed_manifests: true, durable_checkpoints: true, deterministic_qa: true,
      atomic_bundle_commit: true, arbitrary_shell: false,
    };
    const runtime = { worker_id: 'oracle-primary', worker_version: '0.3.0', openclaw_status: 'active', last_seen_at: '2026-09-16T21:59:30Z', capability_flags: flags };
    expect(isInvestigationRuntimeReady(runtime, now)).toBe(true);
    expect(isInvestigationRuntimeReady({ ...runtime, worker_version: '0.2.0' }, now)).toBe(false);
    expect(isInvestigationRuntimeReady({ ...runtime, capability_flags: { ...flags, deterministic_qa: false } }, now)).toBe(false);
    expect(isInvestigationRuntimeReady({ ...runtime, capability_flags: { ...flags, atomic_bundle_commit: false } }, now)).toBe(false);
    expect(isInvestigationRuntimeReady({ ...runtime, last_seen_at: '2026-09-16T21:57:00Z' }, now)).toBe(false);
  });

  it('supports same-origin proxy overrides while retaining Supabase defaults', () => {
    expect(getIntegritasFunctionUrls('https://abc.supabase.co')).toEqual({
      adminApiUrl: 'https://abc.supabase.co/functions/v1/integritas-admin-api',
      controlApiUrl: 'https://abc.supabase.co/functions/v1/integritas-control',
    });
    expect(getIntegritasFunctionUrls('https://abc.supabase.co', { adminApiUrl: '/api/admin', controlApiUrl: '/api/control' })).toEqual({
      adminApiUrl: '/api/admin',
      controlApiUrl: '/api/control',
    });
  });

  it('uses a configured auth bridge redirect when provided', () => {
    expect(getAuthRedirectUrl('https://bridge.example/auth', 'https://app.example/')).toBe('https://bridge.example/auth');
    expect(getAuthRedirectUrl(undefined, 'https://app.example/')).toBe('https://app.example/');
  });

  it('keeps start gated', () => {
    expect(canStartInvestigation({ authenticated: true, hasCase: true, documentCount: 2, runtimeReady: true, busy: false })).toBe(true);
    expect(canStartInvestigation({ authenticated: true, hasCase: true, documentCount: 0, runtimeReady: true, busy: false })).toBe(false);
    expect(canStartInvestigation({ authenticated: true, hasCase: true, documentCount: 2, runtimeReady: false, busy: false })).toBe(false);
    expect(canStartInvestigation({ authenticated: true, hasCase: true, documentCount: 2, runtimeReady: true, busy: false, hasCurrentRevisionJob: true })).toBe(false);
  });

  it('loads runtime and command status through authenticated integritas-control actions', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ runtimes: [{ worker_id: 'oracle-primary' }] }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ command: { id: 'cmd-1', status: 'running' } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = createIntegritasBrowserClient({ adminApiUrl: 'https://example.test/admin', controlApiUrl: 'https://example.test/control', fetchImpl });
    expect(await client.runtimeStatus('token')).toHaveLength(1);
    expect((await client.commandStatus('token', '11111111-1111-4111-8111-111111111111')).status).toBe('running');
    expect(fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init.body)).action)).toEqual(['runtime_status', 'command_status']);
  });
});

function fakeRlsClient(fixtures: Record<string, unknown[]>) {
  const calls: Array<{ table: string; columns: string; filters: Record<string, unknown> }> = [];
  return {
    calls,
    from(table: string) {
      const call = { table, columns: '', filters: {} as Record<string, unknown> };
      calls.push(call);
      const query: any = {
        select(columns: string) { call.columns = columns; return query; },
        eq(key: string, value: unknown) { call.filters[key] = value; return query; },
        order() { return query; },
        limit() { return query; },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve({ data: fixtures[table] ?? [], error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

describe('persisted investigation result reads', () => {
  it('detects stale jobs or reports against the current case revision', () => {
    expect(isInvestigationResultStale(5, 4, 5)).toBe(true);
    expect(isInvestigationResultStale(5, 5, 4)).toBe(true);
    expect(isInvestigationResultStale(5, 5, 5)).toBe(false);
    expect(isInvestigationResultStale(5, 5, null)).toBe(false);
  });

  it('loads case/job-scoped structured rows through browser RLS reads', async () => {
    const client = fakeRlsClient({
      integritas_case_job_checkpoints: [{ id: 'cp-1', stage: 'verifying' }],
      integritas_entities: [{ id: 'e-1', entity_key: 'person-a', display_name: 'Same Name' }],
      integritas_relationships: [],
      integritas_findings: [{ id: 'f-1', finding_key: 'finding-a', claim: 'Claim' }],
      integritas_sources: [{ id: 's-1', source_key: 'src-1', title: 'Registry' }],
      integritas_finding_source_links: [{ finding_id: 'f-1', source_id: 's-1' }],
      integritas_checks: [{ id: 'c-1', check_key: 'unresolved:1', check_type: 'unresolved' }],
      integritas_reports: [{ id: 'r-1', status: 'draft', based_on_revision: 3 }],
      integritas_audit_events: [{ id: 1, event_type: 'bundle_committed' }],
    });

    const result = await loadPersistedInvestigationResults(client as any, 'case-1', 'job-1');
    expect(result.entities).toHaveLength(1);
    expect(result.findings[0]?.source_ids).toEqual(['s-1']);
    expect(result.report?.status).toBe('draft');

    const jobScoped = new Set([
      'integritas_case_job_checkpoints', 'integritas_entities', 'integritas_relationships',
      'integritas_findings', 'integritas_sources', 'integritas_finding_source_links',
      'integritas_checks', 'integritas_reports',
    ]);
    for (const call of client.calls) {
      expect(call.filters.case_id).toBe('case-1');
      if (jobScoped.has(call.table)) expect(call.filters.case_job_id).toBe('job-1');
    }
    expect(client.calls.find((call) => call.table === 'integritas_audit_events')?.filters.case_job_id).toBeUndefined();
  });
});
