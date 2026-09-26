# Integritas OpenClaw Runtime Handoff

This directory contains **non-secret preparation only**. The persistent runtime must not be deployed until the operator has authenticated to Oracle, verified the tenancy's free allowance, and selected an exact OpenClaw release/digest after a fresh smoke test.

## Current intended runtime boundary

- Supabase remains authoritative for identity, cases, documents, job state, findings, evidence, reports and audit.
- GitHub remains authoritative for code and CI.
- Oracle/OpenClaw supplies bounded reasoning/tool/browser execution.
- Existing OpenCode Go credentials should remain behind the current Supabase bridge unless a direct provider integration is separately proven safer/better.
- The initial worker path should be outbound-first. Do not expose an OpenClaw admin/control port publicly simply to make integration easier.

## Human-only prerequisite

1. Open Oracle Cloud in ChatGPT Work cloud browser.
2. Complete legitimate account login/MFA using secure browser takeover.
3. Use OCI Cloud Shell where possible so the bootstrap does not depend on the user's Mac.
4. Inspect the account's actual free-tier eligibility/limits before provisioning.
5. Create only a resource explicitly shown as zero additional cost. Do not upgrade to PAYG automatically.

## Host bootstrap

After the VM exists and is reachable through the approved Oracle administration path:

```bash
sudo bash infra/oracle/bootstrap-ubuntu.sh
```

The bootstrap intentionally installs only OS/runtime prerequisites. It does not open an application port, install a local LLM, create a GitHub runner, or inject secrets.

## Select and pin OpenClaw

At execution time, check the official OpenClaw releases and current P0/P1 issues. Prefer a fresh-install candidate supported on `linux/arm64`; do not blindly track `latest`.

Set an immutable reference containing an image digest:

```bash
export OPENCLAW_IMAGE='ghcr.io/openclaw/openclaw:<tested-version>-browser@sha256:<tested-digest>'
bash infra/openclaw/verify-image.sh
```

Do not permanently adopt a digest until a disposable smoke test proves at minimum:

- gateway/container starts;
- health/config validation passes;
- approved model/provider completion works;
- session creation and restart work;
- sandbox tool execution works;
- browser sidecar launches;
- Playwright navigation works;
- workspace behavior matches the intended isolation policy;
- the runtime can reconnect to the Integritas control plane after restart.

Record both the selected digest and rollback digest.

## Sandbox baseline

`sandbox.example.json5` is deliberately restrictive:

- sandboxing explicitly enabled;
- per-session isolation;
- no workspace access by default;
- no network by default;
- read-only root where possible;
- all Linux capabilities dropped;
- `no-new-privileges`;
- CPU/memory/PID bounds;
- separate browser isolation.

Validate the exact configuration keys against the pinned OpenClaw release before deployment. Research/browser workers may receive only the narrow egress they actually need.

Never make the model sandbox responsible for Docker administration. Never mount `/var/run/docker.sock` inside ordinary agent containers.

## Secrets

Do not commit or echo:

- Supabase service-role credentials;
- OpenCode Go keys;
- OpenClaw gateway tokens;
- deployment tokens;
- Oracle private keys;
- API keys for research providers.

Prefer existing server-side proxies/scoped worker credentials and secret references/files over environment variables visible to untrusted model containers.

## Remaining runtime integration task

The live Integritas backend currently has durable server-side jobs and an existing OpenCode bridge, but it does not yet expose a proven narrow outbound OpenClaw lease/checkpoint contract. Implement/deploy that smallest possible contract **only after the runtime exists**, so it can be tested end-to-end. Avoid placing a broad Supabase service-role key on the agent host if a scoped worker endpoint can mediate the required operations.

## Production gates

Do not merge PR #1, apply production RLS, publish the GitHub-controlled admin, change repository visibility, or provision paid infrastructure without the applicable explicit approval.
