"""Evaluate a fresh Integritas bundle against a hidden Prototype 1 benchmark."""
import argparse
import json
import re
from pathlib import Path


def combined_text(bundle):
    parts = []
    report = bundle.get("report") if isinstance(bundle, dict) else {}
    if isinstance(report, dict):
        parts.extend([str(report.get("summary", "")), str(report.get("markdown", ""))])
    for key in ("entities", "relationships", "sources", "findings", "checks", "contradictions", "unresolved_checks", "limitations"):
        value = bundle.get(key, []) if isinstance(bundle, dict) else []
        parts.append(json.dumps(value, ensure_ascii=False, sort_keys=True))
    return "\n".join(parts)


def match_requirement(text, requirement):
    missing = []
    for pattern in requirement.get("patterns", []):
        if not re.search(pattern, text, flags=re.I | re.S):
            missing.append(pattern)
    return not missing, missing


def evaluate(bundle, benchmark):
    text = combined_text(bundle)
    critical_results = []
    secondary_results = []
    for group_name, target in (("critical", critical_results), ("secondary", secondary_results)):
        for requirement in benchmark.get(group_name, []):
            passed, missing_patterns = match_requirement(text, requirement)
            target.append({
                "id": requirement.get("id"),
                "passed": passed,
                "missing_patterns": missing_patterns,
            })

    sources = bundle.get("sources", []) if isinstance(bundle.get("sources"), list) else []
    minimums = benchmark.get("minimums", {})
    counts = {
        "submitted_documents": sum(1 for row in sources if isinstance(row, dict) and row.get("evidence_origin") == "submitted_document"),
        "external_sources": sum(1 for row in sources if isinstance(row, dict) and row.get("evidence_origin") == "external_research"),
        "entities": len(bundle.get("entities", [])) if isinstance(bundle.get("entities"), list) else 0,
        "findings": len(bundle.get("findings", [])) if isinstance(bundle.get("findings"), list) else 0,
        "checks": len(bundle.get("checks", [])) if isinstance(bundle.get("checks"), list) else 0,
        "unresolved_checks": len(bundle.get("unresolved_checks", [])) if isinstance(bundle.get("unresolved_checks"), list) else 0,
    }
    count_failures = {
        key: {"actual": counts.get(key, 0), "required": required}
        for key, required in minimums.items()
        if counts.get(key, 0) < required
    }

    critical_passed = sum(1 for row in critical_results if row["passed"])
    secondary_passed = sum(1 for row in secondary_results if row["passed"])
    thresholds = benchmark.get("thresholds", {})
    critical_required = thresholds.get("critical_required", len(critical_results))
    secondary_minimum = thresholds.get("secondary_minimum", len(secondary_results))
    passed = (
        critical_passed >= critical_required
        and secondary_passed >= secondary_minimum
        and not count_failures
    )
    return {
        "benchmark_id": benchmark.get("benchmark_id"),
        "passed": passed,
        "critical": {
            "passed": critical_passed,
            "required": critical_required,
            "total": len(critical_results),
            "results": critical_results,
        },
        "secondary": {
            "passed": secondary_passed,
            "required": secondary_minimum,
            "total": len(secondary_results),
            "results": secondary_results,
        },
        "counts": counts,
        "count_failures": count_failures,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    parser.add_argument(
        "--benchmark",
        type=Path,
        default=Path(__file__).parent / "benchmarks" / "prototype1_pavillon_v1.json",
    )
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    bundle = json.loads(args.bundle.read_text(encoding="utf-8"))
    benchmark = json.loads(args.benchmark.read_text(encoding="utf-8"))
    result = evaluate(bundle, benchmark)
    encoded = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    raise SystemExit(0 if result["passed"] else 1)


if __name__ == "__main__":
    main()
