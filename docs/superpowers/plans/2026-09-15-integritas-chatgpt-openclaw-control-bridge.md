# Integritas ChatGPT ↔ OpenClaw Control Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a durable, reconnectable, least-privilege ChatGPT control path to the Oracle/OpenClaw runtime while keeping the OpenClaw Gateway loopback-only and Oracle outbound-only for routine control.

**Architecture:** ChatGPT talks to a narrow Integritas Control MCP/connector. The connector persists typed commands in Supabase. A non-root Oracle control worker polls and leases commands outbound over HTTPS and maps them to a fixed local allowlist of OpenClaw/systemd helper operations. Supabase persists heartbeat, results and audit records so future chats can reconnect without depending on session state.

**Tech Stack:** Supabase Postgres/RLS/Edge Functions, TypeScript/Deno for connector API, Node.js 24 for Oracle worker, systemd, existing OpenClaw 2026.9.4 runtime, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-15-integritas-chatgpt-openclaw-control-bridge-design.md`

## Global Constraints

- Keep PR #1 draft/unmerged.
- Do not expose the OpenClaw Gateway publicly; keep `127.0.0.1` binding.
- Do not place a Supabase service-role key, OpenClaw Gateway token, Oracle private key, provider key, or case evidence in GitHub.
- Routine Oracle control must be outbound-only.
- No generic remote shell, environment read, secret read, Docker socket, evidence delete, payment or autonomous email capability.
- Every mutation must be idempotent, auditable and schema-validated.
- Browser/admin roles may observe control state but may not lease/complete worker commands.
- Public `integritass.com` remains unaffected until preview/E2E approval.

---

### Task 1: Add the control-plane schema and atomic RPC contract

**Files:**
- Create: `supabase/migrations/0003_integritas_control_bridge.sql`
- Create: `supabase/rollback/0003_integritas_control_bridge.rollback.sql`
- Create: `supabase/tests/0005_integritas_control_bridge.sql`

**Interfaces:**
- Produces `integritas_control_commands`, `integritas_runtime_heartbeats`, `integritas_control_audit`.
- Produces RPCs `integritas_enqueue_control_command`, `integritas_lease_control_command`, `integritas_touch_control_command`, `integritas_complete_control_command`, `integritas_fail_control_command`, `integritas_upsert_runtime_heartbeat`.

- [ ] **Step 1: Write failing SQL contract tests** for RLS denial, idempotent enqueue, single lease, lease expiry/recovery, completion ownership and heartbeat upsert.
- [ ] **Step 2: Run the disposable PostgreSQL test job and confirm failure** because the migration does not yet exist.
- [ ] **Step 3: Implement the migration** with enums/check constraints, unique idempotency key, bounded JSON payload size checks, atomic `FOR UPDATE SKIP LOCKED` leasing, lease owner/expiry and append-only audit rows.
- [ ] **Step 4: Add rollback SQL** that drops RPCs/policies/tables in dependency order.
- [ ] **Step 5: Run SQL tests and confirm pass.**

### Task 2: Build a narrow Supabase control API suitable for a ChatGPT connector

**Files:**
- Create: `supabase/functions/integritas-control/index.ts`
- Create: `supabase/functions/integritas-control/deno.json`
- Create: `supabase/functions/integritas-control/README.md`
- Create: `scripts/test-integritas-control-contract.mjs`

**Interfaces:**
- Public/admin methods: `health`, `runtime_status`, `enqueue`, `command_status`, `case_status`, `case_progress`, `list_agent_runs`, `fetch_qa_summary`, `fetch_report`.
- `enqueue` accepts only the fixed command enum and validated payload per command.
- Worker lease/complete endpoints are separate and require a dedicated scoped worker credential.

- [ ] **Step 1: Write contract tests** proving unknown commands and arbitrary shell strings are rejected.
- [ ] **Step 2: Implement request schema validation and response redaction.**
- [ ] **Step 3: Implement authenticated admin/read routes and worker routes.**
- [ ] **Step 4: Verify unauthenticated access fails and secrets are never returned.**

### Task 3: Add the Oracle outbound control worker

**Files:**
- Create: `infra/openclaw/control-worker/package.json`
- Create: `infra/openclaw/control-worker/src/index.mjs`
- Create: `infra/openclaw/control-worker/src/commands.mjs`
- Create: `infra/openclaw/control-worker/src/client.mjs`
- Create: `infra/openclaw/control-worker/test/commands.test.mjs`
- Create: `infra/openclaw/integritas-control-worker.service`
- Create: `infra/openclaw/install-control-worker.sh`

**Interfaces:**
- Command handlers: `health`, `openclaw_status`, `restart_openclaw`, `verify_runtime`, `pause_case`, `resume_case`, `retry_failed_run`, `cancel_case`, `deploy_verified_update`.
- No handler accepts a shell command string.

- [ ] **Step 1: Write failing allowlist tests** proving command names outside the enum and payload fields such as `shell`, `env`, `sudo`, `dockerSocket` are rejected.
- [ ] **Step 2: Implement the pure command dispatcher.**
- [ ] **Step 3: Implement lease/heartbeat/complete/fail loop with jittered retry.**
- [ ] **Step 4: Add the hardened non-root systemd unit** with `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`, restricted writable paths and no Docker socket.
- [ ] **Step 5: Add installer with syntax/config validation and no secret echoing.**
- [ ] **Step 6: Run Node tests and shell syntax checks.**

### Task 4: Add bounded runtime helper operations

**Files:**
- Create: `infra/openclaw/control-worker/bin/openclaw-status`
- Create: `infra/openclaw/control-worker/bin/openclaw-restart`
- Create: `infra/openclaw/control-worker/bin/verify-runtime`
- Create: `infra/openclaw/control-worker/bin/deploy-verified-update`
- Modify: `infra/oracle/run-command.sh`

**Interfaces:**
- Helpers return JSON with exit status and non-sensitive summary.
- `deploy-verified-update` accepts only a 40-char Git commit SHA and refuses unverified/unapproved commits.

- [ ] **Step 1: Add tests for invalid commit SHA and unapproved deployment.**
- [ ] **Step 2: Implement read-only status/verify helpers.**
- [ ] **Step 3: Implement bounded restart through `systemctl restart openclaw-gateway`.**
- [ ] **Step 4: Implement deployment gate that checks repository, branch policy and CI status before installation.**
- [ ] **Step 5: Keep OCI Run Command as break-glass status/restart/verify only.**

### Task 5: Wire CI policy verification

**Files:**
- Create: `scripts/verify-control-bridge-policy.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- CI rejects public OpenClaw bind, `docker.sock`, generic shell endpoints, service-role literals, disabled auth, unbounded command names and missing RLS tests.

- [ ] **Step 1: Add verifier fixtures/assertions.**
- [ ] **Step 2: Add `node scripts/verify-control-bridge-policy.mjs` to CI.**
- [ ] **Step 3: Add SQL control-bridge test to disposable PostgreSQL job.**
- [ ] **Step 4: Add Node worker tests and `bash -n` for installer/helpers.**
- [ ] **Step 5: Run CI and require green before any Supabase/Oracle deployment.**

### Task 6: Deploy the backward-compatible Supabase control plane

**Dependencies:** Task 5 green.

- [ ] **Step 1: Apply migration `0003_integritas_control_bridge` to Supabase.**
- [ ] **Step 2: Run security advisor and verify no new RLS/security findings.**
- [ ] **Step 3: Deploy `integritas-control` Edge Function with JWT verification for admin routes and custom scoped auth for worker routes.**
- [ ] **Step 4: Smoke-test `health` and unauthenticated denial.**
- [ ] **Step 5: Enqueue a non-mutating `health` command and verify it remains queued until Oracle worker is online.**

### Task 7: Recover Oracle access and install the control worker

**One-time manual gate:** the user may need to complete legitimate Oracle login/MFA in Cloud Shell/console if no authorised remote device is online.

- [ ] **Step 1: Verify the actual Oracle VM identity, OS, architecture and cost state before touching it.**
- [ ] **Step 2: Verify OpenClaw Gateway is loopback-only and current runtime matches the pinned policy.**
- [ ] **Step 3: Install the repository control worker and `integritas-dd` skill using the verified green commit.**
- [ ] **Step 4: Provision only the scoped worker credential in the Oracle secret store/service environment without printing it.**
- [ ] **Step 5: Start and enable `integritas-control-worker.service`.**
- [ ] **Step 6: Confirm Oracle still has no routine public inbound control port.**

### Task 8: Prove bridge execution end to end

- [ ] **Step 1: Verify runtime heartbeat appears in Supabase.**
- [ ] **Step 2: Enqueue `health`; verify exactly one worker lease and completion.**
- [ ] **Step 3: Enqueue duplicate idempotency key; verify no second execution.**
- [ ] **Step 4: Execute `openclaw_status` and `verify_runtime`.**
- [ ] **Step 5: Perform one bounded `restart_openclaw`; verify Gateway returns healthy and command audit contains no secrets.**
- [ ] **Step 6: Kill/restart the worker during a synthetic leased command and verify lease expiry/resumption without double execution.**

### Task 9: Expose the narrow ChatGPT custom connector/MCP endpoint

- [ ] **Step 1: Publish only the approved connector tool schemas; exclude generic shell/config/secrets tools.**
- [ ] **Step 2: Require authenticated connector access and map the ChatGPT user to an authorised Integritas admin identity.**
- [ ] **Step 3: Complete the one-time ChatGPT connector authorization/addition if required by the product UI.**
- [ ] **Step 4: In a fresh ChatGPT session, call `health`, `runtime_status`, `openclaw_status` and one queued command to prove reconnectability.**

### Task 10: Integrate the bridge with the DD admin workflow

- [ ] **Step 1: Make DD case enqueue use the same durable control/job substrate rather than direct browser-to-Oracle execution.**
- [ ] **Step 2: Stream durable case progress from Supabase to the admin UI.**
- [ ] **Step 3: Verify OpenClaw case actions are visible from both ChatGPT connector and the admin panel.**
- [ ] **Step 4: Confirm report publication remains behind independent review + deterministic QA + admin approval.**

### Task 11: Security and release gate

- [ ] **Step 1: Red-team prompt injection, IDOR, worker credential theft, replay, malformed JSON and command-confusion attempts.**
- [ ] **Step 2: Verify public site and existing production admin remain unaffected.**
- [ ] **Step 3: Verify no secrets in Git history/build artifacts/logs.**
- [ ] **Step 4: Keep PR #1 draft and update its checkpoint with bridge test evidence.**
- [ ] **Step 5: Do not merge or publish the replacement admin until the later full DD E2E approval gate.**
