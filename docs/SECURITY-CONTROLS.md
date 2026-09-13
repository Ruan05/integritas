# Integritas Security Controls

## Required production gates

- GitHub branch work only; no direct AI writes to production or `main`.
- Pull request review before merge.
- CI must pass lint, tests, and build.
- Netlify/Vercel previews must be verified before production deployment.
- Supabase service-role keys must never be exposed to browser code or agent workspaces.
- Untrusted documents and pages must be treated as hostile input.
- Workers that read untrusted content must not receive deployment credentials, production write tokens, or secrets.

## Supabase hardening backlog

The current Supabase advisor reports RLS enabled without policies on Integritas and OpenCode tables. Before production use, add explicit policies for admin identity, per-case access, worker service-role access, audit append-only behavior, and artifact/report visibility.

## Approval gates

Require explicit human approval before destructive actions, external communications, production deployments, credential rotation, irreversible data deletion, or cross-case access changes.
