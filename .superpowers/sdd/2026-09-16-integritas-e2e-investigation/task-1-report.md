# Task 1 implementation report

## Delivered

- Added a server-only, security-definer investigation-start RPC and public service-role wrapper.
- The transaction locks the case, verifies admin membership, explicit case access, existence, and current revision.
- It creates and links one OpenClaw case job and one run_case_investigation command with an exact bounded payload.
- Retries return the original job/command; the per-case/revision partial unique index prevents concurrent duplicate jobs.
- Added the authenticated start_case_investigation Edge action. It validates UUIDs, revision, depth, idempotency, and explicit case access before invoking the wrapper.
- Kept run_case_investigation out of generic enqueue, while allowlisting it only for the fixed start route and worker.
- Added worker validation and an execFile-only execution branch using the fixed runner path and four positional values; the default host environment is not passed through.
- Added SQL payload constraints, SQL contract coverage, and a CI rollback-preflight check for both jobs and commands.
- Rollback now intentionally fails before any constraint restoration while either durable investigation rows exist.

## Verification

Passed:

- node --test infra/openclaw/control-worker/test/*.test.mjs (9 tests)
- node scripts/test-integritas-control-contract.mjs
- npm test (3 tests)
- npm run lint
- npm run build
- node scripts/verify-control-bridge-policy.mjs
- node scripts/verify-oracle-openclaw-infra.mjs
- npm run verify:secrets and npm run verify:secrets -- dist
- git diff --check

Not run locally:

- Disposable PostgreSQL migration/contract suite: psql is unavailable and no local postgres:16 image is present. CI now runs the full fixture, migration, contract, and intentional rollback-preflight sequence.

## Self-review

The route and RPC both enforce admin plus case access, avoiding an IDOR/auth bypass. The locked case row, idempotency lookup, and unique index cover revision races and duplicate starts. The worker accepts no prompt/shell/environment data and uses a fixed executable plus bounded positional arguments. Rollback checks both persisted job and command rows. The remaining validation gap is local execution of the disposable PostgreSQL suite.
