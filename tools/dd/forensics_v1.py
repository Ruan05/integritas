"""Dependency-free, read-only forensic metadata extraction for Integritas evidence."""
import argparse
import hashlib
import json
import re
from pathlib import Path

MAX_FILE_BYTES = 64 * 1024 * 1024
PDF_META_KEYS = ("Title", "Author", "Subject", "Keywords", "Creator", "Producer", "CreationDate", "ModDate")


def digest_bytes(data):
    return hashlib.sha256(data).hexdigest()


def decode_pdf_bytes(value):
    if value.startswith(b"\xfe\xff"):
        try:
            return value[2:].decode("utf-16-be", errors="replace")
        except Exception:
            pass
    if value.startswith(b"\xff\xfe"):
        try:
            return value[2:].decode("utf-16-le", errors="replace")
        except Exception:
            pass
    for encoding in ("utf-8", "latin-1"):
        try:
            return value.decode(encoding)
        except Exception:
            continue
    return value.decode("latin-1", errors="replace")


def decode_literal(token):
    if token.startswith(b"(") and token.endswith(b")"):
        body = token[1:-1]
        out = bytearray()
        i = 0
        escapes = {
            ord("n"): b"\n", ord("r"): b"\r", ord("t"): b"\t",
            ord("b"): b"\b", ord("f"): b"\f",
            ord("("): b"(", ord(")"): b")", ord("\\"): b"\\",
        }
        while i < len(body):
            ch = body[i]
            if ch != 0x5C:
                out.append(ch)
                i += 1
                continue
            i += 1
            if i >= len(body):
                break
            ch = body[i]
            if ch in escapes:
                out.extend(escapes[ch])
                i += 1
                continue
            if ch in (0x0A, 0x0D):
                if ch == 0x0D and i + 1 < len(body) and body[i + 1] == 0x0A:
                    i += 1
                i += 1
                continue
            if 0x30 <= ch <= 0x37:
                digits = bytearray([ch])
                i += 1
                for _ in range(2):
                    if i < len(body) and 0x30 <= body[i] <= 0x37:
                        digits.append(body[i])
                        i += 1
                    else:
                        break
                out.append(int(digits.decode("ascii"), 8) & 0xFF)
                continue
            out.append(ch)
            i += 1
        return decode_pdf_bytes(bytes(out)).strip()
    if token.startswith(b"<") and token.endswith(b">") and not token.startswith(b"<<"):
        raw = re.sub(rb"\s+", b"", token[1:-1])
        if len(raw) % 2:
            raw += b"0"
        try:
            return decode_pdf_bytes(bytes.fromhex(raw.decode("ascii"))).strip()
        except Exception:
            return ""
    return ""


def find_pdf_value(data, key):
    pattern = rb"/" + key.encode("ascii") + rb"\s*(\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]+>)"
    matches = list(re.finditer(pattern, data, flags=re.S))
    for match in reversed(matches):
        value = decode_literal(match.group(1))
        if value:
            return value[:2000]
    return None


def embedded_image_stream_hashes(data):
    hashes = []
    for match in re.finditer(rb'(?s)\b\d+\s+\d+\s+obj\b(.*?)endobj', data):
        body = match.group(1)
        if not re.search(rb'/Subtype\s*/Image\b', body):
            continue
        stream = re.search(rb'(?s)stream(?:\r\n|\n|\r)(.*?)endstream', body)
        if stream is None:
            continue
        payload = stream.group(1).rstrip(b'\r\n')
        if not payload:
            continue
        hashes.append(hashlib.sha256(payload).hexdigest())
        if len(hashes) >= 200:
            break
    return sorted(set(hashes))


def audit_file(path):
    path = Path(path)
    size = path.stat().st_size
    if size < 0 or size > MAX_FILE_BYTES:
        raise ValueError(f"invalid evidence size: {path.name}")
    data = path.read_bytes()
    base = {
        "filename": path.name,
        "sha256": digest_bytes(data),
        "size_bytes": size,
        "kind": "pdf" if data.startswith(b"%PDF-") else "other",
    }
    if base["kind"] != "pdf":
        return base

    header = data[:32]
    version_match = re.search(rb"%PDF-([0-9.]+)", header)
    metadata = {key: find_pdf_value(data, key) for key in PDF_META_KEYS}
    metadata = {key: value for key, value in metadata.items() if value is not None}
    page_objects = len(re.findall(rb"/Type\s*/Page(?!s)\b", data))
    sig_fields = len(re.findall(rb"/FT\s*/Sig\b", data))
    sig_objects = len(re.findall(rb"/Type\s*/Sig\b", data))
    byte_ranges = len(re.findall(rb"/ByteRange\s*\[", data))
    base["pdf"] = {
        "version": version_match.group(1).decode("ascii") if version_match else None,
        "page_objects_estimate": page_objects or None,
        "metadata": metadata,
        "encrypted": bool(re.search(rb"/Encrypt\b", data)),
        "acroform_present": bool(re.search(rb"/AcroForm\b", data)),
        "signature_field_markers": sig_fields,
        "signature_object_markers": sig_objects,
        "byte_range_markers": byte_ranges,
        "cryptographic_signature_present": bool(sig_fields or sig_objects or byte_ranges),
        "embedded_image_stream_hashes": embedded_image_stream_hashes(data),
    }
    return base


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="+", type=Path)
    args = parser.parse_args()
    reports = [audit_file(path) for path in args.files]
    image_owners = {}
    for report in reports:
        for sha in report.get("pdf", {}).get("embedded_image_stream_hashes", []):
            image_owners.setdefault(sha, []).append(report["filename"])
    cross_document_image_reuse = [
        {"sha256": sha, "filenames": sorted(set(names))}
        for sha, names in sorted(image_owners.items())
        if len(set(names)) > 1
    ][:200]
    print(json.dumps({
        "schema_version": 1,
        "tool": "integritas_forensics_v1",
        "reports": reports,
        "cross_document_image_reuse": cross_document_image_reuse,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
