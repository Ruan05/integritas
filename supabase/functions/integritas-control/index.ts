import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CONNECTOR_TOKEN = Deno.env.get('INTEGRITAS_CONTROL_CONNECTOR_TOKEN') ?? '';
const ALLOWED_ORIGIN = Deno.env.get('INTEGRITAS_CONTROL_ALLOWED_ORIGIN') ?? 'https://integritass.com';

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
]);

function secureEquals(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function cors(origin: string | null) {
  const allowed = origin && origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;
  return {
    'access-control-allow-origin': allowed,
    'access-control-allow-headers': 'authorization, content-type, x-integritas-worker-token, x-integritas-worker-id, x-integritas-connector-token, idempotency-key',
    'access-control-allow-methods': 'POST, OPTIONS',
    'vary': 'Origin',
  };
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

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(bearer|token|password|secret|key)\s*[:=]\s*\S+/gi, '$1=[redacted]').slice(0, 800);
}

function normalizeLeaseCommand(data: unknown): unknown {
  if (Array.isArray(data)) return data[0] ?? null;
  return data ?? null;
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
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
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

    if (action === 'enqueue') {
      const commandType = typeof body.command_type === 'string' ? body.command_type : '';
      if (!CONNECTOR_COMMANDS.has(commandType)) return json({ error: 'command_not_allowed' }, 400, origin);
      const payload = isObject(body.payload) ? body.payload : {};
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
