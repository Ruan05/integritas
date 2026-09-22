import tempfile
import unittest
from pathlib import Path

from page_extract_v1 import MAX_PAGE_TEXT, extract_file, normalize_text


class PageExtractV1Tests(unittest.TestCase):
    def test_text_evidence_is_page_numbered_and_hashed(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "evidence.txt"
            p.write_text("Seller: Example Co\nAmount: USD 10", encoding="utf-8")
            row = extract_file(p)
            self.assertEqual(row["kind"], "text")
            self.assertEqual(row["page_count"], 1)
            self.assertEqual(row["pages"][0]["page"], 1)
            self.assertIn("Seller: Example Co", row["pages"][0]["text"])
            self.assertEqual(len(row["sha256"]), 64)

    def test_page_text_is_bounded(self):
        self.assertLessEqual(len(normalize_text("x" * (MAX_PAGE_TEXT + 100))), MAX_PAGE_TEXT)


if __name__ == "__main__":
    unittest.main()
