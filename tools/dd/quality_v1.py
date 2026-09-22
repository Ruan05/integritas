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

MAXIMUM_REPORT_LANES = [
    ('investigation completion', r'investigation\s+completion|completion\s+statement'),
    ('intake context', r'intake\s+(context|message)|translation|evidentiary\s+test'),
    ('executive summary', r'executive\s+summary|executive\s+decision'),
    ('current diligence status', r'current\s+(diligence|transaction)\s+status|immediate\s+decision|current\s+decision'),
    ('evidence package', r'evidence\s+(package|register).*review|evidence\s+package|evidence\s+register'),
    ('document forensics', r'document[-\s]+forensics|forensic\s+document'),
    ('corporate identity', r'corporate\s+(identity|legal)|legal\s+identity|company\s+identity'),
    ('people and relationships', r'ownership.*people|people.*relationship|beneficial\s+ownership|relationship\s+intelligence'),
    ('physical and digital footprint', r'address.*physical|physical\s+presence|domain.*website|website.*email|digital\s+footprint'),
    ('banking review', r'banking|bank\s+review|financial\s+counterparty'),
    ('product capability logistics', r'product.*logistics|asset.*capability|commercial\s+capacity|delivery\s+capacity'),
    ('pricing and economics', r'pricing|price\s+context|economics|market\s+context'),
    ('transaction and trade finance', r'transaction.*procedure|trade[-\s]+finance|contract.*review|transaction[-\s]+risk'),
    ('screening', r'sanctions.*adverse|sanctions.*pep|regulatory.*adverse|enforcement.*litigation'),
    ('fraud pattern indicators', r'fraud[-/\s]+pattern|scam.*indicator|misrepresentation.*indicator'),
    ('positive indicators', r'positive.*indicator|risk[-\s]+reducing'),
    ('risk matrix', r'risk\s+matrix|risk\s+composition'),
    ('mandatory verification gates', r'mandatory\s+verification\s+gates|critical\s+gates|required\s+edd.*release'),
    ('plain english next steps', r'plain[-\s]+english\s+next\s+steps|next\s+steps|recommended\s+order\s+of\s+work'),
    ('source ledger', r'source\s+ledger|sources\s+and\s+verification|sources\s+and\s+final'),
    ('unresolved checks and limitations', r'contradictions.*unresolved|unresolved\s+checks|limitations'),
    ('conclusion', r'final\s+conclusion|draft\s+conclusion|final\s+assessment'),
]
MAXIMUM_REPORT_FEATURES = [
    ('master issue dashboard', r'master\s+(issue|summary)|issue\s+dashboard|decision\s+dashboard'),
    ('subject status matrix', r'subject\s+status\s+matrix|person-by-person|entity-by-entity|clearance\s+heatmap|subject\s+matrix'),
    ('comprehensive subject dossiers', r'comprehensive\s+(profile|subject|entity).*dossier|person\s+profile|entity\s+profile'),
    ('relationship evidence network', r'relationship.*(network|map)|evidence\s+network|relationship\s+intelligence\s+summary'),
    ('digital or commercial timeline', r'(digital|commercial|entity).*timeline|chronology'),
    ('claim-to-evidence matrix', r'claim-to-evidence|claim\s+to\s+evidence'),
    ('research coverage statement', r'research[-\s]+lane\s+coverage|research\s+coverage|coverage\s+statement'),
    ('false-positive controls', r'false[-\s]+positive|namesake|disambiguation'),
    ('closure register', r'closure\s+register|mandatory\s+verification\s+gates|required\s+edd.*release'),
]
MAXIMUM_REPORT_MIN_CHARS = 8000


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
    submitted_ids = set()
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
        origin = row.get('evidence_origin')
        if origin not in {'submitted_document', 'external_research'}:
            errors.append(f'source {key}: invalid evidence_origin')
        elif origin == 'submitted_document':
            if row.get('source_type') != 'document':
                errors.append(f'source {key}: submitted document must use source_type document')
            if not isinstance(document_id, str) or document_id not in document_ids:
                errors.append(f'source {key}: submitted document requires manifest document_id')
            else:
                submitted_ids.add(document_id)
        elif origin == 'external_research':
            if document_id is not None:
                errors.append(f'source {key}: external research cannot use document_id')
            if not isinstance(row.get('url'), str) or not safe_https_url(row.get('url')):
                errors.append(f'source {key}: external research requires public HTTPS URL')
        if not timestamp(row.get('retrieved_at')):
            errors.append(f'source {key}: invalid retrieved_at')
    missing_documents = sorted(document_ids - submitted_ids)
    if missing_documents:
        errors.append('sources: every manifest document must be represented as submitted_document evidence: ' + ','.join(missing_documents))
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
def validate_forensics(bundle, manifest, forensics, errors):
    if forensics is None:
        if bundle.get('depth') == 'maximum':
            errors.append('forensics: maximum-depth investigation requires trusted forensic pre-pass')
        return {'documents': 0}
    if not isinstance(forensics, dict) or forensics.get('schema_version') != 1 or forensics.get('tool') != 'integritas_forensics_v1':
        errors.append('forensics: invalid trusted forensic result')
        return {'documents': 0}
    reports = forensics.get('reports')
    if not isinstance(reports, list):
        errors.append('forensics: reports must be an array')
        return {'documents': 0}
    manifest_docs = {
        row.get('id'): row for row in manifest.get('documents', [])
        if isinstance(row, dict) and isinstance(row.get('id'), str)
    }
    seen = set()
    for index, row in enumerate(reports):
        if not isinstance(row, dict):
            errors.append(f'forensics report {index}: invalid')
            continue
        document_id = row.get('document_id')
        expected = manifest_docs.get(document_id)
        if expected is None:
            errors.append(f'forensics report {index}: unknown document_id')
            continue
        if document_id in seen:
            errors.append(f'forensics report {index}: duplicate document_id')
        seen.add(document_id)
        if row.get('sha256') != expected.get('sha256'):
            errors.append(f'forensics report {index}: sha256 mismatch')
        if row.get('size_bytes') != expected.get('size_bytes'):
            errors.append(f'forensics report {index}: size mismatch')
        if row.get('original_name') != expected.get('name'):
            errors.append(f'forensics report {index}: original name mismatch')
        if row.get('kind') == 'pdf':
            pdf = row.get('pdf')
            if not isinstance(pdf, dict) or not isinstance(pdf.get('cryptographic_signature_present'), bool):
                errors.append(f'forensics report {index}: invalid PDF forensic metadata')
    missing = sorted(set(manifest_docs) - seen)
    if missing:
        errors.append('forensics: every manifest document must be audited: ' + ','.join(missing))
    return {'documents': len(seen)}


def validate_report_front_matter(report_text, errors):
    master = re.search(
        r'(?im)^#{1,6}\s*MASTER\s+(?:ISSUE\s+)?SUMMARY(?:\s*[—-]\s*READ\s+THIS\s+FIRST)?\s*$',
        report_text,
    )
    next_steps = re.search(
        r'(?im)^#{1,6}\s*DIRECT\s+NEXT\s+STEPS(?:\s*[—-]\s*WHAT\s+TO\s+DO\s+NOW)?\s*$',
        report_text,
    )
    valid = True
    if master is None:
        errors.append('report: MASTER SUMMARY must be the first substantive section')
        valid = False
    elif master.start() > 1500:
        errors.append('report: MASTER SUMMARY must appear at the start of the report')
        valid = False
    if next_steps is None:
        errors.append('report: DIRECT NEXT STEPS must immediately follow MASTER SUMMARY')
        valid = False
    elif master is not None:
        if next_steps.start() <= master.end():
            errors.append('report: DIRECT NEXT STEPS must follow MASTER SUMMARY')
            valid = False
        between = report_text[master.end():next_steps.start()]
        intervening_heading = re.search(r'(?m)^#{1,6}\s+\S', between)
        if intervening_heading:
            errors.append('report: no detailed report section may appear between MASTER SUMMARY and DIRECT NEXT STEPS')
            valid = False
        if len(between) > 7000:
            errors.append('report: DIRECT NEXT STEPS is too far from MASTER SUMMARY')
            valid = False
    return {
        'valid': valid,
        'master_summary_present': master is not None,
        'direct_next_steps_present': next_steps is not None,
    }


def evidence_proportional_no_evidence(bundle):
    checks = bundle.get('checks') if isinstance(bundle.get('checks'), list) else []
    execution = bundle.get('execution') if isinstance(bundle.get('execution'), dict) else {}
    tools = execution.get('tool_results') if isinstance(execution.get('tool_results'), list) else []
    sources = bundle.get('sources') if isinstance(bundle.get('sources'), list) else []
    marker_check = any(
        isinstance(row, dict)
        and row.get('check_key') == 'workload.no_investigable_evidence'
        and row.get('status') == 'complete'
        for row in checks
    )
    marker_tool = any(
        isinstance(row, dict)
        and row.get('tool') == 'integritas_workload_classifier_v1'
        and row.get('status') == 'completed'
        for row in tools
    )
    empty_material_records = all(
        isinstance(bundle.get(key), list) and len(bundle.get(key)) == 0
        for key in ('entities', 'relationships', 'findings', 'contradictions', 'unresolved_checks')
    )
    no_external_research = all(
        isinstance(row, dict) and row.get('evidence_origin') == 'submitted_document'
        for row in sources
    )
    return marker_check and marker_tool and empty_material_records and no_external_research


def validate_maximum_report(bundle, report_text, errors):
    if bundle.get('depth') != 'maximum' or evidence_proportional_no_evidence(bundle):
        return {'required_lanes': 0, 'missing_lanes': [], 'missing_features': []}
    if len(report_text) < MAXIMUM_REPORT_MIN_CHARS:
        errors.append(
            f'report: maximum-depth Prototype 1 report is too short '
            f'({len(report_text)} chars; minimum {MAXIMUM_REPORT_MIN_CHARS})'
        )
    missing_lanes = [
        label for label, pattern in MAXIMUM_REPORT_LANES
        if not re.search(pattern, report_text, flags=re.I | re.S)
    ]
    missing_features = [
        label for label, pattern in MAXIMUM_REPORT_FEATURES
        if not re.search(pattern, report_text, flags=re.I | re.S)
    ]
    if missing_lanes:
        errors.append(
            'report: maximum-depth Prototype 1 lanes missing: ' + ', '.join(missing_lanes)
        )
    if missing_features:
        errors.append(
            'report: maximum-depth Prototype 1 features missing: ' + ', '.join(missing_features)
        )
    return {
        'required_lanes': len(MAXIMUM_REPORT_LANES),
        'missing_lanes': missing_lanes,
        'missing_features': missing_features,
    }


def normalized_paragraphs(report_text):
    rows = []
    for chunk in re.split(r'\n\s*\n+', report_text):
        value = re.sub(r'[`*_#>|\[\]()]+', ' ', chunk)
        value = re.sub(r'\s+', ' ', value).strip().lower()
        if len(value) >= 90 and not value.startswith('|'):
            rows.append(value)
    return rows


def validate_semantic_maximum(bundle, manifest, report_text, errors, plan=None, agent_exec=None):
    if bundle.get('depth') != 'maximum' or evidence_proportional_no_evidence(bundle):
        return {
            'research_lanes': 0, 'external_sources': 0, 'source_anchor_ratio': 1.0,
            'duplicate_paragraph_ratio': 0.0, 'pdf_tool_observed': True,
        }
    sources = bundle.get('sources') if isinstance(bundle.get('sources'), list) else []
    findings = bundle.get('findings') if isinstance(bundle.get('findings'), list) else []
    checks = bundle.get('checks') if isinstance(bundle.get('checks'), list) else []
    external = [row for row in sources if isinstance(row, dict) and row.get('evidence_origin') == 'external_research']
    submitted = [row for row in sources if isinstance(row, dict) and row.get('evidence_origin') == 'submitted_document']
    outcome = (bundle.get('execution') or {}).get('terminal_outcome') if isinstance(bundle.get('execution'), dict) else None

    # A Maximum investigation must never collapse into a single generic research lane.
    lanes = plan.get('research_lanes', []) if isinstance(plan, dict) and isinstance(plan.get('research_lanes'), list) else []
    if plan is not None and len(lanes) < 3:
        errors.append('semantic QA: maximum substantive investigation requires at least three evidence-driven research lanes')
    if lanes:
        check_keys = {row.get('check_key') for row in checks if isinstance(row, dict)}
        missing_lane_checks = [row.get('lane_id') for row in lanes if isinstance(row, dict) and f"lane.{row.get('lane_id')}" not in check_keys]
        if missing_lane_checks:
            errors.append('semantic QA: research lanes missing persisted checks: ' + ','.join(str(x) for x in missing_lane_checks[:12]))

    # Every PDF must have crossed the real PDF tool path. This prevents metadata/filename-only summaries.
    pdf_docs = [row for row in manifest.get('documents', []) if isinstance(row, dict) and (
        row.get('mime_type') == 'application/pdf' or str(row.get('name', '')).lower().endswith('.pdf')
    )]
    observed_tools = set()
    if isinstance(agent_exec, dict):
        summary = agent_exec.get('toolSummary') if isinstance(agent_exec.get('toolSummary'), dict) else {}
        observed_tools.update(x for x in summary.get('tools', []) if isinstance(x, str))
    pdf_tool_observed = agent_exec is None or not pdf_docs or 'pdf' in observed_tools
    if not pdf_tool_observed:
        errors.append('semantic QA: maximum PDF evidence was not substantively inspected with the OpenClaw pdf tool')
    submitted_by_document = {
        row.get('document_id'): row for row in submitted
        if isinstance(row, dict) and isinstance(row.get('document_id'), str)
    }
    missing_page_provenance = [
        row.get('id') for row in pdf_docs
        if not isinstance(submitted_by_document.get(row.get('id'), {}).get('page_reference'), str)
        or not submitted_by_document.get(row.get('id'), {}).get('page_reference', '').strip()
    ]
    if missing_page_provenance:
        errors.append('semantic QA: maximum PDF evidence lacks page-level source provenance: ' + ','.join(str(x) for x in missing_page_provenance[:12]))

    # Role/scope are required so contextual client/buyer parties are not silently adverse-scored.
    entities = bundle.get('entities') if isinstance(bundle.get('entities'), list) else []
    missing_roles = []
    for row in entities:
        if not isinstance(row, dict):
            continue
        identifiers = row.get('identifiers') if isinstance(row.get('identifiers'), dict) else {}
        if identifiers.get('role') not in {
            'client', 'buyer', 'buyer_client', 'seller', 'representative', 'intermediary', 'bank',
            'terminal', 'logistics', 'vessel_owner', 'related_party', 'counterparty', 'unknown'
        } or identifiers.get('subject_scope') not in {'in_scope', 'context_only', 'unknown'}:
            missing_roles.append(str(row.get('entity_key', 'unknown')))
    if missing_roles:
        errors.append('semantic QA: maximum-depth entities require explicit identifiers.role and identifiers.subject_scope: ' + ','.join(missing_roles[:12]))

    # A completed external due-diligence case needs independent public-source evidence.
    if outcome == 'completed':
        if len(external) < 2:
            errors.append('semantic QA: completed maximum investigation requires at least two validated external research sources')
        if external and not any(row.get('source_type') in {'official', 'primary'} for row in external):
            errors.append('semantic QA: completed maximum investigation lacks an official/primary external source')
    elif len(external) == 0 and not re.search(r'\bincomplete\b|research\s+(?:was\s+)?(?:blocked|unavailable)|no validated external', report_text, flags=re.I):
        errors.append('semantic QA: zero-external-source maximum report must be explicitly labelled incomplete/blocked')

    # Comprehensive reports must visibly anchor their analysis to the canonical source ledger.
    source_keys = [row.get('source_key') for row in sources if isinstance(row, dict) and isinstance(row.get('source_key'), str)]
    mentioned = [key for key in source_keys if key in report_text]
    required_anchor_count = min(len(source_keys), max(1, min(5, len(submitted) + len(external)))) if source_keys else 0
    if required_anchor_count and len(mentioned) < required_anchor_count:
        errors.append(
            f'semantic QA: report cites only {len(mentioned)} canonical source key(s); at least {required_anchor_count} are required for maximum-depth provenance'
        )

    # Findings should be evidence-linked instead of becoming free-standing narrative assertions.
    linked_findings = [row for row in findings if isinstance(row, dict) and isinstance(row.get('source_keys'), list) and row.get('source_keys')]
    if findings and len(linked_findings) / len(findings) < 0.6:
        errors.append('semantic QA: fewer than 60% of findings are linked to canonical sources')

    # Reject length-padding/repeated boilerplate even when all headings are present.
    paragraphs = normalized_paragraphs(report_text)
    duplicate_ratio = 0.0
    if paragraphs:
        duplicate_ratio = (len(paragraphs) - len(set(paragraphs))) / len(paragraphs)
        if duplicate_ratio > 0.12:
            errors.append(f'semantic QA: repeated boilerplate ratio is too high ({duplicate_ratio:.2f})')

    # A provider-availability critic cannot certify a completed comprehensive case.
    if outcome == 'completed' and isinstance(agent_exec, dict):
        phases = agent_exec.get('phases') if isinstance(agent_exec.get('phases'), list) else []
        critic = next((row for row in phases if isinstance(row, dict) and row.get('phase') == 'large-critic'), None)
        if critic and str(critic.get('model', '')).startswith('deterministic-review-gate'):
            errors.append('semantic QA: completed maximum report requires a real independent critic, not deterministic provider fallback')

    return {
        'research_lanes': len(lanes),
        'external_sources': len(external),
        'source_anchor_ratio': (len(mentioned) / len(source_keys)) if source_keys else 1.0,
        'duplicate_paragraph_ratio': round(duplicate_ratio, 4),
        'pdf_tool_observed': pdf_tool_observed,
    }

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
    if bundle.get('depth') == 'maximum' and not any(
        isinstance(row, dict)
        and row.get('tool') == 'integritas_forensics_v1'
        and row.get('status') == 'completed'
        for row in tools
    ):
        errors.append('execution: maximum-depth investigation must record completed integritas_forensics_v1')


def validate(bundle, manifest, report_text, current_revision, forensics=None, plan=None, agent_exec=None):
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
    forensics_summary = validate_forensics(bundle, manifest, forensics, errors)
    front_matter = validate_report_front_matter(report_text, errors)
    prototype1 = validate_maximum_report(bundle, report_text, errors)
    semantic = validate_semantic_maximum(bundle, manifest, report_text, errors, plan=plan, agent_exec=agent_exec)
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
        'prototype1_required_lanes': prototype1.get('required_lanes', 0),
        'prototype1_missing_lanes': prototype1.get('missing_lanes', []),
        'prototype1_missing_features': prototype1.get('missing_features', []),
        'forensic_documents': forensics_summary.get('documents', 0),
        'front_matter_valid': front_matter.get('valid', False),
        'semantic_quality': semantic,
    }
    return errors, summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bundle', type=Path)
    parser.add_argument('report_pos', nargs='?', type=Path)
    parser.add_argument('manifest_pos', nargs='?', type=Path)
    parser.add_argument('--manifest', dest='manifest_opt', type=Path)
    parser.add_argument('--report', dest='report_opt', type=Path)
    parser.add_argument('--forensics', type=Path)
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
        forensics = json.loads(args.forensics.read_text(encoding='utf-8')) if args.forensics else None
        sibling = args.bundle.parent
        plan_path = sibling / 'investigation-plan.json'
        exec_path = sibling / 'agent-exec.json'
        plan = json.loads(plan_path.read_text(encoding='utf-8')) if plan_path.exists() else None
        agent_exec = json.loads(exec_path.read_text(encoding='utf-8')) if exec_path.exists() else None
        revision = args.current_revision if args.current_revision is not None else manifest.get('case_revision')
        errors, summary = validate(bundle, manifest, report_text, revision, forensics, plan=plan, agent_exec=agent_exec)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        errors, summary = [f'input: {type(exc).__name__}'], {}
    print(json.dumps({'valid': not errors, 'errors': errors, 'summary': summary}, sort_keys=True))
    raise SystemExit(1 if errors else 0)


if __name__ == '__main__':
    main()

[executed on device: integritas-openclaw-a1 (9d9982e8-9052-45b2-b91d-0faeaae0cc0d)]