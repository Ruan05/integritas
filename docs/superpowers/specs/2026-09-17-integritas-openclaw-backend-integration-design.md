# Integritas OpenClaw Backend Integration Design

**Date:** 2026-09-17  
**Status:** Proposed design for user approval  
**Scope:** Complete the production connection between the private Integritas admin workflow, Supabase, the Oracle control worker, and OpenClaw investigation execution.

## Goal

Make `Start Deep Investigation` reliably execute an authorised, case-scoped due-diligence job on the always-on Oracle/OpenClaw runtime, persist structured evidence-backed results into Integritas, survive retries/restarts, and return a draft report for human analyst review.

The design preserves the existing architecture rather than replacing it:

`Private Admin -> Supabase control plane -> outbound Oracle worker -> bounded OpenClaw runner -> validated bundle -> Supabase -> Private Admin`

## Current verified state

- The private React admin already authenticates analysts, lists assigned cases, uploads 1–20 documents, checks runtime readiness, starts investigations, and polls durable job/command state.
- Production `integritas-control` v6 already supports authenticated investigation start, worker lease, manifest creation, checkpoints, output publication, completion/failure, and short-lived signed document URLs.
- Production tables already include durable jobs/checkpoints/outputs plus entities, relationships, findings, sources, checks, reports, audit events, runtime heartbeats, and control commands.
- Oracle has the 0.2.0 control worker, bounded systemd investigation unit, Polkit allowlist, loopback-only OpenClaw Gateway, and working OpenCode Go model authentication.
- The Oracle runner verifies document size and SHA-256, stages a job workspace, invokes `openclaw agent exec`, and currently expects `bundle.json` plus `report.html`.

## Known gaps to close

1. **Checkpoint contract mismatch:** the Oracle worker currently emits metadata keys such as `document_count`, `bundle_sha256`, and `report_sha256`, while the production Edge Function allowlist does not accept those keys. A live investigation can therefore fail before OpenClaw analysis begins.
2. **Heartbeat version drift:** the live runtime heartbeat still reports worker `0.1.0` although the host package/service is 0.2.0. Version attestation must be derived from the deployed release rather than a stale environment value.
3. **Generic output persistence only:** `bundle.json` and report artifacts are stored and registered, but bundle contents are not yet atomically materialised into Integritas entities, relationships, findings, sources, checks, and draft reports.
4. **Model output is trusted too far:** the model is instructed to run deterministic quality tooling, but the worker itself does not enforce the quality gate before completion.
5. **Failure workspaces are deleted:** the worker removes the job workspace in `finally`, which limits reliable resume/retry after interruption.
6. **Lifecycle checkpoints are coarse:** current execution jumps from extracting/analyzing to drafting/completed instead of persisting the full mapping/research/verification/review lifecycle.
7. **Report format mismatch:** the runner produces HTML while the canonical report table stores Markdown. The model should not define trusted display HTML.

## Design principles

- Supabase remains the source of truth and authorization/control plane.
- Oracle/OpenClaw remains an outbound execution plane; no public OpenClaw upload webhook is introduced.
- Tailscale/mobile pairing is administration-only and is not part of the production investigation data path.
- The Oracle worker never receives the Supabase service-role key.
- OpenClaw never receives the Integritas worker credential or signed URLs after evidence staging.
- Source documents are untrusted evidence, never instructions.
- The model may propose findings; deterministic code decides whether output is valid enough to persist and whether a job can be marked complete.
- Reports are always created as drafts and require a distinct human analyst review before finalisation.

## Canonical investigation bundle

OpenClaw must return one versioned JSON object, `bundle.json`, validated against a checked-in schema before publication. Version 1 contains these top-level sections:

- Runner-controlled envelope fields: `schema_version`, `case_id`, `case_job_id`, `case_revision`, `depth`, execution timestamps, and the validated runtime/model identifiers used for the run.
- `entities`: stable `entity_key`, type, display name, aliases, identifiers, match status, and confidence.
- `relationships`: stable relationship key, source/target entity keys, relationship type, evidence references, and confidence.
- `findings`: stable `finding_key`, entity key when applicable, finding type, claim, evidence status, materiality, reliability, evidence excerpt, and source keys.
- `sources`: stable `source_key`, source type, title, URL or document reference, page/section reference, excerpt, reliability note, evidence origin, and retrieval time.
- `checks`: stable `check_key`, entity key when applicable, check type, description, priority, required source, status, and outcome.
- `contradictions`: claims that materially conflict, linked to the relevant findings/sources.
- `unresolved_checks`: unresolved branch, reason, attempted methods, blocker, and next manual action.
- `limitations`: material limitations that constrain confidence or completeness.
- `report`: summary, canonical Markdown body, and review status fixed to `draft`.
- `execution`: completed stages, tool/quality results, counts, warnings, and terminal outcome.

Stable keys are job-local identifiers generated under the runner/model contract, not database UUIDs. They let deterministic ingestion resolve references before inserting database rows. The runner constructs or overwrites the trusted envelope fields from the authorised manifest, command, and execution result; model-supplied case identity, revision, timing, or runtime identity is never trusted.

The schema forbids credentials, signed storage URLs, shell commands, opaque executable payloads, and cross-case identifiers. Output remains bounded by existing artifact-size limits.

## Output validation and deterministic quality gate

Validation runs on Oracle after the model finishes and before any terminal `completed` checkpoint:

1. Parse and validate `bundle.json` against the versioned JSON schema.
2. Confirm the runner-controlled bundle envelope exactly matches the authorised manifest and leased command; reject any conflicting model-supplied identity/revision fields.
3. Confirm every referenced document ID exists in that manifest.
4. Confirm every finding source reference resolves to a bundle source.
5. Reject signed URLs, secrets, unknown schema fields, unresolved internal keys, and oversized text/excerpts.
6. Run the deterministic DD quality checker as a host-controlled command, not as a model-requested optional step.
7. Require evidence/source linkage for supported findings; unresolved claims must be explicitly classified as unresolved rather than silently promoted.
8. Verify the canonical Markdown report is consistent with the structured counts and terminal outcome.

A failed quality gate produces `incomplete` or `failed` with explicit safe blocker metadata and terminates the leased control command through the failure path. It must never publish a final report or mark the control command successful.

## Atomic structured ingestion

Add a service-only RPC, conceptually `integritas_commit_investigation_bundle`, invoked only through `integritas-control` after worker authentication and bundle validation.

The transaction must:

- Lock and re-check the case job, command lease owner, case ID, and current case revision.
- Reject stale jobs and bundles from another case, revision, or worker lease.
- Resolve job-local entity/source/finding/check keys to database UUIDs inside the transaction.
- Upsert or insert entities and relationships using job/revision provenance without conflating same-name people or companies.
- Insert findings with `case_job_id` and `case_revision`, then link every source to its resolved finding and document/tool provenance.
- Persist checks and a draft report based on the same case revision. Until dedicated contradiction/unresolved tables exist, materialise contradictions as typed findings and unresolved branches as `integritas_checks` rows with an unresolved status, while preserving their richer canonical representation in the bundle artifact.
- Register the canonical bundle/report artifact hashes used for the commit.
- Record an audit event describing the commit without storing secrets or signed URLs.
- Return a compact commit summary only after the transaction succeeds.

The commit is idempotent. Replaying the same validated bundle for the same job/revision must return the same logical result rather than duplicate evidence. The execution order is: validate and quality-check -> publish/register immutable artifacts -> atomically commit structured data -> persist the `completed` checkpoint -> acknowledge the control command as complete. If artifact publication succeeds but structured commit fails, the job remains non-successful and a retry may reuse only the same verified artifact hashes.

Database uniqueness guards should use case/job/revision plus stable bundle keys or deterministic fingerprints, not display names alone.

## Canonical report format

Change the required model output from `report.html` to `report.md`. Store Markdown as the canonical report body and render/sanitize HTML in the application layer when needed. HTML may remain an optional derived artifact, never the source of truth.

## Durable execution lifecycle

The control worker, not the model, owns lifecycle state. It advances durable checkpoints only after deterministic preconditions are satisfied:

`queued -> extracting -> analyzing_documents -> mapping_entities -> planning_research -> researching -> verifying -> cross_checking -> independent_review -> drafting_report -> completed`

Terminal alternatives remain `incomplete`, `failed`, `cancelled`, and `research_limit_reached`.

Each checkpoint carries only bounded safe metadata from the shared API contract. The metadata allowlist is defined once and tested on both the worker and Edge Function sides so the producer and consumer cannot drift.

The first implementation must also make worker version attestation authoritative: the heartbeat reads the packaged worker version or release manifest directly and production readiness rejects stale/mismatched attestations.

## Retry, resume, cancellation, and cleanup

- Successful completed jobs may have their Oracle workspace pruned after artifact publication and commit verification.
- Failed, interrupted, incomplete, or research-limit jobs retain the verified workspace for a configurable default of 72 hours, after which a cleanup task may remove only Oracle scratch data.
- A retry reuses staged documents only after rechecking size/SHA-256 against a newly authorised manifest; expired signed URLs are never persisted or reused.
- Existing valid phase outputs may be reused only when their job ID, case revision, manifest hash, schema version, and tool version match.
- Replayed publication and bundle commit operations are idempotent.
- Lease loss prevents further publication/commit until the command is validly re-leased or retried.
- Cancellation is checked between phases and before publication. A cancelled job cannot publish/commit a completed result.
- A new document increments the case revision and makes older in-flight/report output stale; stale work remains auditable but cannot overwrite the current case state.
- Cleanup must never delete private Supabase evidence or audit records; it only removes bounded Oracle scratch work after retention policy conditions are met.

## OpenCode Go model use

OpenCode Go remains an inference provider behind OpenClaw's service-account credential store. The integration must not copy its API key into Integritas, GitHub, Supabase rows, or worker payloads.

Kimi K3 may remain the primary DD model and DeepSeek V4 Pro the provider-level fallback. Model choice is configuration, not part of the trusted evidence contract; deterministic validation and provenance rules apply identically to every model.

## Admin application behavior

The existing start path remains: authenticated analyst -> explicit case access -> runtime attestation -> deterministic idempotency key -> `start_case_investigation` -> durable server-side polling.

The next UI work is result/recovery visibility, not a new execution bridge:

- Show the persisted investigation stage, progress, safe checkpoint message, and terminal outcome after refresh/relogin.
- Show structured entities, findings, sources, checks, contradictions, unresolved checks, limitations, and draft report from Supabase under existing RLS.
- Mark results stale when the case revision advances.
- Expose retry/cancel only through bounded server actions; never add a shell/command box.
- Preserve iPhone Safari usability and browser-close independence.
- Keep the existing 20-document server cap. For individual files above 6 MiB, prefer Supabase TUS/resumable upload into the same private bucket with server-authorised registration; smaller uploads may keep the existing path. This does not change the private storage or case-access boundary.

## Security boundaries

- `integritas-control` remains the only network API used by the Oracle worker.
- Worker authentication remains a dedicated scoped credential stored as a systemd credential/root-owned token file and represented in Supabase only by a digest.
- Signed evidence URLs are generated server-side with short expiry and removed before model execution/output publication.
- The OpenClaw Gateway stays loopback-only. Tailscale Serve must not become the case upload or job-dispatch path.
- The investigation service runs as non-root `openclaw` under the existing hardened systemd sandbox and fixed binary/arguments.
- The control worker keeps no arbitrary shell, generic plugin-install, secret-read, email-send, or delete-evidence command.
- Model/provider credentials remain in OpenClaw's credential store and are never placed in job workspaces or database payloads.
- Cross-case reads/writes are rejected at the RLS/API/RPC layers and again by bundle case/job/revision checks.
- Every mutable production action records an audit trail with actor/job IDs and safe metadata.

## Error handling

Expected failures use stable error codes and safe summaries. Raw provider responses, secrets, signed URLs, stack traces containing environment data, and private host configuration are not returned to the browser or stored in audit metadata.

A backend or worker failure leaves the durable case job in a truthful non-success terminal/recoverable state; the UI never infers completion solely from the presence of an artifact.

## Verification strategy

Implementation follows TDD and promotes one capability at a time.

Unit/contract tests must cover checkpoint metadata symmetry, heartbeat release attestation, bundle schema validation, source-key resolution, same-name entity separation, stale-revision rejection, signed-URL rejection, idempotent replay, quality-gate failures, and safe error redaction.

Database tests must prove the commit RPC is service-only, atomic, revision-bound, cross-case safe, idempotent, and unable to create a finalised report. Rollback must refuse destructive downgrade when committed OpenClaw investigation data exists.

Worker tests must simulate corrupt downloads, digest mismatch, manifest mismatch, invalid model output, provider failure/fallback, lease loss, cancellation, worker restart, reusable phase artifacts, and retained failure workspaces.

UI tests must verify runtime gating, authenticated start, durable refresh/relogin, stale-result display, cancellation/retry controls, structured source-linked results, and mobile WebKit layout.

## Production rollout sequence

1. **Contract repair:** align checkpoint metadata and make worker version attestation authoritative. Deploy only after unit/contract/CI tests pass; verify production heartbeat reports the actual release.
2. **Bundle contract:** add the versioned schema and deterministic Oracle validator/quality gate. Keep structured DB commit disabled initially.
3. **Atomic ingestion:** add migrations/RPC/Edge action plus database tests and RLS/security-advisor verification.
4. **Single-document canary:** run one synthetic case end-to-end through the real admin -> Supabase -> Oracle -> OpenClaw -> validated bundle -> database path. No real customer evidence is used for this gate.
5. **Resume/cancel hardening:** add retained failure workspace, retry, cancellation, and restart behavior; repeat the canary with controlled interruption.
6. **Admin results:** expose persisted findings/sources/checks/unresolved items/draft report under existing authorization.
7. **Hostile 20-document E2E:** test duplicate SHA files, conflicting claims, same-name subjects, prompt-injection text, corrupted input, stale revision, browser disconnect, worker/OpenClaw restart, retry/idempotency, source lineage, review/finalisation guards, and cross-case denial.
8. **Release gate:** keep PR #1 draft/unmerged until the hostile production-synthetic E2E and reboot/fresh-session recovery gates pass.

No step requires exposing the OpenClaw Gateway publicly or moving provider/Supabase privileged credentials into the browser, repository, or Oracle job payload.

## Acceptance criteria

The backend integration is considered complete only when all of the following are proven on the live production architecture with synthetic evidence:

- Admin upload and `Start Deep Investigation` create exactly one case job/control command per idempotency key.
- Production runtime attestation reports the actually deployed worker release and required capability flags.
- Oracle downloads only authorised case documents, validates every digest, and passes no signed URL to the model.
- OpenClaw produces a schema-valid evidence bundle and canonical Markdown report under the configured model/fallback chain.
- Host-controlled deterministic QA runs and blocks invalid/incomplete output from being marked completed.
- Structured entities, relationships, findings, sources, checks, unresolved items, and draft report are atomically persisted with correct case/job/revision provenance.
- Replaying the same result does not duplicate logical records.
- Same-name entities remain separate unless evidence supports a match.
- Restart/retry/cancel/stale-revision scenarios leave truthful durable state and cannot publish a false success.
- Closing the browser or switching devices does not affect job execution or recovery.
- Cross-case access, arbitrary command execution, credential leakage, prompt-injection instructions in evidence, and direct report finalisation are denied.
- A 20-document hostile synthetic run passes end-to-end and remains auditable after VM/OpenClaw/worker restart.

## Alternatives rejected

**Public OpenClaw webhook/watch folder:** rejected because it adds an inbound execution surface, bypasses the existing durable control queue, and weakens case/job authorization boundaries.

**Replace the queue with a new queue product now:** rejected because Integritas already has durable commands, leases, heartbeats, idempotency, and audit state; replacement adds migration risk without addressing the current missing structured-result contract.

**Direct Oracle writes with a Supabase service-role key:** rejected because compromise of the execution host would gain excessive database/storage privilege. The worker remains scoped through `integritas-control` and bounded RPCs.

**Model-generated HTML as the canonical report:** rejected because it mixes content generation with trusted presentation. Markdown plus deterministic rendering/sanitization is simpler and safer.

## Non-goals for this implementation

This work does not merge PR #1, expose the OpenClaw Gateway publicly, replace Supabase Auth/Storage, move the public `integritass.com` site, automate analyst approval/finalisation, or grant OpenClaw arbitrary host administration.
