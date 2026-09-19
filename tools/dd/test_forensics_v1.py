import hashlib
import tempfile
import unittest
from pathlib import Path

from forensics_v1 import audit_file


class ForensicsV1Tests(unittest.TestCase):
    def test_extracts_pdf_metadata_and_signature_markers(self):
        data = (
            b"%PDF-1.7\n"
            b"1 0 obj << /Type /Page >> endobj\n"
            b"2 0 obj << /Author (Roy Lungu) /Creator (Microsoft Word 2019) "
            b"/Producer (Quartz PDFContext) /CreationDate (D:20250917120000Z) "
            b"/ModDate (D:20250917130000Z) >> endobj\n"
            b"3 0 obj << /FT /Sig /Type /Sig /ByteRange [0 10 20 30] >> endobj\n"
            b"%%EOF\n"
        )
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "sample.pdf"
            path.write_bytes(data)
            result = audit_file(path)
        self.assertEqual(result["kind"], "pdf")
        self.assertEqual(result["sha256"], hashlib.sha256(data).hexdigest())
        self.assertEqual(result["pdf"]["version"], "1.7")
        self.assertEqual(result["pdf"]["page_objects_estimate"], 1)
        self.assertEqual(result["pdf"]["metadata"]["Author"], "Roy Lungu")
        self.assertEqual(result["pdf"]["metadata"]["Creator"], "Microsoft Word 2019")
        self.assertEqual(result["pdf"]["metadata"]["Producer"], "Quartz PDFContext")
        self.assertTrue(result["pdf"]["cryptographic_signature_present"])
        self.assertEqual(result["pdf"]["signature_field_markers"], 1)
        self.assertEqual(result["pdf"]["byte_range_markers"], 1)

    def test_non_pdf_still_preserves_hash_and_size(self):
        data = b"plain evidence"
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "evidence.txt"
            path.write_bytes(data)
            result = audit_file(path)
        self.assertEqual(result["kind"], "other")
        self.assertEqual(result["size_bytes"], len(data))
        self.assertEqual(result["sha256"], hashlib.sha256(data).hexdigest())
        self.assertNotIn("pdf", result)


if __name__ == "__main__":
    unittest.main()
