# Integritas Execution Ledger

## Current checkpoint

- Repository: `Ruan05/integritas`
- Pull request: [#1](https://github.com/Ruan05/integritas/pull/1) (draft, unmerged)
- Branch: `integritas-command-center-foundation`
- Current SHA: `fc5850b71e197fee66e6be6b25813b48f26d721d`
- Public production: `https://integritass.com` (verified unchanged)

## Completed

- Repaired Vite `ImportMeta.env` typing and added a reproducible npm lockfile.
- Added GitHub CI gates for `npm ci`, TypeScript, unit tests, Vite build, high-severity dependency audit, and Playwright.
- Added Playwright desktop Chromium and mobile WebKit projects.
- Added E2E checks for the GitHub-controlled admin preview responsiveness and public Integritas HTTP/title smoke behavior.
- Retained Playwright report, screenshot, and trace artifacts when a browser test fails.
- Inspected the live Supabase schema, storage buckets, role grants, server functions, and admin API behavior.
- Added a non-applied RLS proposal and policy-contract test:
  - `supabase/migrations/0002_integritas_browser_read_policies.sql`
  - `supabase/tests/0002_integritas_browser_read_policies.sql`
- Verified Oracle Console is reachable but not authenticated. No resource was created.
- Removed fabricated cases and LIVE/READY states from the GitHub preview; added a server-gated feature-parity matrix.

## Latest verification

- CI run #24 passed at SHA `fc5850b71e197fee66e6be6b25813b48f26d721d`.
- CI stages passed: install, typecheck, unit tests, build, Chromium/WebKit installation, Playwright E2E, and high-severity npm audit.
- Previous CI failures were preserved and fixed:
  - Vitest collected Playwright specs: narrowed Vitest include pattern.
  - WebKit was absent: installed explicitly in CI.
  - Public mobile assertion expected desktop navigation: replaced with HTTP/title smoke assertion.

## Security rulings

- Do not deploy or merge this branch without review and explicit approval.
- Do not apply the proposed RLS migration to production until it passes on a Supabase development branch with a rollback plan.
- Keep deploy/E2E token tables server-only.
- Preserve service-role-only server enqueue/sync functions.
- The public repository must never contain secrets, case evidence, service-role credentials, or deployment tokens.

## External blockers

- Oracle requires interactive secure sign-in/MFA before tenancy/free-capacity inspection.
- Supabase development branch creation requires explicit cost confirmation through the connected account.
- The live Supabase project still reports 26 RLS-enabled tables without policies and leaked-password protection disabled.

## Next task

1. Use a cost-confirmed Supabase development branch to apply and verify the RLS migration and contract test.
2. Inspect actual role behavior with synthetic authenticated users before any production security change.
3. After all non-host work is complete, authenticate to Oracle and inspect actual Always Free capacity.
