export const CASE_INVESTIGATION_DEPTHS = new Set(['fast', 'standard', 'deep', 'maximum']);

export const CASE_INVESTIGATION_STAGES = new Set([
  'queued', 'extracting', 'analyzing_documents', 'mapping_entities', 'planning_research',
  'researching', 'verifying', 'cross_checking', 'independent_review', 'drafting_report',
  'completed', 'incomplete', 'failed', 'cancelled', 'research_limit_reached',
]);

export const CHECKPOINT_METADATA_KEYS = new Set([
  'branch_count', 'unresolved_branches', 'evidence_count', 'source_count', 'check_count',
  'output_refs', 'limitations_count', 'message', 'document_count', 'bundle_sha256',
  'report_sha256', 'qa_summary', 'commit_summary',
]);

export const INVESTIGATION_OUTPUT_TYPES = new Set(['bundle', 'report_markdown', 'report_html', 'evidence', 'execution_log']);
export const INVESTIGATION_CONTENT_TYPES = new Set([
  'application/json', 'text/html', 'application/octet-stream', 'text/plain',
]);

export const REQUIRED_INVESTIGATION_CAPABILITIES = Object.freeze([
  'bounded_control', 'case_investigation', 'signed_manifests', 'durable_checkpoints',
  'deterministic_qa', 'atomic_bundle_commit',
]);
