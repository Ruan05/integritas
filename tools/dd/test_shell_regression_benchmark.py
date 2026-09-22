import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BENCHMARK_PATH = ROOT / "benchmarks" / "shell_four_pdf_v1.json"


class ShellFourPdfBenchmarkTests(unittest.TestCase):
    def test_exact_source_hashes_and_thresholds_are_locked(self):
        benchmark = json.loads(BENCHMARK_PATH.read_text(encoding="utf-8"))
        hashes = {row["sha256"] for row in benchmark["expected_documents"]}
        self.assertEqual(hashes, {
            "ed80c8b95309748a4c8561f3cf0163d1444591c813ea24d55322d05841e880cf",
            "6a6c1ffe4967c0e3f10af256ff8234bd951905b18f48ac9b838d263a051cf43d",
            "0de295ac9bf452440924edba63658493692f6a00eb81bd6aeffbc8ce67e59d01",
            "e105196565c1334fe2ffefb3a2a52af7129221fefae1ab6e85d08de97d9959e8",
        })
        self.assertGreaterEqual(benchmark["minimums"]["external_sources"], 8)
        self.assertGreaterEqual(benchmark["thresholds"]["critical_required"], 10)
        self.assertGreaterEqual(benchmark["thresholds"]["secondary_minimum"], 5)

    def test_benchmark_is_post_run_only(self):
        benchmark = json.loads(BENCHMARK_PATH.read_text(encoding="utf-8"))
        self.assertIn("post-run evaluation only", benchmark["description"])
        ids = [row["id"] for row in benchmark["critical"] + benchmark["secondary"]]
        self.assertEqual(len(ids), len(set(ids)))


if __name__ == "__main__":
    unittest.main()

[executed on device: integritas-openclaw-a1 (9d9982e8-9052-45b2-b91d-0faeaae0cc0d)]