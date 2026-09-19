import json
import unittest
from pathlib import Path

from evaluate_prototype1_reproduction import evaluate

ROOT = Path(__file__).parent
BENCHMARK = json.loads((ROOT / "benchmarks" / "prototype1_pavillon_v1.json").read_text())


def passing_bundle():
    report = """
PAVILLON X11 LIMITED RC 1093130 ACTIVE.
THEOPHILUS EMEKA NWANGUMA is recorded as a 50% PSC with significant control and voting rights.
PAVILLON X11 and PAVILLON XII create a legal-name mismatch that must be reconciled.
The ICPO seller block is blank and seller approval is not evidenced.
UBNINGLA belongs to UNION BANK, but the beneficiary account remains unverified.
unionbanking.com is inconsistent with unionbankng.com; the former was for sale with no MX and is unauthenticated.
77 Kwame Nkrumah Crescent is publicly associated with L-PRES, so physical office presence is not cleared.
Product and title remain unverified; terminal and SGS inspection evidence are missing.
The 100 million gallon trial and 200 million gallon monthly program are extraordinary and require capacity proof.
There is a procedure contradiction between pre-injection payment before injection and post-delivery / after injection payment.
Oman origin and chain of title remain an unverified assertion and must be validated.
OFAC returned no exact match; this is not clearance.
Final status: HOLD - unverified transaction, not cleared until verification gates close.
Tax review: 18540363-0001 and JTB 1048856718 require reconciliation.
FLEETDOWN NIGERIA LIMITED RC 1821750 is a related entity with 100% ownership in the relevant record.
SOUL IMINA officer link remains secondary and not established by official beneficial ownership evidence.
SARAVIN is a network lead requiring disambiguation; do not attribute misconduct.
pavillonxii.com has Microsoft 365 MX and DMARC; the current domain history includes March 2025.
PKABA00 methodology uses typical parcel sizes of 25,000 to 55,000 metric tonnes.
USD 1.05/gallon equates to roughly 292-302 per metric tonne; broader benchmark context uses different grades.
Due Diligence Convention wording is generic boilerplate/template reuse and has little authenticity value.
Rotterdam storage spoofing controls require direct terminal verification; Port of Rotterdam / VOTOB context is relevant.
MT799, BCL, SBLA/SBLC and UCP 600 / ICC 500 terminology require bank/legal review.
Remaining ownership is open and must be established through a fresh certified shareholder/PSC filing.
No NMDPRA permit or licence number was supplied, so petroleum authorization is not verified and must be verified.
World Bank and AfDB debarment screening returned no exact entry; negative debarment results are not formal clearance.
A false positive / namesake hit was rejected after disambiguation and is not attributed to the subject.
"""
    sources = []
    for i in range(3):
        sources.append({"source_key": f"doc-{i}", "evidence_origin": "submitted_document"})
    for i in range(8):
        sources.append({"source_key": f"web-{i}", "evidence_origin": "external_research"})
    return {
        "report": {"summary": "Prototype 1 reproduction", "markdown": report},
        "entities": [{"entity_key": f"e-{i}"} for i in range(5)],
        "relationships": [],
        "sources": sources,
        "findings": [{"finding_key": f"f-{i}", "claim": report} for i in range(12)],
        "checks": [{"check_key": f"c-{i}", "description": "verification"} for i in range(10)],
        "contradictions": [],
        "unresolved_checks": [{"unresolved_key": f"u-{i}", "description": "open"} for i in range(8)],
        "limitations": [],
    }


class Prototype1ReproductionEvaluatorTests(unittest.TestCase):
    def test_reference_equivalent_bundle_passes(self):
        result = evaluate(passing_bundle(), BENCHMARK)
        self.assertTrue(result["passed"], result)
        self.assertEqual(result["critical"]["passed"], result["critical"]["total"])
        self.assertGreaterEqual(result["secondary"]["passed"], result["secondary"]["required"])

    def test_missing_material_finding_fails(self):
        bundle = passing_bundle()
        bundle["report"]["markdown"] = bundle["report"]["markdown"].replace(
            "77 Kwame Nkrumah Crescent is publicly associated with L-PRES, so physical office presence is not cleared.",
            "",
        )
        bundle["findings"] = [{"finding_key": f"f-{i}", "claim": "other evidence"} for i in range(12)]
        result = evaluate(bundle, BENCHMARK)
        self.assertFalse(result["passed"])
        failed = {row["id"] for row in result["critical"]["results"] if not row["passed"]}
        self.assertIn("address_lpres", failed)


if __name__ == "__main__":
    unittest.main()
