#!/usr/bin/env python3
"""Deterministic page-level text/OCR extraction for staged Integritas evidence.

Original evidence is never modified. PDF pages use native pdftotext first; pages with
insufficient text are rendered with pdftoppm and OCRed with Tesseract. Output is a
bounded JSON sidecar with page locators for downstream evidence synthesis.
"""
import argparse
import hashlib
import json
import re
import subprocess
import tempfile
from pathlib import Path

MAX_PAGES = 60
MAX_PAGE_TEXT = 8000
NATIVE_MIN_CHARS = 160


def sha256(path: Path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def run(args, timeout=90):
    p = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False)
    return p.returncode, p.stdout, p.stderr


def normalize_text(raw):
    if isinstance(raw, bytes):
        raw = raw.decode('utf-8', errors='replace')
    raw = raw.replace('\x00', '')
    raw = re.sub(r'[ \t]+\n', '\n', raw)
    raw = re.sub(r'\n{4,}', '\n\n\n', raw)
    return raw.strip()[:MAX_PAGE_TEXT]


def pdf_page_count(path: Path):
    rc, out, _ = run(['/usr/bin/pdfinfo', str(path)], timeout=30)
    if rc != 0:
        return None
    m = re.search(rb'^Pages:\s*(\d+)\s*$', out, flags=re.M)
    return int(m.group(1)) if m else None


def native_pdf_pages(path: Path):
    rc, out, err = run(['/usr/bin/pdftotext', '-layout', '-enc', 'UTF-8', str(path), '-'], timeout=90)
    if rc != 0:
        return [], normalize_text(err)[:1000]
    text = out.decode('utf-8', errors='replace')
    return [normalize_text(page) for page in text.split('\f')], None


def ocr_pdf_page(path: Path, page_no: int):
    with tempfile.TemporaryDirectory(prefix='integritas-ocr-') as td:
        base = Path(td) / 'page'
        rc, _, err = run([
            '/usr/bin/pdftoppm', '-f', str(page_no), '-l', str(page_no),
            '-singlefile', '-r', '200', '-png', str(path), str(base),
        ], timeout=60)
        image = base.with_suffix('.png')
        if rc != 0 or not image.exists():
            return '', f'render_failed:{normalize_text(err)[:300]}'
        rc, out, err = run([
            '/usr/bin/tesseract', str(image), 'stdout', '-l', 'eng', '--psm', '6',
        ], timeout=75)
        if rc != 0:
            return '', f'ocr_failed:{normalize_text(err)[:300]}'
        return normalize_text(out), None


def extract_pdf(path: Path):
    count = pdf_page_count(path)
    native_pages, native_error = native_pdf_pages(path)
    if count is None:
        count = max(1, len(native_pages))
    raw_count = count
    count = min(count, MAX_PAGES)
    pages = []
    for page_no in range(1, count + 1):
        native = native_pages[page_no - 1] if page_no - 1 < len(native_pages) else ''
        if len(re.sub(r'\s+', '', native)) >= NATIVE_MIN_CHARS:
            text, method, error = native, 'native_text', None
        else:
            text, error = ocr_pdf_page(path, page_no)
            method = 'ocr_tesseract' if text else 'unreadable'
            if not text and native:
                text, method = native, 'native_sparse'
        pages.append({
            'page': page_no,
            'method': method,
            'text_chars': len(text),
            'unreadable': not bool(text.strip()),
            'text': text,
            **({'error': error} if error else {}),
        })
    return {
        'page_count': count,
        'truncated_to_page_limit': raw_count > MAX_PAGES,
        'native_extract_error': native_error,
        'pages': pages,
    }


def extract_file(path: Path):
    suffix = path.suffix.lower()
    base = {
        'filename': path.name,
        'sha256': sha256(path),
        'size_bytes': path.stat().st_size,
        'kind': 'pdf' if suffix == '.pdf' else 'text',
    }
    if suffix == '.pdf':
        base.update(extract_pdf(path))
    else:
        try:
            text = normalize_text(path.read_bytes())
            base.update({'page_count': 1, 'truncated_to_page_limit': False, 'native_extract_error': None,
                         'pages': [{'page': 1, 'method': 'native_text', 'text_chars': len(text), 'unreadable': not bool(text), 'text': text}]})
        except Exception as exc:
            base.update({'page_count': 1, 'truncated_to_page_limit': False, 'native_extract_error': type(exc).__name__,
                         'pages': [{'page': 1, 'method': 'unreadable', 'text_chars': 0, 'unreadable': True, 'text': '', 'error': type(exc).__name__}]})
    return base


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='+', type=Path)
    args = ap.parse_args()
    for dep in ('/usr/bin/pdftotext', '/usr/bin/pdfinfo', '/usr/bin/pdftoppm', '/usr/bin/tesseract'):
        if not Path(dep).exists():
            raise SystemExit(f'missing dependency: {dep}')
    reports = [extract_file(p) for p in args.files]
    print(json.dumps({'schema_version': 1, 'tool': 'integritas_page_extract_v1', 'reports': reports}, ensure_ascii=False))


if __name__ == '__main__':
    main()
