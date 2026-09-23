---
name: "Integritas Document Verifier"
description: "Verify document extraction and provenance before relying on AI interpretation in Integritas investigations."
---

# Integritas Document Verifier

Use this skill for PDFs, scans, Office evidence, signatures, tables, images, and extraction failures.

1. Hash and identify the original evidence before transformation.
2. Prefer native text when present; use deterministic OCR only for image-only or low-text pages.
3. Preserve page boundaries and page locators through every derivative.
4. Cross-check critical names, identifiers, dates, amounts, account details, signatures, and execution blocks against the original page image.
5. Treat OCR output as a derivative, never as higher-authority evidence than the original file.
6. Separate cryptographic/file integrity from identity, authority, ownership, capacity, and truth of transaction claims.
7. Flag encrypted, malformed, truncated, unsigned, suspiciously edited, or extraction-incomplete files explicitly.
8. Do not infer fraud from formatting, templates, metadata anomalies, or image reuse alone.
9. Re-open only targeted pages after the comprehensive pass to avoid redundant work.
10. Preserve exact source/document IDs so findings trace back to immutable evidence.
