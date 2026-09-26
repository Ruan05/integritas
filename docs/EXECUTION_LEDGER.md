# Integritas Execution Ledger

## Current checkpoint

- Repository: `Ruan05/integritas`
- Pull request: [#1](https://github.com/Ruan05/integritas/pull/1) — keep draft/unmerged until final production approval.
- Branch: `integritas-command-center-foundation`
- Verified security/application checkpoint: `fbb90e49a9023eba809e676c57561474019620f9` with CI run #53 PASS.
- Current branch also includes the post-checkpoint OpenClaw runtime-candidate research in `docs/OPENCLAW_RUNTIME_CANDIDATES.md`.
- Public production: `https://integritass.com` — freshly verified HTTP 200 and preserve unchanged until explicit publication approval.
- Existing private admin remains the behavioral baseline and rollback target.

## Completed in the continuation

### GitHub / CI

- Repaired the original Vite environment typing failure and committed a reproducible npm lockfile.
- Hardened the public-repository workflow with:
  - `permissions: contents: read`;
  - `persist-credentials: false` on checkout;
  - concurrency cancellation for superseded runs;
  - immutable SHAs for checkout, setup-node and upload-artifact actions;
  - bounded job timeouts;
  - source/build secret checks;
  - high-severity dependency audit;
  - Playwright failure artifacts.
- Playwright runs one worker in CI for deterministic coverage while retaining desktop Chromium and mobile WebKit projects.
- Oracle/OpenClaw bootstrap scripts are syntax-checked by CI.
- CI run #53 passed both the application verification job and the database-security job on head `fbb90e49a9023eba809e676c57561474019620f9`.

### Supabase RLS — staged, not production-applied

- Inspected the live schema, grants, policies, indexes and current server-side Admin API behavior.
- Identified and fixed a concrete staged-policy bug: `integritas_cases.created_by` is `text`, so the prior direct `created_by = auth.uid()` browser insert policy was invalid.
- Confirmed meaningful writes are already performed through the authenticated server-side Admin API/service-role path; browser writes therefore remain disabled.
- Added a disposable PostgreSQL security fixture that mirrors the security-relevant columns and deliberately begins with broad browser grants so the migration must revoke them.
- Updated `0002_integritas_browser_read_policies.sql` to:
  - revoke legacy/default `anon` and `authenticated` grants across all 26 protected tables;
  - grant authenticated read access only to explicitly browser-readable tables;
  - keep all browser writes server-gated;
  - use least-privilege row policies for admin/case/thread/change-set/repository reads;
  - keep deploy, E2E-token, MCP allowlist and OpenCode transport tables server-only;
  - place `security definer` helpers in dedicated `integritas_private` schema with empty `search_path`, fully-qualified references and explicit schema/function privileges.
- Expanded the policy contract to require policies on all 26 advisor-reported protected tables.
- Added behavioral authorization assertions for anonymous denial, browser-write denial, server-only internal tables, authorized-case reads, cross-case isolation, admin behavior and private helper-schema privilege boundaries.
- Added and tested a safe rollback that returns browser roles to server-only/default-deny without restoring historical broad grants.
- CI run #53 passed the forward migration, authorization behavior, and rollback sequence on a disposable PostgreSQL database. A paid Supabase preview branch is no longer required to prove the staged RLS contract.
- Production remains intentionally unchanged; the live Supabase advisor still reports the same 26 no-policy notices until explicit production approval.

### Runtime preparation

- Added `infra/oracle/bootstrap-ubuntu.sh` to install only the Ubuntu/Docker prerequisites; it intentionally opens no application ports, injects no secrets, installs no local LLM, and does not create a GitHub self-hosted runner.
- Added `infra/oracle/verify-host.sh` for read-only host verification after provisioning.
- Added `infra/openclaw/verify-image.sh` to reject mutable OpenClaw image references and require a pinned `linux/arm64` digest.
- Added `infra/openclaw/sandbox.example.json5` as a restrictive baseline: explicit sandboxing, per-session scope, no network by default, read-only root, dropped capabilities, no-new-privileges and resource limits. Validate exact keys against the ultimately pinned OpenClaw release before deployment.
- Added `infra/openclaw/README.md` with the Oracle/OCI Cloud Shell handoff, smoke-test requirements, secret boundary and production gates.
- Added `docs/OPENCLAW_RUNTIME_CANDIDATES.md` with current release discovery and selection gates. At capture time the current stable observed was `2026.9.4`; its official `2026.9.4-browser` package exposes a Linux ARM64 immutable pull reference, but fresh 2026.9.x P0/update-regression reports mean it is a smoke-test candidate, not an automatic production choice. Extended Stable `2026.6.35` should also be compared on-host before selection.
- Recorded live Supabase Edge Function versions/hashes in `docs/LIVE_BACKEND_MANIFEST.md` for drift detection without publishing backend source or secrets into the public repository.

## Verified security rulings

- Do not merge PR #1 or publish production from an automated setup run without explicit approval.
- Do not apply the production RLS migration until the exact staged migration/rollback is rechecked against live drift and explicit approval is given.
- No case evidence, service-role credentials, OpenCode keys, deployment tokens or live Edge Function source belong in this public repository.
- Keep existing OpenCode credentials behind the current Supabase bridge unless a replacement is separately proven safer and equivalent.
- Do not expose a privileged OpenClaw control port publicly just to connect the worker.
- Do not attach the Oracle production VM as a general GitHub self-hosted runner for this public repository.
- Do not place a broad Supabase service-role credential on the Oracle model/tool host if a scoped worker API can mediate the required operations.

## Current Oracle browser blocker

- The first Oracle secure-takeover window successfully opened once, so Oracle login itself is not yet proven to be the blocker.
- The subsequent failure reported a two-session Work browser-concurrency limit after cleanup, which is consistent with a stale/stranded takeover session consuming capacity.
- Recovery order for Work:
  1. Do **not** immediately spawn another browser session.
  2. Reuse the original Oracle/takeover session if it is still addressable.
  3. If Work exposes browser-session controls, close only the failed/stale Oracle takeover session and keep any healthy required session.
  4. Retry Oracle login inside the reclaimed slot.
  5. Ask the user for secure takeover only at the actual password/MFA step; never request credentials in chat.
  6. Only if no stale session can be reclaimed and the connector still reports the concurrency limit should the run stop on browser-session capacity.

## Remaining work for ChatGPT Work

### Human-authenticated infrastructure

1. Recover/reuse the existing Oracle takeover session before creating a new browser session.
2. Complete Oracle Cloud login/MFA through secure takeover; never request credentials in chat.
3. Prefer OCI Cloud Shell for bootstrap so the workflow does not depend on the user's Mac.
4. Inspect actual tenancy/home-region/free-resource limits and create only a resource explicitly shown as zero additional cost.
5. If genuine Always Free A1 capacity is unavailable after bounded legitimate attempts, report that exact blocker before proposing any paid host.

### OpenClaw runtime

1. Read `docs/OPENCLAW_RUNTIME_CANDIDATES.md` first; do not repeat basic release discovery unless current state has changed.
2. On the actual Oracle ARM64 host, compare current stable browser image against current Extended Stable browser image using immutable digests.
3. Pin the exact tested production image digest and a rollback digest; never track `latest` or `extended-stable` alone in production.
4. Run the prepared Ubuntu bootstrap and adapt the restrictive sandbox baseline to the exact release schema.
5. Prove gateway, model call, session/restart, sandbox tool, browser/Playwright and Integritas reconnect behavior.

### Smallest missing integration boundary

- The live Integritas backend has durable case jobs and the existing OpenCode bridge, but no proven narrow outbound OpenClaw lease/checkpoint contract is currently exposed.
- Implement/deploy the smallest scoped worker interface only after the runtime exists so it can be tested end-to-end.
- Prefer operations such as lease/heartbeat/checkpoint/store bounded evidence/fail/complete rather than giving Oracle a broad database master key.

### Consequential production approvals

After all runtime/E2E verification is green, group the remaining approvals:

1. apply the exact tested RLS migration to production, then rerun Supabase security advisor/authenticated smoke tests;
2. merge PR #1 if final review is clean;
3. deploy the exact approved Git SHA to the chosen private-admin production path;
4. retain the current private admin as rollback until the replacement passes live smoke tests.

Leaked-password protection should be classified `PLAN_LIMITED` if the current Supabase plan does not expose the feature; do not upgrade plans without approval.

## Do not repeat

- Do not create a paid Supabase development branch merely to test RLS.
- Do not retrieve the protected production E2E self-test token just to make testing easier.
- Do not rebuild the GitHub scaffold from scratch.
- Do not move OpenCode credentials to Oracle for architectural neatness.
- Do not add n8n, Temporal, Kubernetes or a local LLM unless fresh evidence establishes a requirement.
- Do not treat Work-only plugins as permanent Oracle runtime credentials.
- Do not burn browser-session capacity by spawning repeated Oracle takeover sessions before trying to reclaim the original failed slot.

## Next execution step

Recover/reuse the original Oracle secure-browser session, complete authenticated tenancy inspection, then provision/test the persistent OpenClaw runtime using the prepared `infra/` artifacts and current candidate review. Production RLS/merge/deploy remain explicit approval gates.
