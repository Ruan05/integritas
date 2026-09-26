"""Read-only PDF delivery audit. Requires PyMuPDF; does not reverify case findings."""
import argparse
import json
import re
from pathlib import Path
import fitz
from quality import digest


def audit(path):
    with fitz.open(path) as doc:
        text = '\n'.join(page.get_text() for page in doc)
        links = sum(len(page.get_links()) for page in doc)
        warnings = []
        if 'https://' in text and links == 0:
            warnings.append('Source URLs exist but PDF has no embedded hyperlinks')
        if re.search(r'COMPLETED\s*/\s*(?:BLOCKING|PARTIAL)|OPEN-SOURCE COMPLETE', text):
            warnings.append('Execution and evidence status are conflated')
        if re.search(r'SHA-256.*abridged|Full SHA-256 values are retained', text, re.I):
            warnings.append('Full evidence hashes require the companion manifest')
        if re.search(r'substantially verified|substantially corroborated', text, re.I) and 'WHOIS' in text:
            warnings.append('Review whether domain-registration data is overstated as authentication')
        return {'filename': Path(path).name, 'sha256': digest(path), 'pages': len(doc),
                'words': len(text.split()), 'embedded_links': links,
                'warnings': warnings, 'scope': 'Delivery and wording audit only; original facts not reverified'}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('pdfs', nargs='+', type=Path)
    args = p.parse_args()
    print(json.dumps({'reports': [audit(path) for path in args.pdfs]}, indent=2))
