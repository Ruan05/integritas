import copy
import unittest

from quality_v1 import validate


def prototype1_maximum_report():
    sections = [
        "# Master Issue Dashboard\nCurrent position and why each material issue matters.",
        "## 1. Investigation Completion Statement\nMaximum-depth investigation completed to public-source limits.",
        "## 2. Intake Context / Translation and Evidentiary Test\nSender assertions are separated from documentary proof.",
        "## 3. Executive Summary - Non-Technical\nPlain-English findings and current status.",
        "## 4. Current Diligence Status\nMaterial verification gates remain open.",
        "## 5. Evidence Package Reviewed\nEvidence register covers every submitted document and SHA-256 provenance.",
        "## 6. Document Forensics & Internal Consistency\nMetadata, signatures, chronology and contradictions are assessed.",
        "## 7. Corporate / Legal Identity\nLegal identity and registry claims are assessed.",
        "## 8. Ownership, Control, People & Relationship Intelligence\nBeneficial ownership, authority and relationship intelligence are assessed.",
        "## 9. Address, Physical Presence, Domain, Website & Email Infrastructure\nPhysical presence and digital footprint are assessed.",
        "## 10. Banking / Financial Counterparty Review\nBanking claims are separated from account ownership proof.",
        "## 11. Product / Asset / Capability / Logistics Review\nCommercial capacity and delivery capability are assessed.",
        "## 12. Pricing / Economics / Market Context\nPricing and economics are compared cautiously.",
        "## 13. Transaction Procedure, Contract & Trade-Finance Review\nTransaction procedure and trade-finance risks are assessed.",
        "## 14. Sanctions, PEP, Regulatory, Enforcement, Litigation & Adverse-Media Screening\nNo exact hit is not clearance.",
        "## 15. Possible Fraud / Scam / Misrepresentation Indicators\nIndicators are not accusations and require verification.",
        "## 16. Positive / Risk-Reducing Indicators\nVerified positive indicators and risk-reducing evidence are recorded.",
        "## 17. Risk Matrix\nRisk matrix separates exposure, evidence and confidence.",
        "## 18. Mandatory Verification Gates / Closure Register\nCritical gates list blocker, required source and next action.",
        "## 19. Plain-English Next Steps\nRecommended order of work and stop conditions.",
        "## 20. Source Ledger\nSources and verification record preserve exact provenance.",
        "## 21. Contradictions, Unresolved Checks & Limitations\nUnresolved checks, blockers and limitations are consolidated.",
        "## 22. Draft Conclusion / Final Assessment\nHuman review remains required.",
        "### Person-by-person clearance heatmap / subject matrix\nIdentity, role, sanctions and capability status are shown per subject.",
        "### Comprehensive Profile Dossiers - Every Material Person and Entity\nPerson Profile and Entity Profile records preserve identifiers, roles, screening and unresolved authority.",
        "### Visual relationship and evidence network\nRelationship map edges are source-linked and disambiguated.",
        "### Entity and digital-identity timeline / chronology\nDigital timeline and commercial chronology preserve material dates and revisions.",
        "### Claim-to-evidence matrix\nEach material claim is mapped to evidence and next verification.",
        "### Research-lane coverage statement\nResearch coverage is not evidence completeness.",
        "### False-positive controls\nNamesake disambiguation and false-positive handling are explicit.",
    ]
    detail = (
        "\nDetailed evidence narrative preserves identifiers, dates, source hierarchy, "
        "page references, benign explanations, attempted methods, blockers and manual next actions. "
        "Verified facts, corroborated facts, submitted claims, allegations, inference, contradictions "
        "and unresolved items remain distinct. "
    )
    report = "\n\n".join(sections)
    while len(report) < 8500:
        report += detail
    return report


class InvestigationBundleV1QualityTests(unittest.TestCase):
    def setUp(self):
        self.doc1 = "11111111-1111-4111-8111-111111111111"
        self.doc2 = "22222222-2222-4222-8222-222222222222"
        self.manifest = {
            "case_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "case_job_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            "case_revision": 2,
            "depth": "maximum",
            "documents": [
                {"id": self.doc1, "name": "one.pdf", "sha256": "a" * 64, "size_bytes": 100},
                {"id": self.doc2, "name": "two.txt", "sha256": "b" * 64, "size_bytes": 50},
            ],
        }
        report = prototype1_maximum_report()
        self.report = report
        self.bundle = {
            "schema_version": 1,
            "case_id": self.manifest["case_id"],
            "case_job_id": self.manifest["case_job_id"],
            "case_revision": 2,
            "depth": "maximum",
            "generated_at": "2026-09-19T05:00:00+00:00",
            "entities": [],
            "relationships": [],
            "sources": [
                {
                    "source_key": "doc-one",
                    "source_type": "document",
                    "title": "one.pdf",
                    "url": None,
                    "document_id": self.doc1,
                    "page_reference": "p.1",
                    "excerpt": "First document evidence",
                    "reliability_note": "Submitted evidence; authenticity not assumed.",
                    "evidence_origin": "submitted_document",
                    "retrieved_at": "2026-09-19T05:00:00+00:00",
                },
                {
                    "source_key": "doc-two",
                    "source_type": "document",
                    "title": "two.txt",
                    "url": None,
                    "document_id": self.doc2,
                    "page_reference": None,
                    "excerpt": "Second document evidence",
                    "reliability_note": "Submitted evidence; authenticity not assumed.",
                    "evidence_origin": "submitted_document",
                    "retrieved_at": "2026-09-19T05:00:00+00:00",
                },
                {
                    "source_key": "web-one",
                    "source_type": "official",
                    "title": "Official source",
                    "url": "https://example.org/official",
                    "document_id": None,
                    "page_reference": None,
                    "excerpt": "Public-source verification",
                    "reliability_note": "Official public source.",
                    "evidence_origin": "external_research",
                    "retrieved_at": "2026-09-19T05:02:00+00:00",
                },
            ],
            "findings": [],
            "checks": [],
            "contradictions": [],
            "unresolved_checks": [],
            "limitations": [],
            "report": {"summary": "Synthetic", "markdown": report, "status": "draft"},
            "execution": {
                "started_at": "2026-09-19T05:00:00+00:00",
                "completed_at": "2026-09-19T05:03:00+00:00",
                "stages": ["analyzing_documents", "researching", "drafting_report"],
                "tool_results": [
                    {"tool": "integritas_forensics_v1", "status": "completed", "summary": "Trusted pre-pass complete."}
                ],
                "warnings": [],
                "terminal_outcome": "incomplete",
            },
        }

        self.forensics = {
            "schema_version": 1,
            "tool": "integritas_forensics_v1",
            "reports": [
                {
                    "document_id": self.doc1,
                    "original_name": "one.pdf",
                    "local_path": f"documents/{self.doc1}.pdf",
                    "sha256": "a" * 64,
                    "size_bytes": 100,
                    "kind": "pdf",
                    "pdf": {"cryptographic_signature_present": False},
                },
                {
                    "document_id": self.doc2,
                    "original_name": "two.txt",
                    "local_path": f"documents/{self.doc2}.txt",
                    "sha256": "b" * 64,
                    "size_bytes": 50,
                    "kind": "other",
                },
            ],
        }

    def errors(self, bundle=None, forensics=None):
        evidence_forensics = self.forensics if forensics is None else forensics
        return validate(bundle or self.bundle, self.manifest, self.report, 2, evidence_forensics)[0]

    def test_valid_bundle_covers_every_manifest_document(self):
        self.assertEqual(self.errors(), [])

    def test_maximum_report_rejects_missing_prototype1_lanes(self):
        bundle = copy.deepcopy(self.bundle)
        bundle["report"]["markdown"] = "# Executive Summary\nShort maximum report."
        errors, summary = validate(
            bundle, self.manifest, bundle["report"]["markdown"], 2, self.forensics
        )
        self.assertTrue(any("Prototype 1 report is too short" in error for error in errors))
        self.assertTrue(any("Prototype 1 lanes missing" in error for error in errors))
        self.assertTrue(any("Prototype 1 features missing" in error for error in errors))
        self.assertGreater(len(summary["prototype1_missing_lanes"]), 0)

    def test_maximum_requires_trusted_forensics(self):
        self.assertTrue(any("requires trusted forensic pre-pass" in error for error in self.errors(forensics={})))

    def test_forensic_hash_mismatch_is_rejected(self):
        forensic = copy.deepcopy(self.forensics)
        forensic["reports"][0]["sha256"] = "0" * 64
        self.assertTrue(any("sha256 mismatch" in error for error in self.errors(forensics=forensic)))

    def test_maximum_requires_forensic_execution_marker(self):
        bundle = copy.deepcopy(self.bundle)
        bundle["execution"]["tool_results"] = []
        self.assertTrue(any("must record completed integritas_forensics_v1" in error for error in self.errors(bundle)))

    def test_missing_manifest_document_is_rejected(self):
        bundle = copy.deepcopy(self.bundle)
        bundle["sources"] = [row for row in bundle["sources"] if row.get("document_id") != self.doc2]
        self.assertTrue(any("every manifest document" in error for error in self.errors(bundle)))

    def test_submitted_document_requires_document_type_and_id(self):
        bundle = copy.deepcopy(self.bundle)
        bundle["sources"][0]["document_id"] = None
        bundle["sources"][0]["source_type"] = "primary"
        errors = self.errors(bundle)
        self.assertTrue(any("source_type document" in error for error in errors))
        self.assertTrue(any("requires manifest document_id" in error for error in errors))

    def test_external_research_requires_https_url_and_no_document_id(self):
        bundle = copy.deepcopy(self.bundle)
        bundle["sources"][2]["url"] = None
        bundle["sources"][2]["document_id"] = self.doc1
        errors = self.errors(bundle)
        self.assertTrue(any("external research requires public HTTPS URL" in error for error in errors))
        self.assertTrue(any("external research cannot use document_id" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
