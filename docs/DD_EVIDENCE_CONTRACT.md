# DD evidence contract v1

The offline gate in `tools/dd/quality.py` verifies source-file integrity and the report's structural evidence contract. It does not authenticate documents or establish whether claims are true. Integrate it before publishing an OpenClaw-generated report; existing production endpoints are not automatically covered.

## Bundle fields

`case_id`, `report_id`, `title`, integer `revision`, `publication_status` (`draft` or `reviewed`), `excluded_subject_ids`, `sources`, `executions`, `claims`, `actions`, optional `review`.

- Sources: `id`, `title`, `authority` (official/registry_derived/counterparty/technical/secondary), `origin_id` (same upstream origin for syndicated copies), `acquired_by`, timezone-aware `retrieved_at`, `effective_at` (timezone-aware timestamp or null), optional HTTPS `url`, relative `artifact`, full `sha256`. Store raw responses/page captures even for unsuccessful checks. Never store signed storage URLs or credentials as public source links.
- Executions: `id`, `agent`, `tool`, `input_summary`, `status` (queued/running/completed/failed/access_blocked/cancelled), `started_at`, `ended_at` for terminal states, `source_ids`, `failure_reason` for failed/access-blocked states. Record provider/model/tool versions as additional fields. These are observable actions, not private model reasoning.
- Claims: `id`, `subject_id`, `text`, `rationale`, `conclusion` (corroborated/contradicted/inconclusive/not_checked), `decision_effect` (informational/material_gap/blocking), `execution_ids`, `evidence` containing `source_id`, `locator`, `excerpt`, `relation` (supports/contradicts/context).
- Actions: `id`, `claim_id`, `status` (open/in_progress/closed), `owner`, `next_step`, `required_evidence`, `acceptance_condition`; closed actions also need `closure_source_ids`, `reviewed_by`, `reviewed_at`. Add due dates/dependencies when known rather than inventing deadlines.
- Reviewed publication: `review.reviewer`, `review.reviewed_at`, `review.revision`, `review.accepted=true`. Reviewer identity must differ from research agents. The current revision must come from the authoritative case record, not the bundle itself.

Run `python3 -m unittest discover -s tools/dd -p 'test_*.py'` for contract regressions. The synthetic test fixture is a complete executable example. Run `python3 tools/dd/audit_pdf.py REPORT.pdf` for a read-only delivery audit (requires PyMuPDF). This audit flags review candidates; it does not change findings.

## Runtime rollout

Deploy the repository tools and skill together. Install the skill in the configured OpenClaw workspace's `skills/integritas-dd` directory only after verifying that workspace; never overwrite a custom skill without comparison. Do not copy client documents into the public repository. Preserve per-case file permissions and authorised historical-case scope.

The existing restrictive gateway configuration remains intact. Before adding research privileges, inspect the actual deployed version, effective tool catalogue, browser readiness and provider completion. Package installation alone is not a capability test. Keep offline parsing isolated; provide online access through bounded research/browser tools.

No generic third-party skill pack is required. Prefer existing native browser tools. Test Docling/OCRmyPDF and archival tooling separately against actual ARM64 resource limits. Browsertrix and heavy OCR should run on demand. New paid provider/data licences require a separate decision.

## Persistence and publication

Supabase remains authoritative. A future cloud publisher must validate using the server-side case revision and immutable source objects, then recheck revision atomically when writing reviewed output. Do not trust a browser-supplied `valid` flag. Keep acquisition records and immutable originals with the case; persist HTML, manifest and machine-readable bundle as a versioned package. HTML is escaped and script-free, with clickable source citations. Confidential outputs stay in private storage.
