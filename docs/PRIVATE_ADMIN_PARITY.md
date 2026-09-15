# Private Admin Feature-Parity Matrix

This matrix separates verified live control-plane behavior from the GitHub preview. It prevents the preview from claiming live capabilities before its authenticated integration is complete.

| Capability | Verified existing control plane | GitHub preview status | Integration gate |
| --- | --- | --- | --- |
| Cases and explicit access | Server API checks authenticated identity and case role | Server-gated | Tested RLS migration and authenticated API session |
| Upload and SHA-256 dedupe | Admin API validates files, preserves originals, dedupes by case hash | Server-gated | Authenticated API session |
| Investigation and durable jobs | Case jobs link to OpenCode jobs; browser state is not authoritative | Server-gated | Worker health plus authenticated API session |
| Entity separation | Worker instructions explicitly prohibit name-only merging | Server-gated | Synthetic case evidence |
| Findings and evidence provenance | Findings and source records are case-linked | Server-gated | Authenticated snapshot |
| Contradictions and unresolved checks | Admin API persists structured checks and findings | Server-gated | Synthetic case evidence |
| Reports and finalisation | Review/finalisation guards are implemented in the admin API | Server-gated | Synthetic case evidence |
| Agent activity and job progress | Case job and provider status are persisted | Server-gated | Worker health plus authenticated API session |
| Development change sets | Change-set and repository records exist with approval fields | Approval-gated | GitHub branch/PR policy |
| Admin Agent | Existing API authenticates admins and records audit events | Server-gated | Authenticated API session |
| Maximum Guarded | Approval, audit, and server-only operations exist | Approval-gated | Policy and runtime health |
| Audit/history | Audit events are persisted by the server API | Server-gated | Authenticated snapshot |
| Cancel/resume/retry | Job cancellation and synchronization are implemented server-side | Server-gated | Synthetic job exercise |
| Tool capability health | Worker health/model calls exist | Not verified in preview | Authenticated server health check |
| Mobile Safari | CI runs WebKit responsive checks against the GitHub preview | Verified for preview layout | Live authenticated workflow test |

## Non-negotiable UI rule

The GitHub preview must not render sample cases, fabricated evidence, or a READY/LIVE state. A capability becomes ready only after an authenticated server health check or case-scoped API response verifies it.
