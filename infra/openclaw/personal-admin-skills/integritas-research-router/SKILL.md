---
name: "Integritas Research Router"
description: "Choose the strongest bounded research route for Integritas while preserving source provenance, provider diversity, and failure recovery."
---

# Integritas Research Router

Use this skill for operator-side research design, provider selection, research-stack debugging, and investigation-support work.

1. Start with the exact claim, entity, identifier, jurisdiction, date range, and authoritative source class needed.
2. Use `web_search` for broad discovery. Prefer primary/official sources over aggregators.
3. Open every material source. Use Firecrawl-backed `web_fetch` for stable pages and browser for dynamic or interactive sources.
4. If Exa is credentialed and smoke-tested, prefer it for semantic/entity discovery when keyword search is weak.
5. If keyed Firecrawl tools are credentialed and smoke-tested, use them for difficult extraction, crawling, domain filters, PDFs, or structured results.
6. Never repeatedly retry one failing provider. Change provider/tool/source route and record the limitation.
7. For a material claim, seek an independent corroborating or contradicting source when reasonably available.
8. Search snippets are leads, not evidence. Preserve the final opened URL and source class.
9. Stop when the lane's question is resolved or when the next step requires direct/manual confirmation.
10. Keep case evidence in case-scoped persistence. Do not put raw client evidence in operator memory.
