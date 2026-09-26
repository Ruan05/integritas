"""Copy a received file into a content-addressed evidence store without modifying it."""
import argparse
import json
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from quality import digest


def capture(source, root, acquired_by, origin_id):
    source, root = Path(source), Path(root)
    sha = digest(source)
    root.mkdir(parents=True, exist_ok=True)
    target = root / sha
    fd, temp = tempfile.mkstemp(prefix='.capture-', dir=root)
    try:
        with os.fdopen(fd, 'wb') as out, source.open('rb') as inp:
            shutil.copyfileobj(inp, out)
            out.flush()
            os.fsync(out.fileno())
        if digest(temp) != sha:
            raise RuntimeError('Source changed during acquisition')
        try:
            os.link(temp, target)
        except FileExistsError:
            if digest(target) != sha:
                raise RuntimeError('Existing evidence has been modified')
    finally:
        os.unlink(temp)
    return {'artifact': sha, 'sha256': sha, 'original_filename': source.name,
            'size_bytes': target.stat().st_size, 'acquired_by': acquired_by,
            'origin_id': origin_id, 'retrieved_at': datetime.now(timezone.utc).isoformat()}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('source', type=Path)
    p.add_argument('--evidence-root', required=True, type=Path)
    p.add_argument('--acquired-by', required=True)
    p.add_argument('--origin-id', required=True, help='Gmail message/attachment ID or source acquisition ID')
    a = p.parse_args()
    print(json.dumps(capture(a.source, a.evidence_root, a.acquired_by, a.origin_id)))
