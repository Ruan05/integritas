# Integritas Execution Ledger

## Current checkpoint

- Repository: `Ruan05/integritas`
- Pull request: [#1](https://github.com/Ruan05/integritas/pull/1) — keep draft/unmerged until final production approval.
- Branch: `integritas-command-center-foundation`
- Latest code/infra checkpoint before this ledger update: `60d33a832f8e6c22b7d52d31cc7a19d5e633a79d`
- Public production: `https://integritass.com` — preserve unchanged until explicit publication approval.
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
- Playwright now runs one worker in CI for deterministic coverage while retaining desktop Chromium and mobile WebKit projects.
- Oracle/OpenClaw bootstrap scripts are syntax-checked by CI.

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
  - use `security definer` helpers with an empty `search_path` and fully-qualified references.
- Expanded the policy contract to require policies on all 26 advisor-reported protected tables.
- Added behavioral authorization assertions for:
  - anonymous denial;
  - browser-write denial;
  - server-only internal tables;
  - authorized case-only reads;
  - cross-case isolation;
  - admin behavior.
- Added and tested a safe rollback that returns browser roles to server-only/default-deny without restoring historical broad grants.
- CI run #40 passed the forward migration, authorization behavior, and rollback sequence on a disposable PostgreSQL database. A paid Supabase preview branch is no longer required to prove the staged RLS contract.

### Runtime preparation

- Added `infra/oracle/bootstrap-ubuntu.sh` to install only the Ubuntu/Docker prerequisites; it intentionally opens no application ports, injects no secrets, installs no local LLM, and does not create a GitHub self-hosted runner.
- Added `infra/openclaw/verify-image.sh` to reject mutable OpenClaw image references and require a pinned `linux/arm64` digest.
- Added `infra/openclaw/sandbox.example.json5` as a restrictive baseline: explicit sandboxing, per-session scope, no network by default, read-only root, dropped capabilities, no-new-privileges and resource limits. Validate exact keys against the ultimately pinned OpenClaw release before deployment.
- Added `infra/openclaw/README.md` with the Oracle/OCI Cloud Shell handoff, smoke-test requirements, secret boundary and production gates.
- Recorded live Supabase Edge Function versions/hashes in `docs/LIVE_BACKEND_MANIFEST.md` for drift detection without publishing backend source or secrets into the public repository.

## Verified security rulings

- Do not merge PR #1 or publish production from an automated setup run without explicit approval.
- Do not apply the production RLS migration until the exact staged migration/rollback is rechecked against live drift and explicit approval is given.
- No case evidence, service-role credentials, OpenCode keys, deployment tokens or live Edge Function source belong in this public repository.
- Keep existing OpenCode credentials behind the current Supabase bridge unless a replacement is separately proven safer and equivalent.
- Do not expose a privileged OpenClaw control port publicly just to connect the worker.
- Do not attach the Oracle production VM as a general GitHub self-hosted runner for this public repository.
- Do not place a broad Supabase service-role credential on the Oracle model/tool host if a scoped worker API can mediate the required operations.

## Remaining work for ChatGPT Work

### Human-authenticated infrastructure

1. Open Oracle Cloud through Work cloud browser.
2. Request secure browser takeover for legitimate login/MFA; never request credentials in chat.
3. Prefer OCI Cloud Shell for bootstrap so the workflow does not depend on the user's Mac.
4. Inspect actual tenancy/home-region/free-resource limits and create only a resource explicitly shown as zero additional cost.
5. If genuine Always Free A1 capacity is unavailable after bounded legitimate attempts, report that exact blocker before proposing any paid host.

### OpenClaw runtime

1. Inspect current official OpenClaw release/Extended Stable/P0-P1 issues at execution time.
2. Smoke-test a fresh `linux/arm64` browser-capable candidate in disposable state.
3. Pin the exact tested image digest and a rollback digest; never track `latest` in production.
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

## Next execution step

Finish verification of the newest branch head. Then authenticate to Oracle and provision/test the persistent OpenClaw runtime using the prepared `infra/` artifacts. Production RLS/merge/deploy remain explicit approval gates.
