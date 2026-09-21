const ACTIONS = new Set([
  "list_cases",
  "create_case",
  "snapshot",
  "upload",
  "start_analysis",
  "sync_job",
  "cancel_job",
  "review_report",
  "finalize_report",
  "archive_case",
  "purge_case",
  "create_thread",
  "thread_snapshot",
  "send_message",
  "admin_snapshot",
  "list_threads",
  "repository_request",
  "repository_approve",
]);
const MIME = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/pdf",
]);
export function validateAction(v: unknown) {
  const x = String(v || "");
  if (!ACTIONS.has(x))
    throw Object.assign(new Error("Unsupported action"), { status: 400 });
  return x;
}
function field(v: unknown, label: string, max: number, required = true) {
  const s = String(v ?? "").trim();
  if ((required && !s) || s.length > max)
    throw Object.assign(new Error(`${label} is invalid`), { status: 400 });
  return s;
}
export function validateCaseInput(x: any) {
  return {
    title: field(x?.title, "Case title", 160),
    purpose: field(x?.purpose, "Purpose", 4000),
    authorizedScope: field(x?.authorizedScope, "Authorized scope", 4000),
    intendedSubjects: field(
      x?.intendedSubjects,
      "Intended subjects",
      2000,
      false,
    ),
    jurisdictions: String(x?.jurisdictions || "")
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean)
      .slice(0, 20),
  };
}
export function validateQuestion(v: unknown) {
  return field(v, "Question", 3000);
}
export function validateMessage(v: unknown) {
  return field(v, "Message", 6000);
}
export function validateMode(v: unknown) {
  const x = String(v || "investigation");
  if (!["investigation", "development", "admin"].includes(x))
    throw Object.assign(new Error("Invalid workspace mode"), { status: 400 });
  return x;
}
export function validateAutonomy(v: unknown) {
  const x = String(v || "maximum_guarded");
  if (!["guided", "autonomous", "maximum_guarded"].includes(x))
    throw Object.assign(new Error("Invalid autonomy level"), { status: 400 });
  return x;
}
export function validateDepth(v: unknown) {
  const x = String(v || "deep");
  if (!["fast", "standard", "deep", "maximum"].includes(x))
    throw Object.assign(new Error("Invalid investigation depth"), {
      status: 400,
    });
  return x;
}
export function validateUpload(name: unknown, mime: unknown, size: unknown) {
  const clean = String(name ?? "")
    .replace(/[\\\\\r\n\"']/g, "")
    .trim()
    .slice(0, 220);
  if (!clean)
    throw Object.assign(new Error("File name is invalid"), { status: 400 });
  const m = String(mime || "").toLowerCase();
  const n = Number(size);
  if (!MIME.has(m))
    throw Object.assign(new Error("Unsupported file type"), { status: 400 });
  if (!Number.isFinite(n) || n < 1 || n > 50 * 1024 * 1024)
    throw Object.assign(new Error("Maximum upload size is 50 MB"), {
      status: 400,
    });
  return { name: clean, mime: m, size: n };
}
export async function sha256Bytes(bytes: Uint8Array) {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
