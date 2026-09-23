import { describe, expect, it, vi } from 'vitest';
import {
  MAX_CASE_DOCUMENTS,
  MAX_CASE_FILE_BYTES,
  SUPPORTED_CASE_FILE_ACCEPT,
  canStartInvestigation,
  createIntegritasBrowserClient,
  getIntegritasFunctionUrls,
  getAuthRedirectUrl,
  isInvestigationRuntimeReady,
  deriveInvestigationMilestones,
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

  it('rejects oversized or unsupported files before hitting the upload API', () => {
    expect(MAX_CASE_FILE_BYTES).toBe(50 * 1024 * 1024);
    const oversized = new File([new Uint8Array(MAX_CASE_FILE_BYTES + 1)], 'too-big.pdf', { type: 'application/pdf' });
    expect(() => validateCaseDocumentSelection(0, [oversized])).toThrow(/50 MB/i);
    const unsupported = new File(['x'], 'payload.exe', { type: 'application/octet-stream' });
    expect(() => validateCaseDocumentSelection(0, [unsupported])).toThrow(/supported evidence file/i);
  });

  it('preserves HTTP status when an upstream upload failure is not JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('upstream failure', { status: 502 }));
    const client = createIntegritasBrowserClient({ adminApiUrl: 'https://example.test/admin', controlApiUrl: 'https://example.test/control', fetchImpl });
    await expect(client.uploadFiles('token', '11111111-1111-4111-8111-111111111111', 0, [new File(['x'], 'evidence.txt', { type: 'text/plain' })]))
      .rejects.toThrow(/HTTP 502/);
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

  it('routes pause, continue, retry and cancel through typed case-scoped control actions', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ investigation: { command_status: 'queued' } }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ investigation: { command_status: 'paused' } }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ investigation: { command_status: 'queued' } }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ investigation: { command_status: 'running', cancel_requested: true } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = createIntegritasBrowserClient({ adminApiUrl: 'https://example.test/admin', controlApiUrl: 'https://example.test/control', fetchImpl });
    await client.retryInvestigation('token', '11111111-1111-4111-8111-111111111111');
    await client.pauseInvestigation('token', '11111111-1111-4111-8111-111111111111');
    await client.resumeInvestigation('token', '11111111-1111-4111-8111-111111111111');
    await client.cancelInvestigation('token', '11111111-1111-4111-8111-111111111111');
    expect(fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init.body)))).toEqual([
      { action: 'retry_case_investigation', case_job_id: '11111111-1111-4111-8111-111111111111' },
      { action: 'pause_case_investigation', case_job_id: '11111111-1111-4111-8111-111111111111' },
      { action: 'resume_case_investigation', case_job_id: '11111111-1111-4111-8111-111111111111' },
      { action: 'cancel_case_investigation', case_job_id: '11111111-1111-4111-8111-111111111111' },
    ]);
  });

  it('requests the canonical report PDF through the authenticated admin API', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      url: 'https://example.test/signed-report.pdf', expiresIn: 300, sha256: 'a'.repeat(64), sizeBytes: 2048, caseRevision: 3,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = createIntegritasBrowserClient({ adminApiUrl: 'https://example.test/admin', controlApiUrl: 'https://example.test/control', fetchImpl });
    const artifact = await client.getReportPdfUrl('token', '11111111-1111-4111-8111-111111111111');
    expect(artifact.sha256).toBe('a'.repeat(64));
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1].body))).toEqual({
      action: 'get_report_pdf',
      caseJobId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('uses a case-scoped control action for evidence deletion', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ deleted: { document_id: 'doc-1' } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = createIntegritasBrowserClient({ adminApiUrl: 'https://example.test/admin', controlApiUrl: 'https://example.test/control', fetchImpl });
    await client.deleteDocument('token', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1].body))).toEqual({
      action: 'delete_case_document',
      case_id: '11111111-1111-4111-8111-111111111111',
      document_id: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('requires a fresh attested 0.4.1+ Oracle runtime with live model discovery and progress telemetry before enabling start', () => {
    const now = new Date('2026-09-16T22:00:00Z').getTime();
    const flags = {
      bounded_control: true, docker_socket: false, case_investigation: true,
      signed_manifests: true, durable_checkpoints: true, deterministic_qa: true,
      atomic_bundle_commit: true, arbitrary_shell: false,
      model_discovery_v1: true, live_progress_feed_v1: true, independent_artifact_state_v1: true,
    };
    const runtime = { worker_id: 'oracle-primary', worker_version: '0.4.1', openclaw_status: 'active', last_seen_at: '2026-09-16T21:59:30Z', capability_flags: flags };
    expect(isInvestigationRuntimeReady(runtime, now)).toBe(true);
    expect(isInvestigationRuntimeReady({ ...runtime, worker_version: '0.2.0' }, now)).toBe(false);
    expect(isInvestigationRuntimeReady({ ...runtime, worker_version: '0.3.1' }, now)).toBe(false);
    expect(isInvestigationRuntimeReady({ ...runtime, worker_version: '0.4.0' }, now)).toBe(false);
    expect(isInvestigationRuntimeReady({ ...runtime, capability_flags: { ...flags, deterministic_qa: false } }, now)).toBe(false);
    expect(isInvestigationRuntimeReady({ ...runtime, capability_flags: { ...flags, atomic_bundle_commit: false } }, now)).toBe(false);
    expect(isInvestigationRuntimeReady({ ...runtime, capability_flags: { ...flags, model_discovery_v1: false } }, now)).toBe(false);
    expect(isInvestigationRuntimeReady({ ...runtime, capability_flags: { ...flags, live_progress_feed_v1: false } }, now)).toBe(false);
    expect(isInvestigationRuntimeReady({ ...runtime, capability_flags: { ...flags, independent_artifact_state_v1: false } }, now)).toBe(false);
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

describe('live investigation milestones', () => {
  it('prefers the terminal checkpoint updated for the current attempt over a later inserted stale failure', () => {
    const rows = deriveInvestigationMilestones(
      [
        {
          id: 'terminal', stage: 'incomplete', progress: 100,
          created_at: '2026-09-22T20:51:00Z', updated_at: '2026-09-23T08:00:20Z',
          safe_metadata: { milestones: [
            { id: 'module.document_shards', label: 'Page extraction and OCR', status: 'complete', priority: 'high' },
            { id: 'module.private_artifact', label: 'Private PDF artifact', status: 'complete', priority: 'high' },
          ] },
        },
        {
          id: 'stale-failure', stage: 'failed', progress: 38,
          created_at: '2026-09-23T06:34:00Z', updated_at: '2026-09-23T06:34:00Z',
          safe_metadata: { message: 'execution_failed' },
        },
      ] as any,
      [],
      'incomplete',
      100,
    );
    expect(rows).toEqual([
      { id: 'module.document_shards', label: 'Page extraction and OCR', status: 'complete', priority: 'high' },
      { id: 'module.private_artifact', label: 'Private PDF artifact', status: 'complete', priority: 'high' },
    ]);
  });

  it('uses the latest durable checkpoint and reconciles final structured lane checks', () => {
    const checkpoints = [
      {
        id: 'cp-1', stage: 'planning_research', progress: 25, created_at: '2026-09-19T20:00:00Z',
        safe_metadata: {
          milestones: [
            { id: 'core.plan', label: 'Case-specific research plan built', status: 'complete', priority: 'high' },
            { id: 'lane.registry', label: 'Verify legal entity in official registry', status: 'waiting', priority: 'critical' },
            { id: 'lane.bank', label: 'Confirm beneficiary account independently', status: 'manual', priority: 'critical' },
          ],
        },
      },
      {
        id: 'cp-2', stage: 'researching', progress: 30, created_at: '2026-09-19T20:01:00Z',
        safe_metadata: {
          milestones: [
            { id: 'core.plan', label: 'Case-specific research plan built', status: 'complete', priority: 'high' },
            { id: 'lane.registry', label: 'Verify legal entity in official registry', status: 'active', priority: 'critical' },
            { id: 'lane.bank', label: 'Confirm beneficiary account independently', status: 'manual', priority: 'critical' },
          ],
        },
      },
    ] as any;
    const checks = [
      { id: 'c-1', check_key: 'lane.registry', check_type: 'registry', description: 'Verify legal entity in official registry', status: 'complete', outcome: 'Matched official record' },
      { id: 'c-2', check_key: 'lane.bank', check_type: 'bank', description: 'Confirm beneficiary account independently', status: 'blocked', outcome: 'Direct bank confirmation required' },
    ] as any;
    const rows = deriveInvestigationMilestones(checkpoints, checks, 'completed', 100);
    expect(rows.find((row) => row.id === 'lane.registry')?.status).toBe('complete');
    expect(rows.find((row) => row.id === 'lane.bank')?.status).toBe('manual');
    expect(rows.find((row) => row.id === 'core.plan')?.status).toBe('complete');
  });

  it('adds persisted lane checks even when an older checkpoint has no milestone payload', () => {
    const rows = deriveInvestigationMilestones(
      [{ id: 'cp-old', stage: 'verifying', progress: 80, safe_metadata: {}, created_at: '2026-09-19T20:00:00Z' }] as any,
      [{ id: 'c-1', check_key: 'lane.sanctions', check_type: 'screening', description: 'Run sanctions screening', status: 'complete', outcome: 'No attributable hit' }] as any,
      'completed',
      100,
    );
    expect(rows).toEqual([
      { id: 'lane.sanctions', label: 'Run sanctions screening', status: 'complete', priority: 'medium' },
    ]);
  });

  it('does not let stale persisted checks mark an active retry complete', () => {
    const rows = deriveInvestigationMilestones(
      [{
        id: 'cp-live', stage: 'researching', progress: 57, created_at: '2026-09-22T19:00:00Z',
        safe_metadata: { milestones: [{ id: 'module.research_lanes', label: 'Bounded parallel specialist research', status: 'active', priority: 'medium' }] },
      }] as any,
      [{ id: 'c-old', check_key: 'lane.registry', check_type: 'registry', description: 'Old registry result', status: 'complete', outcome: 'Old run' }] as any,
      'researching',
      57,
    );
    expect(rows).toEqual([{ id: 'module.research_lanes', label: 'Bounded parallel specialist research', status: 'active', priority: 'medium' }]);
  });
});

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
