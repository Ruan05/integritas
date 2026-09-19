import copy
import unittest

from quality_v1 import validate


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
                {"id": self.doc1, "name": "one.pdf"},
                {"id": self.doc2, "name": "two.txt"},
            ],
        }
        report = "# Integritas report\n\nAll submitted evidence was reviewed."
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
                "tool_results": [],
                "warnings": [],
                "terminal_outcome": "incomplete",
            },
        }

    def errors(self, bundle=None):
        return validate(bundle or self.bundle, self.manifest, self.report, 2)[0]

    def test_valid_bundle_covers_every_manifest_document(self):
        self.assertEqual(self.errors(), [])

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
