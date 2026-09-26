import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BUCKET = "integritas-case-files";
const TEST_BYTES = 8 * 1024 * 1024;
const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function secureEquals(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function authenticateWorker(req: Request) {
  const token = req.headers.get("x-integritas-worker-token") ?? "";
  const workerId = (req.headers.get("x-integritas-worker-id") ?? "").trim();
  if (!token || !workerId || workerId.length > 200) return null;
  const digest = await sha256Hex(new TextEncoder().encode(token));
  const { data, error } = await service
    .from("integritas_control_worker_credentials")
    .select("worker_id,token_sha256,enabled")
    .eq("worker_id", workerId)
    .maybeSingle();
  if (error || !data?.enabled || !secureEquals(digest, data.token_sha256)) return null;
  return workerId;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const workerId = await authenticateWorker(req);
  if (!workerId) return json({ error: "unauthorized" }, 401);

  const path = `_health/upload/${workerId}/${crypto.randomUUID()}.pdf`;
  const bytes = new Uint8Array(TEST_BYTES);
  bytes.fill(0x20);
  bytes.set(new TextEncoder().encode("%PDF-1.7\n% Integritas synthetic upload healthcheck\n"), 0);
  bytes.set(new TextEncoder().encode("\n%%EOF\n"), bytes.length - 7);
  const expectedSha256 = await sha256Hex(bytes);

  let uploaded = false;
  try {
    const put = await service.storage.from(BUCKET).upload(path, bytes, {
      contentType: "application/pdf",
      cacheControl: "0",
      upsert: false,
    });
    if (put.error) return json({ ok: false, stage: "upload", error: put.error.message }, 502);
    uploaded = true;

    const dl = await service.storage.from(BUCKET).download(path);
    if (dl.error || !dl.data) {
      return json({ ok: false, stage: "download", error: dl.error?.message ?? "download_failed" }, 502);
    }
    const downloaded = new Uint8Array(await dl.data.arrayBuffer());
    const actualSha256 = await sha256Hex(downloaded);
    if (downloaded.byteLength !== bytes.byteLength || actualSha256 !== expectedSha256) {
      return json({
        ok: false,
        stage: "integrity",
        expectedBytes: bytes.byteLength,
        actualBytes: downloaded.byteLength,
        expectedSha256,
        actualSha256,
      }, 500);
    }

    return json({
      ok: true,
      workerId,
      bucket: BUCKET,
      bytes: bytes.byteLength,
      sha256: expectedSha256,
      privatePath: path,
      cleaned: true,
    });
  } finally {
    if (uploaded) await service.storage.from(BUCKET).remove([path]);
  }
});
