"""Offline evidence contract and report renderer. Python 3.10+, stdlib only."""
import argparse
import hashlib
import html
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

EXECUTION = {'queued', 'running', 'completed', 'failed', 'access_blocked', 'cancelled'}
CONCLUSIONS = {'corroborated', 'contradicted', 'inconclusive', 'not_checked'}
DECISIONS = {'informational', 'material_gap', 'blocking'}
AUTHORITY = {'official', 'registry_derived', 'counterparty', 'technical', 'secondary'}


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def timestamp(value):
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed if parsed.tzinfo is not None else None
    except (ValueError, TypeError, AttributeError):
        return None


def safe_url(value):
    try:
        p = urlsplit(value)
        return p.scheme == 'https' and bool(p.hostname) and not p.username and not p.password
    except (ValueError, TypeError, AttributeError):
        return False


def validate(bundle, root, current_revision):
    """Fail closed on broken provenance, stale review, and unsupported closure.

    This checks structure and evidence integrity, not the truth of a claim.
    Human review of cited evidence remains necessary.
    """
    errors = []
    root = Path(root).resolve()
    if not isinstance(bundle, dict):
        return ['bundle must be an object']
    for field in ('case_id', 'report_id', 'title'):
        if not isinstance(bundle.get(field), str) or not bundle[field].strip():
            errors.append(f'{field}: required')
    if type(bundle.get('revision')) is not int or bundle['revision'] != current_revision:
        errors.append('revision: stale or invalid')
    for key in ('sources', 'claims', 'actions', 'executions'):
        if not isinstance(bundle.get(key), list) or any(not isinstance(x, dict) for x in bundle.get(key, [])):
            errors.append(f'{key}: must be an array of objects')
    if errors:
        return errors

    def index(rows, name):
        result = {}
        for row in rows:
            ident = row.get('id')
            if not isinstance(ident, str) or not ident or ident in result:
                errors.append(f'{name}: missing or duplicate ID')
            else:
                result[ident] = row
        return result

    sources = index(bundle['sources'], 'sources')
    claims = index(bundle['claims'], 'claims')
    actions = index(bundle['actions'], 'actions')
    runs = index(bundle['executions'], 'executions')
    if not sources or not claims or not runs:
        errors.append('sources, claims and executions must be nonempty')

    for sid, source in sources.items():
        if source.get('authority') not in AUTHORITY:
            errors.append(f'{sid}: invalid source authority')
        for field in ('title', 'origin_id', 'acquired_by'):
            if not isinstance(source.get(field), str) or not source[field].strip():
                errors.append(f'{sid}: missing {field}')
        if not timestamp(source.get('retrieved_at')):
            errors.append(f'{sid}: timezone-aware retrieval time required')
        if 'effective_at' not in source or (source['effective_at'] is not None and not timestamp(source['effective_at'])):
            errors.append(f'{sid}: effective_at must be a timestamp or explicit null')
        if source.get('url') and not safe_url(source['url']):
            errors.append(f'{sid}: source URL must be HTTPS without credentials')
        try:
            rel = source['artifact']
            if not isinstance(rel, str) or Path(rel).is_absolute():
                raise ValueError('relative path required')
            artifact = (root / rel).resolve()
            artifact.relative_to(root)
            if not artifact.is_file() or digest(artifact) != source.get('sha256'):
                errors.append(f'{sid}: missing evidence or SHA-256 mismatch')
        except (KeyError, ValueError, TypeError, OSError):
            errors.append(f'{sid}: invalid evidence path')

    for rid, run in runs.items():
        if run.get('status') not in EXECUTION:
            errors.append(f'{rid}: invalid execution status')
        for field in ('agent', 'tool', 'input_summary'):
            if not isinstance(run.get(field), str) or not run[field].strip():
                errors.append(f'{rid}: missing {field}')
        start, end = timestamp(run.get('started_at')), timestamp(run.get('ended_at'))
        if not start:
            errors.append(f'{rid}: start time required')
        if run.get('status') in {'completed', 'failed', 'cancelled', 'access_blocked'}:
            if not end or (start and end < start):
                errors.append(f'{rid}: invalid completion time')
        refs = run.get('source_ids', [])
        if not isinstance(refs, list) or any(not isinstance(x, str) or x not in sources for x in refs):
            errors.append(f'{rid}: invalid source references')
        if run.get('status') == 'completed' and not refs:
            errors.append(f'{rid}: completed check has no captured evidence')
        if run.get('status') in {'failed', 'access_blocked'} and not run.get('failure_reason'):
            errors.append(f'{rid}: missing failure reason')

    excluded_ids = bundle.get('excluded_subject_ids', [])
    if not isinstance(excluded_ids, list) or any(not isinstance(x, str) for x in excluded_ids):
        errors.append('excluded_subject_ids must be an array of strings')
        excluded_ids = []
    excluded = set(excluded_ids)
    for cid, claim in claims.items():
        for field in ('text', 'subject_id', 'rationale'):
            if not isinstance(claim.get(field), str) or not claim[field].strip():
                errors.append(f'{cid}: missing {field}')
        if claim.get('subject_id') in excluded:
            errors.append(f'{cid}: excluded subject')
        if claim.get('conclusion') not in CONCLUSIONS or claim.get('decision_effect') not in DECISIONS:
            errors.append(f'{cid}: invalid conclusion or decision effect')
        refs = claim.get('evidence', [])
        if not isinstance(refs, list) or any(not isinstance(x, dict) for x in refs):
            errors.append(f'{cid}: invalid evidence list')
            continue
        for ref in refs:
            if ref.get('source_id') not in sources or not ref.get('locator') or not ref.get('excerpt'):
                errors.append(f'{cid}: evidence needs source, locator and excerpt')
            if ref.get('relation') not in {'supports', 'contradicts', 'context'}:
                errors.append(f'{cid}: evidence relation required')
        required = {'corroborated': 'supports', 'contradicted': 'contradicts'}.get(claim.get('conclusion'))
        if required and not any(x.get('relation') == required for x in refs):
            errors.append(f'{cid}: conclusion lacks matching evidence')
        run_ids = claim.get('execution_ids', [])
        if not isinstance(run_ids, list) or not run_ids or any(not isinstance(x, str) or x not in runs for x in run_ids):
            errors.append(f'{cid}: valid execution references required')
        elif required and not any(runs[x].get('status') == 'completed' for x in run_ids):
            errors.append(f'{cid}: conclusion has no completed execution')
        elif required:
            captured = {sid for rid in run_ids if runs[rid].get('status') == 'completed'
                        for sid in runs[rid].get('source_ids', []) if isinstance(sid, str)}
            if not any(ref.get('relation') == required and ref.get('source_id') in captured for ref in refs):
                errors.append(f'{cid}: evidence not captured by referenced completed execution')
        if claim.get('decision_effect') != 'informational' and not any(a.get('claim_id') == cid for a in actions.values()):
            errors.append(f'{cid}: material gap requires a closure action')

    for aid, action in actions.items():
        if action.get('claim_id') not in claims:
            errors.append(f'{aid}: unknown claim')
        for field in ('owner', 'next_step', 'required_evidence', 'acceptance_condition'):
            if not isinstance(action.get(field), str) or not action[field].strip():
                errors.append(f'{aid}: missing {field}')
        if action.get('status') not in {'open', 'in_progress', 'closed'}:
            errors.append(f'{aid}: invalid action status')
        if action.get('status') == 'closed':
            refs = action.get('closure_source_ids')
            if not isinstance(refs, list) or not refs or any(not isinstance(x, str) or x not in sources for x in refs):
                errors.append(f'{aid}: closure evidence required')
            if not action.get('reviewed_by') or not timestamp(action.get('reviewed_at')):
                errors.append(f'{aid}: closure reviewer and time required')

    review = bundle.get('review', {})
    if not isinstance(review, dict):
        errors.append('review must be an object')
    elif bundle.get('publication_status') == 'reviewed':
        if not review.get('reviewer') or not timestamp(review.get('reviewed_at')) or review.get('revision') != current_revision:
            errors.append('current independent review required')
        if review.get('reviewer') in {r.get('agent') for r in runs.values()}:
            errors.append('reviewer must be separate from investigation agents')
        if review.get('accepted') is not True:
            errors.append('review not accepted')
    elif bundle.get('publication_status') != 'draft':
        errors.append('publication status must be draft or reviewed')
    return errors


def render(bundle):
    """Escaped, standalone HTML. No scripts, remote assets, or auto-fetches."""
    e = lambda value: html.escape(str(value), quote=True)
    sources = {s['id']: s for s in bundle['sources']}
    anchors = {sid: f'source-{i}' for i, sid in enumerate(sources)}
    blocking = [a for a in bundle['actions'] if a['status'] != 'closed' and any(c['id'] == a['claim_id'] and c['decision_effect'] == 'blocking' for c in bundle['claims'])]
    state = 'HOLD: unresolved blocking checks' if blocking else 'Human transaction decision required'
    out = ['<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
           '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">',
           f'<title>{e(bundle["title"])}</title><style>body{{font:17px/1.55 system-ui;max-width:1000px;margin:auto;padding:24px;color:#202020}}h1,h2{{line-height:1.2}}header{{border-bottom:3px solid #b39551}}article{{border:1px solid #ccc;padding:18px;margin:18px 0;break-inside:avoid}}a{{color:#72520b;overflow-wrap:anywhere}}code{{overflow-wrap:anywhere}}.meta{{color:#555}}@media print{{body{{font-size:11pt}}a{{color:inherit}}}}</style><body>',
           f'<header><p>INTEGRITAS · CONFIDENTIAL</p><h1>{e(bundle["title"])}</h1><p>{e(bundle["report_id"])} · revision {bundle["revision"]} · {e(bundle["publication_status"])}</p><strong>{state}</strong></header>',
           '<nav><a href="#claims">Findings</a> · <a href="#actions">Manual actions</a> · <a href="#sources">Evidence</a> · <a href="#runs">Work performed</a></nav><h2 id="claims">Findings</h2>']
    for c in bundle['claims']:
        out.append(f'<article><h3>{e(c["id"])}: {e(c["text"])}</h3><p>{e(c["conclusion"])} · {e(c["decision_effect"])}</p><p>{e(c["rationale"])}</p>')
        for ref in c.get('evidence', []):
            out.append(f'<p><a href="#{anchors[ref["source_id"]]}">{e(ref["source_id"])}</a> · {e(ref["locator"])} · {e(ref["relation"])}<br>{e(ref["excerpt"])}</p>')
        out.append('</article>')
    out.append('<h2 id="actions">Manual actions</h2>')
    for a in bundle['actions']:
        out.append(f'<article><h3>{e(a["id"])} · {e(a["status"])}</h3><p>Owner: {e(a["owner"])}</p><p>{e(a["next_step"])}</p><p>Required evidence: {e(a["required_evidence"])}</p><p>Close only when: {e(a["acceptance_condition"])}</p></article>')
    out.append('<h2 id="sources">Evidence register</h2>')
    for s in sources.values():
        out.append(f'<article id="{anchors[s["id"]]}"><h3>{e(s["id"])}: {e(s["title"])}</h3><p>{e(s["authority"])} · origin {e(s["origin_id"])}</p><p>Retrieved {e(s["retrieved_at"])} · effective {e(s.get("effective_at") or "unknown")}</p>')
        if safe_url(s.get('url')):
            out.append(f'<a rel="noreferrer noopener" href="{e(s["url"])}">Open original source</a>')
        out.append(f'<p>Archived file: {e(s["artifact"])}</p><p>SHA-256: <code>{e(s["sha256"])}</code></p></article>')
    out.append('<h2 id="runs">Work performed</h2>')
    for r in bundle['executions']:
        out.append(f'<article><h3>{e(r["id"])} · {e(r["status"])}</h3><p>{e(r["agent"])} · {e(r["tool"])}</p><p>{e(r["input_summary"])}</p><p>{e(r["started_at"])} to {e(r.get("ended_at", "pending"))}</p><p>{e(r.get("failure_reason", ""))}</p></article>')
    out.append('<p>Structural validation does not authenticate a transaction. Source interpretation and the final decision require human review.</p></body></html>')
    return '\n'.join(out)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bundle', type=Path)
    parser.add_argument('--evidence-root', type=Path, required=True)
    parser.add_argument('--current-revision', type=int, required=True)
    parser.add_argument('--html', type=Path)
    args = parser.parse_args()
    bundle = json.loads(args.bundle.read_text())
    errors = validate(bundle, args.evidence_root, args.current_revision)
    print(json.dumps({'valid': not errors, 'errors': errors}))
    if errors:
        raise SystemExit(1)
    if args.html:
        args.html.write_text(render(bundle), encoding='utf-8')


if __name__ == '__main__':
    main()
