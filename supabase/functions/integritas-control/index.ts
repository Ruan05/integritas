import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { normalizeLeaseCommand } from './lease.ts';
import {
  CASE_INVESTIGATION_DEPTHS, CASE_INVESTIGATION_STAGES, CHECKPOINT_METADATA_KEYS,
  INVESTIGATION_CONTENT_TYPES, INVESTIGATION_OUTPUT_TYPES,
} from '../_shared/investigation-runtime-contract.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CONNECTOR_TOKEN = Deno.env.get('INTEGRITAS_CONTROL_CONNECTOR_TOKEN') ?? '';
const ALLOWED_ORIGINS = new Set([
  'https://integritass.com',
  'https://www.integritass.com',
  'https://integritas-private-admin.ruansch1.chatgpt.site',
  ...(Deno.env.get('INTEGRITAS_CONTROL_ALLOWED_ORIGINS') ?? '')
    .split(',').map((value) => value.trim()).filter(Boolean),
]);

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Supabase runtime secrets are unavailable');
}

const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CONNECTOR_COMMANDS = new Set([
  'health',
  'openclaw_status',
  'restart_openclaw',
  'verify_runtime',
  'deploy_verified_update',
]);
const CASE_INVESTIGATION_COMMANDS = new Set(['run_case_investigation']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CASE_FILES_BUCKET = 'integritas-case-files';
const MAX_INVESTIGATION_ARTIFACT_BYTES = 5 * 1024 * 1024;
const CASE_FILES_BUCKET_ALLOWED_MIME_TYPES = [
  'application/pdf', 'text/plain', 'text/markdown', 'text/csv', 'application/json',
];

function secureEquals(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value: string): Promise<string> {
  return await sha256Bytes(new TextEncoder().encode(value));
}

function cors(origin: string | null) {
  const headers: Record<string, string> = {
    'access-control-allow-headers': 'authorization, content-type, x-integritas-worker-token, x-integritas-worker-id, x-integritas-connector-token, idempotency-key',
    'access-control-allow-methods': 'POST, OPTIONS',
    'vary': 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers['access-control-allow-origin'] = origin;
  return headers;
}

function originAllowed(origin: string | null) {
  return !origin || ALLOWED_ORIGINS.has(origin);
}

function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors(origin) },
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function validMilestones(value: unknown) {
  if (!Array.isArray(value) || value.length > 64) return false;
  const ids = new Set<string>();
  for (const row of value) {
    if (!isObject(row)) return false;
    const keys = Object.keys(row);
    if (keys.some((key) => !['id', 'label', 'status', 'priority'].includes(key))) return false;
    if (typeof row.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(row.id) || ids.has(row.id)) return false;
    if (typeof row.label !== 'string' || row.label.length < 1 || row.label.length > 160) return false;
    if (typeof row.status !== 'string' || !['waiting', 'active', 'complete', 'blocked', 'manual'].includes(row.status)) return false;
    if (typeof row.priority !== 'string' || !['low', 'medium', 'high', 'critical'].includes(row.priority)) return false;
    ids.add(row.id);
  }
  return true;
}

function validCheckpointMetadata(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.some((key) => !CHECKPOINT_METADATA_KEYS.has(key))) return false;
  if ('milestones' in value && !validMilestones(value.milestones)) return false;
  const encoded = JSON.stringify(value);
  return encoded.length <= 32768 && !encoded.includes('/storage/v1/object/sign/');
}

function decodeArtifactContent(content: unknown, encoding: unknown): Uint8Array | null {
  if (typeof content !== 'string' || content.length > MAX_INVESTIGATION_ARTIFACT_BYTES * 2) return null;
  try {
    if (encoding === 'base64') {
      const raw = atob(content);
      return Uint8Array.from(raw, (char) => char.charCodeAt(0));
    }
    if (encoding == null || encoding === 'utf8') return new TextEncoder().encode(content);
  } catch {
    return null;
  }
  return null;
}

function outputExtension(contentType: string): string {
  if (contentType === 'application/json') return 'json';
  if (contentType === 'application/pdf') return 'pdf';
  if (contentType === 'text/html') return 'html';
  if (contentType === 'text/markdown') return 'md';
  if (contentType === 'text/plain') return 'txt';
  if (contentType === 'text/csv') return 'csv';
  return 'bin';
}

function safeError(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : (isObject(error) && typeof error.message === 'string' ? error.message : String(error));
  return message.replace(/(bearer|token|password|secret|key)\s*[:=]\s*\S+/gi, '$1=[redacted]').slice(0, 800);
}

async function ensureCaseFilesStorageReady(workerId: string, commandId: string) {
  const { error: updateError } = await service.storage.updateBucket(CASE_FILES_BUCKET, {
    public: false,
    fileSizeLimit: MAX_INVESTIGATION_ARTIFACT_BYTES,
    allowedMimeTypes: CASE_FILES_BUCKET_ALLOWED_MIME_TYPES,
  });
  if (updateError) throw new Error('storage bucket configuration failed: ' + safeError(updateError));

  const safeWorkerId = workerId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
  const probePath = 'system/output-self-tests/' + safeWorkerId + '/' + commandId + '.json';
  const probe = new TextEncoder().encode('{"integritas_output_self_test":true}');
  const { error: uploadError } = await service.storage.from(CASE_FILES_BUCKET).upload(probePath, probe, {
    contentType: 'application/json',
    upsert: true,
  });
  if (uploadError) throw new Error('storage self-test upload failed: ' + safeError(uploadError));

  const { error: removeError } = await service.storage.from(CASE_FILES_BUCKET).remove([probePath]);
  if (removeError) throw new Error('storage self-test cleanup failed: ' + safeError(removeError));
  return { ok: true, bucket: CASE_FILES_BUCKET };
}

async function authenticateAdmin(req: Request) {
  const header = req.headers.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  const { data: authData, error: authError } = await service.auth.getUser(token);
  if (authError || !authData.user) return null;

  const { data: admin, error: adminError } = await service
    .from('integritas_admin_users')
    .select('user_id')
    .eq('user_id', authData.user.id)
    .maybeSingle();
  if (adminError || !admin) return null;
  return { kind: 'admin' as const, actor: `admin:${authData.user.id}`, userId: authData.user.id };
}

async function authenticate(req: Request) {
  const worker = req.headers.get('x-integritas-worker-token') ?? '';
  if (worker) {
    const workerId = (req.headers.get('x-integritas-worker-id') ?? '').trim();
    if (!workerId || workerId.length > 200) return null;
    const digest = await sha256Hex(worker);
    const { data: credential, error } = await service
      .from('integritas_control_worker_credentials')
      .select('worker_id,token_sha256,enabled')
      .eq('worker_id', workerId)
      .maybeSingle();
    if (error || !credential || !credential.enabled || !secureEquals(digest, credential.token_sha256)) return null;
    return { kind: 'worker' as const, actor: `worker:${workerId}`, userId: null, workerId };
  }

  const connector = req.headers.get('x-integritas-connector-token') ?? '';
  if (connector) {
    if (!secureEquals(connector, CONNECTOR_TOKEN)) return null;
    return { kind: 'connector' as const, actor: 'chatgpt-connector', userId: null };
  }

  return await authenticateAdmin(req);
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await service.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') {
    if (!originAllowed(origin)) return new Response(null, { status: 403, headers: cors(origin) });
    return new Response(null, { status: 204, headers: cors(origin) });
  }
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, origin);

  try {
    const body = await req.json().catch(() => ({}));
    if (!isObject(body) || typeof body.action !== 'string') {
      return json({ error: 'invalid_request' }, 400, origin);
    }

    const principal = await authenticate(req);
    if (!principal) return json({ error: 'unauthorized' }, 401, origin);
    const action = body.action;

    if (principal.kind === 'worker') {
      const workerId = principal.workerId;
      if (body.worker_id != null && body.worker_id !== workerId) return json({ error: 'worker_identity_mismatch' }, 403, origin);

      if (action === 'worker_heartbeat') {
        const data = await rpc('integritas_control_heartbeat', {
          p_worker_id: workerId,
          p_runtime_version: String(body.runtime_version ?? '').slice(0, 200),
          p_openclaw_version: body.openclaw_version == null ? null : String(body.openclaw_version).slice(0, 200),
          p_openclaw_status: String(body.openclaw_status ?? 'unknown').slice(0, 100),
          p_worker_version: String(body.worker_version ?? '').slice(0, 200),
          p_capability_flags: isObject(body.capability_flags) ? body.capability_flags : {},
        });
        return json({ ok: true, heartbeat: data }, 200, origin);
      }

      if (action === 'worker_lease') {
        const data = await rpc('integritas_control_lease', { p_worker_id: workerId, p_lease_seconds: 90 });
        return json({ command: normalizeLeaseCommand(data) }, 200, origin);
      }

      const commandId = typeof body.command_id === 'string' ? body.command_id : '';
      if (!/^[0-9a-f-]{36}$/i.test(commandId)) return json({ error: 'invalid_command_id' }, 400, origin);

      if (action === 'worker_storage_selftest') {
        const storage = await ensureCaseFilesStorageReady(workerId, commandId);
        return json({ storage }, 200, origin);
      }

      if (action === 'worker_manifest') {
        const caseJobId = body.case_job_id;
        if (!validUuid(caseJobId)) return json({ error: 'invalid_case_job_id' }, 400, origin);
        const rawContext = await rpc('integritas_investigation_manifest_context', {
          p_command_id: commandId, p_worker_id: workerId, p_case_job_id: caseJobId,
        });
        if (!isObject(rawContext) || !Array.isArray(rawContext.documents)) {
          throw new Error('invalid investigation manifest context');
        }
        const documents = rawContext.documents.filter(isObject);
        const paths = documents.map((document) => document.storage_path).filter((value): value is string => typeof value === 'string');
        if (paths.length !== documents.length || paths.length < 1 || paths.length > 20) {
          throw new Error('invalid investigation document manifest');
        }
        const { data: signed, error: signedError } = await service.storage
          .from(CASE_FILES_BUCKET).createSignedUrls(paths, 600);
        if (signedError || !signed || signed.length !== paths.length) throw signedError ?? new Error('signed URL generation failed');
        const signedByPath = new Map(signed.map((item) => [item.path, item.signedUrl]));
        const manifestDocuments = documents.map((document) => ({
          ...document,
          download_url: signedByPath.get(String(document.storage_path)) ?? null,
        }));
        if (manifestDocuments.some((document) => !document.download_url)) throw new Error('incomplete signed document manifest');
        return json({ manifest: { ...rawContext, documents: manifestDocuments, expires_in_seconds: 600 } }, 200, origin);
      }

      if (action === 'worker_checkpoint') {
        const caseJobId = body.case_job_id;
        const caseRevision = body.case_revision;
        const stage = body.stage;
        const progress = body.progress;
        const safeMetadata = body.safe_metadata ?? {};
        if (!validUuid(caseJobId)
          || !Number.isInteger(caseRevision) || Number(caseRevision) < 0
          || typeof stage !== 'string' || !CASE_INVESTIGATION_STAGES.has(stage)
          || !Number.isInteger(progress) || Number(progress) < 0 || Number(progress) > 100
          || !validCheckpointMetadata(safeMetadata)) {
          return json({ error: 'invalid_checkpoint' }, 400, origin);
        }
        const checkpoint = await rpc('integritas_checkpoint_case_investigation', {
          p_command_id: commandId, p_worker_id: workerId, p_case_job_id: caseJobId,
          p_case_revision: caseRevision, p_stage: stage, p_progress: progress,
          p_safe_metadata: safeMetadata,
        });
        return json({ checkpoint }, 200, origin);
      }

      if (action === 'worker_register_research_source') {
        const caseJobId = body.case_job_id;
        const caseRevision = body.case_revision;
        const sourceKey = typeof body.source_key === 'string' ? body.source_key : '';
        const url = typeof body.url === 'string' ? body.url : '';
        const title = typeof body.title === 'string' ? body.title.trim().slice(0, 500) : '';
        const retrievedAt = typeof body.retrieved_at === 'string' ? body.retrieved_at : '';
        const toolSummary = isObject(body.tool_summary) ? body.tool_summary : {};
        const tools = Array.isArray(toolSummary.tools)
          ? toolSummary.tools.filter((tool): tool is string => typeof tool === 'string' && ['web_search', 'web_fetch', 'browser'].includes(tool)).slice(0, 8)
          : [];
        const calls = Number(toolSummary.calls);
        const failures = Number(toolSummary.failures);
        let parsedUrl: URL | null = null;
        try { parsedUrl = new URL(url); } catch {}
        const retrievedMs = Date.parse(retrievedAt);
        if (!validUuid(caseJobId)
          || !Number.isInteger(caseRevision) || Number(caseRevision) < 0
          || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(sourceKey)
          || !parsedUrl || parsedUrl.protocol !== 'https:' || url.length > 2048
          || !title || !Number.isFinite(retrievedMs)
          || !Number.isInteger(calls) || calls < 1 || calls > 500
          || !Number.isInteger(failures) || failures < 0 || failures > calls
          || tools.length < 1) {
          return json({ error: 'invalid_research_source_provenance' }, 400, origin);
        }
        const context = await rpc('integritas_investigation_manifest_context', {
          p_command_id: commandId, p_worker_id: workerId, p_case_job_id: caseJobId,
        });
        if (!isObject(context) || !validUuid(context.case_id) || context.case_revision !== caseRevision) {
          throw new Error('invalid research source job context');
        }
        const safeMetadata = { source_key: sourceKey, url, tools: [...new Set(tools)], calls, failures };
        const existing = await service.from('integritas_tool_invocations')
          .select('id')
          .eq('case_id', context.case_id)
          .eq('case_job_id', caseJobId)
          .eq('tool_name', 'openclaw_external_research')
          .eq('status', 'completed')
          .contains('safe_metadata', { source_key: sourceKey, url })
          .order('completed_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existing.error) throw existing.error;
        if (existing.data?.id) return json({ tool_invocation_id: existing.data.id }, 200, origin);
        const { data: inserted, error: insertError } = await service.from('integritas_tool_invocations').insert({
          case_id: context.case_id,
          case_job_id: caseJobId,
          tool_name: 'openclaw_external_research',
          query_summary: title,
          status: 'completed',
          safe_metadata: safeMetadata,
          invoked_at: retrievedAt,
          completed_at: new Date().toISOString(),
        }).select('id').single();
        if (insertError || !inserted?.id) throw insertError ?? new Error('research provenance insert failed');
        return json({ tool_invocation_id: inserted.id }, 201, origin);
      }

      if (action === 'worker_publish_output') {
        const caseJobId = body.case_job_id;
        const caseRevision = body.case_revision;
        const outputType = body.output_type;
        const contentType = body.content_type;
        const expectedSha = body.sha256;
        const safeMetadata = body.safe_metadata ?? {};
        const encodedMetadata = isObject(safeMetadata) ? JSON.stringify(safeMetadata) : '';
        if (!validUuid(caseJobId)
          || !Number.isInteger(caseRevision) || Number(caseRevision) < 0
          || typeof outputType !== 'string' || !INVESTIGATION_OUTPUT_TYPES.has(outputType)
          || typeof contentType !== 'string' || !INVESTIGATION_CONTENT_TYPES.has(contentType)
          || typeof expectedSha !== 'string' || !SHA256_PATTERN.test(expectedSha)
          || !isObject(safeMetadata) || encodedMetadata.length > 16384
          || encodedMetadata.includes('/storage/v1/object/sign/')
          || ((outputType === 'report_pdf') !== (contentType === 'application/pdf'))) {
          return json({ error: 'invalid_output_metadata' }, 400, origin);
        }
        const bytes = decodeArtifactContent(body.content, body.encoding);
        if (!bytes || bytes.byteLength > MAX_INVESTIGATION_ARTIFACT_BYTES) {
          return json({ error: 'invalid_output_content' }, 400, origin);
        }
        if ((contentType === 'application/json' || contentType === 'text/html' || contentType === 'text/plain' || contentType === 'text/markdown')
          && new TextDecoder().decode(bytes).includes('/storage/v1/object/sign/')) {
          return json({ error: 'signed_url_persistence_forbidden' }, 400, origin);
        }
        const actualSha = await sha256Bytes(bytes);
        if (!secureEquals(actualSha, expectedSha)) return json({ error: 'output_digest_mismatch' }, 400, origin);
        await ensureCaseFilesStorageReady(workerId, commandId);
        const context = await rpc('integritas_investigation_manifest_context', {
          p_command_id: commandId, p_worker_id: workerId, p_case_job_id: caseJobId,
        });
        if (!isObject(context) || !validUuid(context.case_id)) throw new Error('invalid output job context');
        const storagePath = `cases/${context.case_id}/jobs/${caseJobId}/outputs/${outputType}/${actualSha}.${outputExtension(contentType)}`;
        const { error: uploadError } = await service.storage.from(CASE_FILES_BUCKET).upload(storagePath, bytes, {
          contentType, upsert: true,
        });
        if (uploadError) throw uploadError;
        let output;
        try {
          if (outputType === 'report_pdf') {
            output = await rpc('integritas_register_report_pdf_output', {
              p_command_id: commandId, p_worker_id: workerId, p_case_job_id: caseJobId,
              p_case_revision: caseRevision, p_storage_path: storagePath,
              p_sha256: actualSha, p_size_bytes: bytes.byteLength, p_safe_metadata: safeMetadata,
            });
          } else {
            output = await rpc('integritas_register_case_job_output', {
              p_command_id: commandId, p_worker_id: workerId, p_case_job_id: caseJobId,
              p_case_revision: caseRevision, p_output_type: outputType, p_content_type: contentType,
              p_storage_path: storagePath, p_sha256: actualSha, p_size_bytes: bytes.byteLength,
              p_safe_metadata: safeMetadata,
            });
          }
        } catch (error) {
          const { error: cleanupError } = await service.storage.from(CASE_FILES_BUCKET).remove([storagePath]);
          if (cleanupError) console.error('investigation artifact cleanup failed', safeError(cleanupError));
          throw error;
        }
        return json({ output }, 200, origin);
      }

      if (action === 'worker_commit_bundle') {
        const caseJobId = body.case_job_id;
        const caseRevision = body.case_revision;
        const bundleSha = body.bundle_sha256;
        const reportSha = body.report_sha256;
        const bundle = body.bundle;
        if (!validUuid(caseJobId)
          || !Number.isInteger(caseRevision) || Number(caseRevision) < 0
          || typeof bundleSha !== 'string' || !SHA256_PATTERN.test(bundleSha)
          || typeof reportSha !== 'string' || !SHA256_PATTERN.test(reportSha)
          || !isObject(bundle)) {
          return json({ error: 'invalid_bundle_commit' }, 400, origin);
        }
        const encodedBundle = JSON.stringify(bundle);
        if (new TextEncoder().encode(encodedBundle).byteLength > MAX_INVESTIGATION_ARTIFACT_BYTES
          || encodedBundle.includes('/storage/v1/object/sign/')) {
          return json({ error: 'invalid_bundle_commit' }, 400, origin);
        }
        const commitSummary = await rpc('integritas_commit_investigation_bundle', {
          p_command_id: commandId,
          p_worker_id: workerId,
          p_case_job_id: caseJobId,
          p_case_revision: caseRevision,
          p_bundle_sha256: bundleSha,
          p_report_sha256: reportSha,
          p_bundle: bundle,
        });

        // Learn only from aggregate execution quality signals. Never persist names,
        // claims, excerpts, URLs, identifiers, or other case evidence as a lesson.
        try {
          const sources = Array.isArray(bundle.sources) ? bundle.sources : [];
          const submittedDocumentIds = new Set(
            sources
              .filter((source) => isObject(source) && source.evidence_origin === 'submitted_document' && validUuid(source.document_id))
              .map((source) => String(source.document_id)),
          );
          const safeMetadata = {
            case_job_id: caseJobId,
            case_revision: caseRevision,
            depth: typeof bundle.depth === 'string' ? bundle.depth : null,
            document_count: submittedDocumentIds.size,
            entity_count: Array.isArray(bundle.entities) ? bundle.entities.length : 0,
            relationship_count: Array.isArray(bundle.relationships) ? bundle.relationships.length : 0,
            source_count: sources.length,
            external_source_count: sources.filter((source) => isObject(source) && source.evidence_origin === 'external_research').length,
            finding_count: Array.isArray(bundle.findings) ? bundle.findings.length : 0,
            check_count: Array.isArray(bundle.checks) ? bundle.checks.length : 0,
            contradiction_count: Array.isArray(bundle.contradictions) ? bundle.contradictions.length : 0,
            unresolved_count: Array.isArray(bundle.unresolved_checks) ? bundle.unresolved_checks.length : 0,
            terminal_outcome: isObject(bundle.execution) && typeof bundle.execution.terminal_outcome === 'string'
              ? bundle.execution.terminal_outcome
              : 'unknown',
          };
          const { data: existingLesson, error: lessonLookupError } = await service
            .from('integritas_agent_lessons')
            .select('id')
            .eq('task_class', 'openclaw_investigation')
            .contains('safe_metadata', { case_job_id: caseJobId })
            .limit(1)
            .maybeSingle();
          if (lessonLookupError) throw lessonLookupError;
          if (!existingLesson) {
            const toolCount = isObject(bundle.execution) && Array.isArray(bundle.execution.tool_results)
              ? bundle.execution.tool_results.length
              : 0;
            const { error: lessonInsertError } = await service.from('integritas_agent_lessons').insert({
              task_class: 'openclaw_investigation',
              provider: null,
              model: null,
              outcome: safeMetadata.terminal_outcome,
              retry_count: 0,
              tool_count: toolCount,
              reviewer_result: 'deterministic_qa_passed',
              human_correction: null,
              safe_metadata: safeMetadata,
            });
            if (lessonInsertError) throw lessonInsertError;
          }
        } catch (lessonError) {
          console.error('integritas lesson recording failed', safeError(lessonError));
        }

        return json({ commit_summary: commitSummary }, 200, origin);
      }

      if (action === 'worker_job_state') {
        const caseJobId = body.case_job_id;
        if (!validUuid(caseJobId)) return json({ error: 'invalid_case_job_id' }, 400, origin);
        const state = await rpc('integritas_investigation_job_state', {
          p_command_id: commandId, p_worker_id: workerId, p_case_job_id: caseJobId,
        });
        return json({ state }, 200, origin);
      }
      if (action === 'worker_cancel_ack') {
        const caseJobId = body.case_job_id;
        if (!validUuid(caseJobId)) return json({ error: 'invalid_case_job_id' }, 400, origin);
        const ok = await rpc('integritas_acknowledge_case_investigation_cancel', {
          p_command_id: commandId, p_worker_id: workerId, p_case_job_id: caseJobId,
        });
        return json({ ok: !!ok }, ok ? 200 : 409, origin);
      }
      if (action === 'worker_touch') {
        const ok = await rpc('integritas_control_touch', { p_command_id: commandId, p_worker_id: workerId, p_lease_seconds: 90 });
        return json({ ok: !!ok }, ok ? 200 : 409, origin);
      }
      if (action === 'worker_complete') {
        const result = isObject(body.result_summary) ? body.result_summary : {};
        const ok = await rpc('integritas_control_complete', { p_command_id: commandId, p_worker_id: workerId, p_result_summary: result });
        return json({ ok: !!ok }, ok ? 200 : 409, origin);
      }
      if (action === 'worker_fail') {
        const ok = await rpc('integritas_control_fail', {
          p_command_id: commandId,
          p_worker_id: workerId,
          p_error_code: String(body.error_code ?? 'execution_failed').slice(0, 120),
          p_error_summary: String(body.error_summary ?? 'command failed').slice(0, 1000),
        });
        return json({ ok: !!ok }, ok ? 200 : 409, origin);
      }
      return json({ error: 'worker_action_not_allowed' }, 403, origin);
    }

    if (action === 'health') {
      return json({ ok: true, component: 'integritas-control', principal: principal.kind }, 200, origin);
    }

    if (action === 'runtime_status') {
      const { data, error } = await service
        .from('integritas_runtime_heartbeats')
        .select('worker_id,runtime_version,openclaw_version,openclaw_status,worker_version,capability_flags,last_seen_at')
        .order('last_seen_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      return json({ runtimes: data ?? [] }, 200, origin);
    }

    if (action === 'command_status') {
      const commandId = typeof body.command_id === 'string' ? body.command_id : '';
      if (!/^[0-9a-f-]{36}$/i.test(commandId)) return json({ error: 'invalid_command_id' }, 400, origin);
      const { data, error } = await service
        .from('integritas_control_commands')
        .select('id,case_id,command_type,status,attempt,requested_at,leased_at,started_at,completed_at,updated_at,result_summary,error_code,error_summary')
        .eq('id', commandId)
        .maybeSingle();
      if (error) throw error;
      return json({ command: data ?? null }, data ? 200 : 404, origin);
    }

    if (action === 'start_case_investigation') {
      if (principal.kind !== 'admin' || !CASE_INVESTIGATION_COMMANDS.has('run_case_investigation')) {
        return json({ error: 'action_not_allowed' }, 403, origin);
      }
      const caseId = body.case_id;
      const caseRevision = body.case_revision;
      const depth = body.depth;
      if (!validUuid(caseId)
        || !Number.isInteger(caseRevision) || caseRevision < 0
        || typeof depth !== 'string' || !CASE_INVESTIGATION_DEPTHS.has(depth)) {
        return json({ error: 'invalid_investigation_request' }, 400, origin);
      }
      const idempotencyKey = typeof body.idempotency_key === 'string'
        ? body.idempotency_key
        : (req.headers.get('idempotency-key') ?? '');
      if (idempotencyKey.trim().length < 8 || idempotencyKey.length > 200) {
        return json({ error: 'invalid_idempotency_key' }, 400, origin);
      }
      const { data: access, error: accessError } = await service
        .from('integritas_case_access')
        .select('case_id')
        .eq('case_id', caseId)
        .eq('user_id', principal.userId)
        .maybeSingle();
      if (accessError) throw accessError;
      if (!access) return json({ error: 'case_access_denied' }, 403, origin);

      const data = await rpc('integritas_start_case_investigation', {
        p_case_id: caseId,
        p_case_revision: caseRevision,
        p_depth: depth,
        p_requested_by: principal.userId,
        p_idempotency_key: idempotencyKey,
      });
      const investigation = Array.isArray(data) ? data[0] ?? null : data;
      if (!investigation) throw new Error('investigation start returned no result');
      return json({ investigation }, 202, origin);
    }

    if (action === 'retry_case_investigation' || action === 'cancel_case_investigation') {
      if (principal.kind !== 'admin') return json({ error: 'action_not_allowed' }, 403, origin);
      const caseJobId = body.case_job_id;
      if (!validUuid(caseJobId)) return json({ error: 'invalid_case_job_id' }, 400, origin);
      const rpcName = action === 'retry_case_investigation'
        ? 'integritas_retry_case_investigation'
        : 'integritas_cancel_case_investigation';
      const result = await rpc(rpcName, {
        p_case_job_id: caseJobId,
        p_requested_by: principal.userId,
      });
      return json({ investigation: result }, 200, origin);
    }

    if (action === 'enqueue') {
      const commandType = typeof body.command_type === 'string' ? body.command_type : '';
      if (!CONNECTOR_COMMANDS.has(commandType)) return json({ error: 'command_not_allowed' }, 400, origin);
      if (commandType === 'deploy_verified_update' && principal.kind !== 'connector') {
        return json({ error: 'action_not_allowed' }, 403, origin);
      }
      const payload = isObject(body.payload) ? body.payload : {};
      if (commandType === 'deploy_verified_update') {
        const keys = Object.keys(payload);
        if (keys.length !== 1 || keys[0] !== 'release_sha'
          || typeof payload.release_sha !== 'string' || !/^[0-9a-f]{40}$/.test(payload.release_sha)) {
          return json({ error: 'invalid_release_sha' }, 400, origin);
        }
      }
      const forbiddenKeys = ['shell', 'command', 'cmd', 'env', 'sudo', 'secret', 'token', 'password', 'dockerSocket', 'docker_socket'];
      if (forbiddenKeys.some((key) => Object.prototype.hasOwnProperty.call(payload, key))) {
        return json({ error: 'forbidden_payload_field' }, 400, origin);
      }
      const idempotencyKey = typeof body.idempotency_key === 'string'
        ? body.idempotency_key
        : (req.headers.get('idempotency-key') ?? '');
      if (idempotencyKey.trim().length < 8 || idempotencyKey.length > 200) {
        return json({ error: 'invalid_idempotency_key' }, 400, origin);
      }
      const data = await rpc('integritas_control_enqueue', {
        p_command_type: commandType,
        p_payload: payload,
        p_requested_actor: principal.actor,
        p_requested_by: principal.userId,
        p_idempotency_key: idempotencyKey,
        p_case_id: null,
      });
      return json({ command: data }, 202, origin);
    }

    return json({ error: 'action_not_allowed' }, 403, origin);
  } catch (error) {
    console.error('integritas-control request failed', safeError(error));
    return json({ error: 'control_request_failed', detail: safeError(error) }, 500, origin);
  }
});
