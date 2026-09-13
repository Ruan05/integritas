# Integritas Command Center

Private admin workspace for Integritas due-diligence investigations.

This branch seeds the GitHub-controlled foundation for the approved workflow:

- React/Vite admin interface
- Supabase browser client wiring through publishable environment variables
- Netlify build configuration and security headers
- GitHub Actions CI for lint, tests, and build
- CODEOWNERS ownership guardrail
- Supabase RLS policy scaffold for review before applying to production

## Local setup

```bash
npm ci
cp .env.example .env
npm run dev
```

Required environment variables:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_INTEGRITAS_ENV=preview
```

Do not commit service-role keys, OpenCode/OpenClaw credentials, deployment tokens, or private investigation material.

## Verification

```bash
npm run lint
npm test
npm run build
```

## Production workflow

All changes should move through:

1. GitHub branch
2. CI checks
3. Preview deployment
4. Human review
5. Production deploy

AI workers may suggest or implement changes in isolated branches, but should not directly write to production or `main`.
