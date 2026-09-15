# DD optimization checkpoint - 15 September 2026

## Live change

Supabase `opencode-worker` deployed as v7. Existing custom bearer/job-token authentication preserved.

- Model requests explicitly identify this endpoint as inference-only. It must not invent external checks, tools, tests or file changes.
- Atomic queued-to-running transition now requires a returned claimed row before any work starts.
- Parallel requests report failure if any child failed, preserving child results for diagnosis.

Private v6/v7 source is retained separately, not in this public repository. `scripts/harden-opencode-worker.mjs` applies the four exact guarded transformations to a retrieved v6 copy and rejects baseline drift. Roll back by redeploying the preserved v6 files with the same authentication settings if a concrete regression appears.

## Verification

- 17 Python evidence/capture regression tests passed.
- Skill frontmatter validation passed.
- All three provider payload formats preserve the JSON response contract and evidence instruction.
- Concurrent claim test against the patched private source: exactly one of two requests completed the same job; duplicate rejected.
- Existing application test and production build passed; infrastructure policy verifier passed.
- Live v7 health job completed with provider configured and persistence true.
- Live synthetic registry request correctly reported inability to verify without registry evidence; returned no invented tests or file changes.
- Unauthenticated POST to live worker returned HTTP 401.

## Prepared, not yet enforced in production

`tools/dd/quality.py` checks source file hashes, source/execution references, current revision, review separation and closure evidence. It renders escaped script-free HTML with clickable citations. `capture.py` preserves content-addressed evidence copies. `audit_pdf.py` audits delivery defects without changing case conclusions. New tests are included in CI.

The `integritas-dd` skill is version-controlled for deployment with these tools. It is not installed on the Oracle host yet. No new cloud browser, third-party research repository or paid service has been installed. The existing report publisher does not yet call the offline quality gate.

## Remaining integration gate

Oracle cloud browser displays Site Unavailable; the connected Cloud Shell device is offline. The connected Mac has a local OpenClaw configuration but no remote gateway URL or executable resolved in the inspected PATH. These observations do not establish Oracle VM health.

Next: recover an authenticated Oracle execution path, inspect actual host/configuration, install this tested package, validate browser and provider capabilities, then implement the narrow outbound lease/checkpoint integration and enforce the quality gate before publishing cloud reports. Preserve PR #1 as draft/unmerged and the current public site. Do not mistake deployment preparation or model inference for tool-enabled cloud DD.
