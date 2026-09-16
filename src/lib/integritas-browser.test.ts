import { describe, expect, it, vi } from 'vitest';
import {
  MAX_CASE_DOCUMENTS,
  canStartInvestigation,
  createIntegritasBrowserClient,
  getIntegritasFunctionUrls,
  isInvestigationRuntimeReady,
  validateCaseDocumentSelection,
} from './integritas-browser';

describe('Integritas browser adapter', () => {
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

  it('requires a fresh attested 0.2.0+ Oracle investigation runtime before enabling start', () => {
    const now = new Date('2026-09-16T22:00:00Z').getTime();
    const flags = { bounded_control: true, docker_socket: false, case_investigation: true, signed_manifests: true, durable_checkpoints: true, arbitrary_shell: false };
    const runtime = { worker_id: 'oracle-primary', worker_version: '0.2.0', openclaw_status: 'active', last_seen_at: '2026-09-16T21:59:30Z', capability_flags: flags };
    expect(isInvestigationRuntimeReady(runtime, now)).toBe(true);
    expect(isInvestigationRuntimeReady({ ...runtime, worker_version: '0.1.0' }, now)).toBe(false);
    expect(isInvestigationRuntimeReady({ ...runtime, last_seen_at: '2026-09-16T21:57:00Z' }, now)).toBe(false);
  });

  it('derives same-project function URLs and keeps start gated', () => {
    expect(getIntegritasFunctionUrls('https://abc.supabase.co')).toEqual({
      adminApiUrl: 'https://abc.supabase.co/functions/v1/integritas-admin-api',
      controlApiUrl: 'https://abc.supabase.co/functions/v1/integritas-control',
    });
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
