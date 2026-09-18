"""Deterministic offline QA for Integritas investigation bundle schema v1."""
import argparse
import json
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', re.I)
KEY = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
SHA_SIGNED_PATH = '/storage/v1/object/sign/'
FORBIDDEN_KEYS = {
    'password', 'secret', 'token', 'api_key', 'authorization', 'shell',
    'command', 'cmd', 'env', 'sudo', 'docker_socket', 'executable', 'script',
}
TOP_LEVEL = {
    'schema_version', 'case_id', 'case_job_id', 'case_revision', 'depth',
    'generated_at', 'entities', 'relationships', 'sources', 'findings',
    'checks', 'contradictions', 'unresolved_checks', 'limitations', 'report',
    'execution',
}


def timestamp(value):
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return parsed if parsed.tzinfo is not None else None
    except (TypeError, ValueError):
        return None
def safe_https_url(value):
    if value is None:
        return True
    try:
        parsed = urlsplit(value)
        return parsed.scheme == 'https' and bool(parsed.hostname) and not parsed.username and not parsed.password
    except (TypeError, ValueError):
        return False


def walk_forbidden(value, path='bundle', errors=None):
    errors = errors if errors is not None else []
    if isinstance(value, list):
        for index, child in enumerate(value):
            walk_forbidden(child, f'{path}[{index}]', errors)
    elif isinstance(value, dict):
        for key, child in value.items():
            if key.lower() in FORBIDDEN_KEYS:
                errors.append(f'forbidden field: {path}.{key}')
            walk_forbidden(child, f'{path}.{key}', errors)
    return errors


def exact_fields(row, fields, label, errors):
    if not isinstance(row, dict):
        errors.append(f'{label}: must be an object')
        return False
    unknown = set(row) - set(fields)
    if unknown:
        errors.append(f'{label}: unknown fields: {",".join(sorted(unknown))}')
    return True


def keyed(rows, key_name, label, errors):
    result = {}
    if not isinstance(rows, list):
        errors.append(f'{label}: must be an array')
        return result
    for row in rows:
        if not isinstance(row, dict):
            errors.append(f'{label}: row must be an object')
            continue
        key = row.get(key_name)
        if not isinstance(key, str) or not KEY.fullmatch(key):
            errors.append(f'{label}: invalid {key_name}')
        elif key in result:
            errors.append(f'{label}: duplicate {key_name} {key}')
        else:
            result[key] = row
    return result
def require_string(value, label, errors, maximum=12000, allow_empty=False):
    if not isinstance(value, str) or len(value) > maximum or (not allow_empty and not value):
        errors.append(f'{label}: invalid string')


def validate_identity(bundle, manifest, current_revision, report_text, errors):
    if bundle.get('schema_version') != 1:
        errors.append('schema_version: unsupported')
    for field in ('case_id', 'case_job_id'):
        if not isinstance(bundle.get(field), str) or not UUID.fullmatch(bundle[field]):
            errors.append(f'{field}: invalid UUID')
        if bundle.get(field) != manifest.get(field):
            errors.append(f'{field}: manifest mismatch')
    if bundle.get('case_revision') != current_revision or bundle.get('case_revision') != manifest.get('case_revision'):
        errors.append('case_revision: stale or manifest mismatch')
    if bundle.get('depth') not in {'fast', 'standard', 'deep', 'maximum'} or bundle.get('depth') != manifest.get('depth'):
        errors.append('depth: invalid or manifest mismatch')
    if not timestamp(bundle.get('generated_at')):
        errors.append('generated_at: timezone-aware timestamp required')
    report = bundle.get('report')
    if not isinstance(report, dict):
        errors.append('report: must be an object')
    else:
        exact_fields(report, {'summary', 'markdown', 'status'}, 'report', errors)
        if report.get('status') != 'draft':
            errors.append('report: status must be draft')
        if report.get('markdown') != report_text:
            errors.append('report markdown mismatch')
        require_string(report.get('summary'), 'report.summary', errors, allow_empty=True)
        require_string(report.get('markdown'), 'report.markdown', errors, maximum=5 * 1024 * 1024)


def validate_entities(bundle, errors):
    fields = {'entity_key', 'entity_type', 'display_name', 'aliases', 'identifiers', 'match_status', 'confidence'}
    entities = keyed(bundle.get('entities'), 'entity_key', 'entities', errors)
    for key, row in entities.items():
        exact_fields(row, fields, f'entity {key}', errors)
        if row.get('entity_type') not in {'person', 'company', 'organization', 'bank', 'vessel', 'other'}:
            errors.append(f'entity {key}: invalid entity_type')
        require_string(row.get('display_name'), f'entity {key}.display_name', errors, 240)
        aliases = row.get('aliases')
        if not isinstance(aliases, list) or len(aliases) > 100 or any(not isinstance(x, str) or len(x) > 240 for x in aliases):
            errors.append(f'entity {key}: invalid aliases')
        identifiers = row.get('identifiers')
        if not isinstance(identifiers, dict) or len(identifiers) > 100:
            errors.append(f'entity {key}: invalid identifiers')
        if row.get('match_status') not in {'proposed', 'probable', 'verified', 'conflicting', 'rejected'}:
            errors.append(f'entity {key}: invalid match_status')
        confidence = row.get('confidence')
        if not isinstance(confidence, (int, float)) or isinstance(confidence, bool) or not 0 <= confidence <= 100:
            errors.append(f'entity {key}: invalid confidence')
    return entities


def validate_sources(bundle, manifest, errors):
    fields = {'source_key', 'source_type', 'title', 'url', 'document_id', 'page_reference', 'excerpt', 'reliability_note', 'evidence_origin', 'retrieved_at'}
    sources = keyed(bundle.get('sources'), 'source_key', 'sources', errors)
    document_ids = {row.get('id') for row in manifest.get('documents', []) if isinstance(row, dict)}
    for key, row in sources.items():
        exact_fields(row, fields, f'source {key}', errors)
        if row.get('source_type') not in {'document', 'official', 'primary', 'secondary', 'other'}:
            errors.append(f'source {key}: invalid source_type')
        require_string(row.get('title'), f'source {key}.title', errors, 500)
        if not safe_https_url(row.get('url')):
            errors.append(f'source {key}: invalid URL')
        document_id = row.get('document_id')
        if document_id is not None and (not isinstance(document_id, str) or not UUID.fullmatch(document_id) or document_id not in document_ids):
            errors.append(f'source {key}: document_id is not in manifest')
        excerpt = row.get('excerpt')
        if not isinstance(excerpt, str) or len(excerpt) > 8000:
            errors.append(f'source {key}: invalid excerpt')
        if row.get('evidence_origin') not in {'submitted_document', 'external_research'}:
            errors.append(f'source {key}: invalid evidence_origin')
        if not timestamp(row.get('retrieved_at')):
            errors.append(f'source {key}: invalid retrieved_at')
    return sources
def validate_findings(bundle, entities, sources, errors):
    fields = {'finding_key', 'entity_key', 'finding_type', 'claim', 'evidence_status', 'materiality', 'reliability', 'evidence_excerpt', 'source_keys'}
    findings = keyed(bundle.get('findings'), 'finding_key', 'findings', errors)
    for key, row in findings.items():
        exact_fields(row, fields, f'finding {key}', errors)
        entity_key = row.get('entity_key')
        if entity_key is not None and entity_key not in entities:
            errors.append(f'finding {key}: unknown entity_key')
        require_string(row.get('finding_type'), f'finding {key}.finding_type', errors, 160)
        require_string(row.get('claim'), f'finding {key}.claim', errors)
        if row.get('evidence_status') not in {'verified', 'alleged', 'conflicting', 'uncertain'}:
            errors.append(f'finding {key}: invalid evidence_status')
        if row.get('materiality') not in {'informational', 'low', 'medium', 'high', 'critical'}:
            errors.append(f'finding {key}: invalid materiality')
        if row.get('reliability') not in {'high', 'medium', 'low', 'unknown'}:
            errors.append(f'finding {key}: invalid reliability')
        refs = row.get('source_keys')
        if not isinstance(refs, list) or len(refs) > 100 or any(ref not in sources for ref in refs):
            errors.append(f'finding {key}: invalid source_keys')
        elif row.get('evidence_status') == 'verified' and not refs:
            errors.append(f'finding {key}: verified finding requires a source')
        excerpt = row.get('evidence_excerpt')
        if not isinstance(excerpt, str) or len(excerpt) > 8000:
            errors.append(f'finding {key}: invalid evidence_excerpt')
    return findings


def validate_relationships(bundle, entities, sources, errors):
    fields = {'relationship_key', 'from_entity_key', 'to_entity_key', 'relationship_type', 'claim', 'evidence_status', 'source_keys', 'confidence'}
    rows = keyed(bundle.get('relationships'), 'relationship_key', 'relationships', errors)
    for key, row in rows.items():
        exact_fields(row, fields, f'relationship {key}', errors)
        if row.get('from_entity_key') not in entities or row.get('to_entity_key') not in entities:
            errors.append(f'relationship {key}: unknown entity reference')
        require_string(row.get('relationship_type'), f'relationship {key}.relationship_type', errors, 160)
        if row.get('evidence_status') not in {'verified', 'alleged', 'conflicting', 'uncertain'}:
            errors.append(f'relationship {key}: invalid evidence_status')
        refs = row.get('source_keys')
        if not isinstance(refs, list) or any(ref not in sources for ref in refs):
            errors.append(f'relationship {key}: invalid source_keys')
        confidence = row.get('confidence')
        if not isinstance(confidence, (int, float)) or isinstance(confidence, bool) or not 0 <= confidence <= 100:
            errors.append(f'relationship {key}: invalid confidence')
    return rows


def validate_checks(bundle, entities, errors):
    fields = {'check_key', 'entity_key', 'check_type', 'description', 'priority', 'required_source', 'status', 'outcome'}
    rows = keyed(bundle.get('checks'), 'check_key', 'checks', errors)
    for key, row in rows.items():
        exact_fields(row, fields, f'check {key}', errors)
        if row.get('entity_key') is not None and row.get('entity_key') not in entities:
            errors.append(f'check {key}: unknown entity_key')
        require_string(row.get('check_type'), f'check {key}.check_type', errors, 160)
        require_string(row.get('description'), f'check {key}.description', errors)
        if row.get('priority') not in {'low', 'medium', 'high', 'critical'}:
            errors.append(f'check {key}: invalid priority')
        if row.get('status') not in {'open', 'in_progress', 'complete', 'blocked'}:
            errors.append(f'check {key}: invalid status')
    return rows


def validate_cross_records(bundle, findings, errors):
    contradictions = keyed(bundle.get('contradictions'), 'contradiction_key', 'contradictions', errors)
    for key, row in contradictions.items():
        exact_fields(row, {'contradiction_key', 'finding_keys', 'description'}, f'contradiction {key}', errors)
        refs = row.get('finding_keys')
        if not isinstance(refs, list) or len(refs) < 2 or any(ref not in findings for ref in refs):
            errors.append(f'contradiction {key}: requires at least two known findings')
        require_string(row.get('description'), f'contradiction {key}.description', errors)
    unresolved = keyed(bundle.get('unresolved_checks'), 'unresolved_key', 'unresolved_checks', errors)
    fields = {'unresolved_key', 'description', 'reason', 'attempted_methods', 'blocker', 'next_manual_action'}
    for key, row in unresolved.items():
        exact_fields(row, fields, f'unresolved {key}', errors)
        require_string(row.get('description'), f'unresolved {key}.description', errors)
        require_string(row.get('reason'), f'unresolved {key}.reason', errors, 4000)
        methods = row.get('attempted_methods')
        if not isinstance(methods, list) or len(methods) > 100 or any(not isinstance(x, str) or len(x) > 2000 for x in methods):
            errors.append(f'unresolved {key}: invalid attempted_methods')
def validate_execution(bundle, errors):
    execution = bundle.get('execution')
    if not isinstance(execution, dict):
        errors.append('execution: must be an object')
        return
    fields = {'started_at', 'completed_at', 'stages', 'tool_results', 'warnings', 'terminal_outcome'}
    exact_fields(execution, fields, 'execution', errors)
    start, end = timestamp(execution.get('started_at')), timestamp(execution.get('completed_at'))
    if not start or not end or (start and end and end < start):
        errors.append('execution: invalid timestamps')
    outcome = execution.get('terminal_outcome')
    if outcome not in {'completed', 'incomplete', 'research_limit_reached'}:
        errors.append('execution: invalid terminal_outcome')
    stages = execution.get('stages')
    if not isinstance(stages, list) or len(stages) > 32 or any(not isinstance(x, str) or len(x) > 80 for x in stages):
        errors.append('execution: invalid stages')
    warnings = execution.get('warnings')
    if not isinstance(warnings, list) or len(warnings) > 100 or any(not isinstance(x, str) or len(x) > 4000 for x in warnings):
        errors.append('execution: invalid warnings')
    tools = execution.get('tool_results')
    if not isinstance(tools, list) or len(tools) > 200:
        errors.append('execution: invalid tool_results')
        return
    for index, row in enumerate(tools):
        if not exact_fields(row, {'tool', 'status', 'summary'}, f'tool_result {index}', errors):
            continue
        require_string(row.get('tool'), f'tool_result {index}.tool', errors, 160)
        if row.get('status') not in {'completed', 'failed', 'unavailable', 'skipped'}:
            errors.append(f'tool_result {index}: invalid status')
        require_string(row.get('summary'), f'tool_result {index}.summary', errors, 4000, allow_empty=True)


def validate(bundle, manifest, report_text, current_revision):
    errors = []
    if not isinstance(bundle, dict):
        return ['bundle: must be an object'], {}
    unknown = set(bundle) - TOP_LEVEL
    if unknown:
        errors.append(f'bundle: unknown fields: {",".join(sorted(unknown))}')
    encoded = json.dumps(bundle, sort_keys=True, separators=(',', ':'))
    if SHA_SIGNED_PATH in encoded:
        errors.append('bundle: signed URL leakage detected')
    walk_forbidden(bundle, errors=errors)
    validate_identity(bundle, manifest, current_revision, report_text, errors)
    entities = validate_entities(bundle, errors)
    sources = validate_sources(bundle, manifest, errors)
    findings = validate_findings(bundle, entities, sources, errors)
    relationships = validate_relationships(bundle, entities, sources, errors)
    checks = validate_checks(bundle, entities, errors)
    validate_cross_records(bundle, findings, errors)
    limitations = bundle.get('limitations')
    if not isinstance(limitations, list) or len(limitations) > 100 or any(not isinstance(x, str) or len(x) > 4000 for x in limitations):
        errors.append('limitations: invalid')
    validate_execution(bundle, errors)
    execution = bundle.get('execution') if isinstance(bundle.get('execution'), dict) else {}
    if execution.get('terminal_outcome') == 'completed':
        unresolved = bundle.get('unresolved_checks') if isinstance(bundle.get('unresolved_checks'), list) else []
        if unresolved:
            errors.append('completed outcome cannot retain unresolved checks')
        if any(row.get('status') != 'complete' for row in checks.values()):
            errors.append('completed outcome cannot retain incomplete checks')
    summary = {
        'entities': len(entities),
        'relationships': len(relationships),
        'sources': len(sources),
        'findings': len(findings),
        'checks': len(checks),
        'contradictions': len(bundle.get('contradictions', [])) if isinstance(bundle.get('contradictions'), list) else 0,
        'unresolved_checks': len(bundle.get('unresolved_checks', [])) if isinstance(bundle.get('unresolved_checks'), list) else 0,
    }
    return errors, summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bundle', type=Path)
    parser.add_argument('report_pos', nargs='?', type=Path)
    parser.add_argument('manifest_pos', nargs='?', type=Path)
    parser.add_argument('--manifest', dest='manifest_opt', type=Path)
    parser.add_argument('--report', dest='report_opt', type=Path)
    parser.add_argument('--current-revision', type=int)
    args = parser.parse_args()
    manifest_path = args.manifest_opt or args.manifest_pos
    report_path = args.report_opt or args.report_pos
    if manifest_path is None or report_path is None:
        parser.error('manifest and report are required')
    try:
        bundle = json.loads(args.bundle.read_text(encoding='utf-8'))
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        report_text = report_path.read_text(encoding='utf-8')
        revision = args.current_revision if args.current_revision is not None else manifest.get('case_revision')
        errors, summary = validate(bundle, manifest, report_text, revision)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        errors, summary = [f'input: {type(exc).__name__}'], {}
    print(json.dumps({'valid': not errors, 'errors': errors, 'summary': summary}, sort_keys=True))
    raise SystemExit(1 if errors else 0)


if __name__ == '__main__':
    main()
