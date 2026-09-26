# Integritas ChatGPT ↔ OpenClaw Control Bridge Design

## Objective

Create a durable, reconnectable control path that lets authorised ChatGPT sessions operate the Integritas Oracle/OpenClaw runtime without exposing the OpenClaw Gateway, a general shell, Docker socket, or long-lived broad Supabase credentials.

## Approved architecture

The bridge is **control-plane first and outbound-only from Oracle**:

1. ChatGPT connects to a narrow Integritas Control MCP/connector.
2. The control service writes typed commands into Supabase control tables/queue and reads typed status/results.
3. A non-root Oracle `integritas-control-worker` continuously polls/leases commands over outbound HTTPS.
4. The worker executes only an explicit command allowlist against local OpenClaw/systemd helper scripts on the same host.
5. The OpenClaw Gateway remains bound to `127.0.0.1`; no public Gateway listener is created.
6. Command state, actor, timestamps, result summary, idempotency key and audit events persist in Supabase so future ChatGPT sessions can reconnect and inspect state.

Routine ChatGPT operations are intentionally limited to:

- `health`
- `openclaw_status`
- `list_cases`
- `case_status`
- `case_progress`
- `list_agent_runs`
- `pause_case`
- `resume_case`
- `retry_failed_run`
- `cancel_case`
- `fetch_qa_summary`
- `fetch_report`
- `restart_openclaw` (bounded systemd restart only)
- `verify_runtime`
- `deploy_verified_update` only for a GitHub commit that has already passed CI and an explicit deployment policy gate.

The bridge must never expose generic shell execution, environment/secrets reads, evidence deletion, payment/banking actions, autonomous email sending, arbitrary plugin installation, arbitrary gateway config mutation, Docker administration, or repository-main writes.

## Trust boundaries

- **Supabase** remains authoritative for control-command state, cases, DD progress, evidence/report metadata and audit records.
- **Oracle/OpenClaw** performs durable DD execution and bounded runtime operations.
- **GitHub** remains authoritative for versioned code/config and CI.
- **ChatGPT** is an orchestrator/reviewer that reconnects to the durable control plane; no chat session is itself a persistent connection.
- **Remote Desktop Commander / OCI Cloud Shell or Run Command** remains break-glass operator access, not the routine ChatGPT control path.

## Security invariants

- Oracle initiates outbound HTTPS only for routine control.
- OpenClaw Gateway stays loopback-only.
- Worker runs as dedicated non-root service account.
- Worker receives a scoped control credential, not a Supabase service-role key.
- Every mutating command uses an idempotency key and lease/heartbeat semantics.
- Commands are allowlisted and schema-validated before execution.
- Results contain operational summaries, not secrets or chain-of-thought.
- Admin/UI and connector reads are RLS-controlled.
- No production schema or runtime change is merged/deployed until CI and synthetic bridge tests pass.
- PR #1 remains draft/unmerged until persistent Oracle runtime E2E is verified.

## Control data contract

`integritas_control_commands` stores: command id, command type, request payload, requested actor, idempotency key, state (`queued|leased|running|completed|failed|cancelled`), lease owner/expiry, attempt, timestamps, result/error summaries and audit metadata.

`integritas_runtime_heartbeats` stores a single logical Oracle worker heartbeat containing runtime version, OpenClaw version/status, worker version, last check timestamp and non-sensitive capability flags.

Database RPCs provide atomic enqueue, lease, heartbeat, complete and fail transitions. Browser/admin roles receive read access only; command mutation is server-side/connector-only.

## Oracle worker contract

The worker performs a long-running loop:

- heartbeat runtime state;
- lease one command atomically;
- validate command type/payload;
- invoke only the matching local helper operation;
- heartbeat while running;
- persist success/failure summary;
- never execute arbitrary user-supplied shell text.

Bounded helper operations may call `systemctl is-active/restart openclaw-gateway`, the existing runtime verifier, local OpenClaw CLI status APIs, or case-control APIs. Deploy operations must verify the requested GitHub commit and CI status before installation.

## ChatGPT connector contract

The remote MCP/connector exposes one tool per allowed operation. It talks to the control API/Supabase, not directly to the OpenClaw Gateway. Authentication must be separate from Oracle's local Gateway token. One-time user action may be required to add/authorize the custom connector after its HTTPS endpoint is live.

## Verification gates

The bridge is not considered established until all of the following pass:

1. Unauthenticated command creation is denied.
2. Non-admin/admin-browser roles cannot mutate control records directly.
3. Duplicate idempotency keys execute once.
4. Expired leases are recoverable without double execution.
5. Unknown commands are rejected before execution.
6. Generic shell/env/secret requests are impossible through the schema.
7. Oracle can operate with no inbound public listener.
8. `health`, `openclaw_status`, bounded restart and runtime verification work end-to-end.
9. Worker restart resumes queued work.
10. ChatGPT custom connector can reconnect in a fresh session and read/issue bounded commands.
11. Existing public site is unaffected.
12. PR #1 remains draft/unmerged.
