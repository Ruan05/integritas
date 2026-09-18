# Task 1 brief: Atomic OpenClaw investigation start and executable worker

Worktree: /home/opc/integritas-e2e-investigation
Plan: docs/superpowers/plans/2026-09-16-integritas-e2e-investigation.md

Existing uncommitted work includes the lease null-row fix, runtime-provider migration, and run_case_investigation payload validation. Preserve and complete it.

Requirements:
1. Add an atomic security-definer database RPC used only through a server wrapper. It must verify case existence/current revision, create exactly one openclaw-oracle integritas_case_jobs row and one run_case_investigation control command, link them, bind command.case_id and payload IDs/revision/depth, and be idempotent under retry/concurrency.
2. Payload is exactly case_id, case_job_id, case_revision, depth. UUIDs must be valid; depth fast|standard|deep|maximum; no prompt, shell, filenames, URLs, secrets, or bytes.
3. Add the fixed command to the Edge API allowlist and expose an authenticated admin start route that verifies integritas_admin_users and explicit case access before calling the wrapper/RPC. Do not expose arbitrary enqueue.
4. Implement executeCommand for run_case_investigation using execFile only, calling a fixed repository runner path with the four bounded values as positional args. No shell, env passthrough, dynamic executable, or user prompt.
5. Add/extend worker validation + execution tests, API contract tests, and disposable PostgreSQL tests for idempotency, revision mismatch, command/job linkage, and case consistency.
6. Rollback must preflight both OpenClaw jobs and run_case_investigation command rows so it fails intentionally before restoring the old check constraint.
7. Run targeted tests plus npm test, npm run lint, npm run build, worker tests, contract checks, and disposable PostgreSQL contract if available.
8. Do not deploy, push, merge, expose the Gateway, or print secrets.
9. Commit all Task 1 changes (including pre-existing uncommitted Task 1 work) on the current branch with a clear commit message.
10. Self-review for auth bypass, IDOR, duplicate jobs, revision races, shell injection, rollback failure, and test gaps.

Write the full implementation/test report to task-1-report.md in this workspace. Return only status, commit SHA, one-line test summary, and concerns. Do not spawn subagents.
