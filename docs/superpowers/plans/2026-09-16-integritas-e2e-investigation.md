# Integritas Oracle/OpenClaw E2E Investigation Plan

**Goal:** Let an authenticated Integritas admin upload 1–20 documents, start a durable Oracle/OpenClaw investigation, close the browser, and later review source-linked results behind deterministic QA and analyst approval.

## Global constraints

- Keep PR #1 draft/unmerged and public integritass.com unchanged.
- Keep OpenClaw Gateway loopback-only; Oracle routine control remains outbound-only.
- Supabase is the source of truth; Oracle/OpenClaw is the execution plane.
- Never place service-role keys, gateway/provider tokens, signed URLs, or evidence in Git.
- Queue payloads contain bounded identifiers/settings only, never prompts, shell, secrets, filenames, or document bytes.
- Raw uploads are hostile: extraction is isolated from privileged research tools.
- Every mutation is authenticated, authorized, revision-bound, idempotent, auditable, and resumable.
- Reports remain draft until deterministic QA plus a distinct human analyst review.

## Task 1: Atomic start contract and executable worker

- Add a transactional database RPC that verifies authorized case/job state and current revision, creates one openclaw-oracle case job plus one run_case_investigation control command, links them, and is idempotent.
- Keep connector and worker validation allowlists consistent.
- Implement a bounded executeCommand branch that invokes a fixed repository runner path with identifiers/settings as positional arguments; no shell strings.
- Add database, API-contract, validation, and execution tests. Make rollback refuse partial investigation commands/jobs.

## Task 2: Manifest, checkpoints, and results

- Worker retrieves an authorized server-generated manifest with short-lived signed object URLs.
- Persist bounded stage checkpoints, source/evidence references, failures, and completion incrementally.
- Verify job ownership, command linkage, current case revision, hashes, and allowed transitions.
- Never persist signed URLs in findings, reports, logs, or command results.

## Task 3: Hardened OpenClaw investigation runner

- Install and attest the repository integritas-dd skill in the verified OpenClaw workspace.
- Use isolated extraction, structured mapping, bounded research, independent verification, deterministic quality.py validation, and draft report persistence.
- Survive worker/OpenClaw restart from the last durable checkpoint.

## Task 4: Admin upload and workflow

- Enable authenticated, case-scoped 1–20 document direct uploads to private Supabase Storage using resumable upload support.
- Register immutable SHA-256 document records and deduplicate safely.
- Wire Start Deep Investigation to Task 1 and map durable progress/results to the existing UI.

## Task 5: Verification and controlled deployment

- Run unit/type/build/SQL/Playwright/policy tests.
- Run a hostile synthetic 20-document case with duplicate, corrupt, large, contradictory, same-name, and prompt-injection fixtures.
- Test browser disconnect, retry/cancel, worker restart, OpenClaw restart, stale report, RLS/IDOR, source lineage, and no secret leakage.
- Deploy only green backend/runtime changes; keep PR draft pending final publication approval.
