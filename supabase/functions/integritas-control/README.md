# Integritas Control Edge Function

This function is the narrow HTTPS control façade between authorised ChatGPT/admin clients and the outbound Oracle control worker. It does **not** expose the OpenClaw Gateway and it does not accept arbitrary shell commands.

## Authentication modes

The function implements its own explicit authentication modes and should therefore be deployed with platform JWT verification disabled **only for this function**:

- `Authorization: Bearer <Supabase user JWT>` — authenticated Integritas admin membership is checked server-side.
- `x-integritas-connector-token` — scoped ChatGPT connector credential.
- `x-integritas-worker-token` — scoped Oracle worker credential.

The connector and worker tokens are deployment secrets. Do not commit them, put them in browser code, return them in API responses, or log them.

## Bootstrap connector actions

- `health`
- `runtime_status`
- `command_status`
- `enqueue`

The bootstrap command allowlist is intentionally smaller than the database's future DD command vocabulary:

- `health`
- `openclaw_status`
- `restart_openclaw`
- `verify_runtime`

Case-control commands are added only after their backend handlers exist and pass tests.

Every `enqueue` request requires an idempotency key either in `idempotency_key` or the `idempotency-key` header.

## Worker actions

- `worker_heartbeat`
- `worker_lease`
- `worker_touch`
- `worker_complete`
- `worker_fail`

The worker polls outbound; no inbound Oracle listener is required.

## Required secrets

- `INTEGRITAS_CONTROL_WORKER_TOKEN`
- `INTEGRITAS_CONTROL_CONNECTOR_TOKEN`
- `INTEGRITAS_CONTROL_ALLOWED_ORIGIN=https://integritass.com`

Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the function runtime. The service-role credential is used only inside the Edge Function to invoke service-role-only RPC wrappers.

## Security invariants

The function must never add an `exec`, `shell`, `env`, secret-read, Docker administration, evidence-delete, payment, email-send, or arbitrary gateway-configuration action. New mutating commands require a typed payload schema, an Oracle allowlisted handler, tests, CI policy verification and audit coverage.
