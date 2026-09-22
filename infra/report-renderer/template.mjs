const TEMPLATE_VERSION = 'integritas-report-v2';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function sanitizeMarkdown(markdown) {
  let text = String(markdown ?? '');
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt) => `[Image omitted: ${alt || 'unlabelled'}]`);
  text = text.replace(/\]\(\s*(?:javascript|file|data):[^)]*\)/gi, '](#)');
  text = text.replace(/<\/?[A-Za-z][^>]*>/g, (match) => escapeHtml(match));
  return text;
}

function countBy(rows, field) {
  const counts = new Map();
  for (const row of rows ?? []) {
    const key = String(row?.[field] ?? 'unknown');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function percent(value, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

export function buildRenderSpec(bundle) {
  const findings = Array.isArray(bundle?.findings) ? bundle.findings : [];
  const checks = Array.isArray(bundle?.checks) ? bundle.checks : [];
  const sources = Array.isArray(bundle?.sources) ? bundle.sources : [];
  const entities = Array.isArray(bundle?.entities) ? bundle.entities : [];
  const contradictions = Array.isArray(bundle?.contradictions) ? bundle.contradictions : [];
  const unresolved = Array.isArray(bundle?.unresolved_checks) ? bundle.unresolved_checks : [];
  const completedChecks = checks.filter((row) => row?.status === 'complete').length;
  const externalSources = sources.filter((row) => row?.evidence_origin === 'external_research').length;
  return {
    template_version: TEMPLATE_VERSION,
    terminal_outcome: bundle?.execution?.terminal_outcome ?? 'unknown',
    counts: {
      entities: entities.length,
      findings: findings.length,
      contradictions: contradictions.length,
      unresolved: unresolved.length,
      checks: checks.length,
      completed_checks: completedChecks,
      sources: sources.length,
      external_sources: externalSources,
    },
    check_completion_percent: percent(completedChecks, checks.length),
    finding_statuses: countBy(findings, 'evidence_status'),
    finding_materialities: countBy(findings, 'materiality'),
    entity_types: countBy(entities, 'entity_type'),
  };
}

function metric(label, value, note = '') {
  return `<div class="metric"><div class="metric-value">${escapeHtml(value)}</div><div class="metric-label">${escapeHtml(label)}</div>${note ? `<div class="metric-note">${escapeHtml(note)}</div>` : ''}</div>`;
}

function statusClass(status) {
  const value = String(status ?? '').toLowerCase();
  if (['completed', 'verified', 'complete', 'pass'].includes(value)) return 'status-ok';
  if (['incomplete', 'blocked', 'conflicting', 'revise'].includes(value)) return 'status-warn';
  if (['failed', 'critical'].includes(value)) return 'status-bad';
  return 'status-neutral';
}

function summaryVisuals(bundle, spec) {
  const status = escapeHtml(spec.terminal_outcome);
  const rows = spec.finding_statuses.slice(0, 5).map(([label, value]) => {
    const width = percent(value, Math.max(1, spec.counts.findings));
    return `<div class="bar-row"><span>${escapeHtml(label)}</span><div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div><strong>${value}</strong></div>`;
  }).join('');
  return `
<section class="evidence-dashboard">
  <div class="dashboard-head">
    <div>
      <div class="eyebrow">Evidence dashboard</div>
      <h2>Current investigation position</h2>
    </div>
    <div class="status-pill ${statusClass(spec.terminal_outcome)}">${status}</div>
  </div>
  <div class="metrics">
    ${metric('Entities', spec.counts.entities)}
    ${metric('Findings', spec.counts.findings)}
    ${metric('Sources', spec.counts.sources, `${spec.counts.external_sources} external`)}
    ${metric('Contradictions', spec.counts.contradictions)}
    ${metric('Unresolved gates', spec.counts.unresolved)}
    ${metric('Checks complete', `${spec.check_completion_percent}%`, `${spec.counts.completed_checks}/${spec.counts.checks}`)}
  </div>
  ${rows ? `<div class="bar-panel"><h3>Finding evidence status</h3>${rows}</div>` : ''}
  ${spec.finding_materialities?.length ? `<div class="bar-panel"><h3>Finding materiality</h3>${spec.finding_materialities.slice(0, 5).map(([label, value]) => `<div class="bar-row"><span>${escapeHtml(label)}</span><div class="bar-track"><div class="bar-fill materiality" style="width:${percent(value, Math.max(1, spec.counts.findings))}%"></div></div><strong>${value}</strong></div>`).join('')}</div>` : ''}
</section>`;
}

function compact(value, limit = 220) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function subjectStatusMatrix(bundle) {
  const findings = Array.isArray(bundle?.findings) ? bundle.findings : [];
  const rows = (bundle?.entities ?? []).slice(0, 50).map((entity) => {
    const entityFindings = findings.filter((finding) => finding?.entity_key === entity?.entity_key);
    const material = entityFindings.filter((finding) => ['critical', 'high'].includes(String(finding?.materiality))).length;
    const linked = entityFindings.filter((finding) => Array.isArray(finding?.source_keys) && finding.source_keys.length).length;
    const role = entity?.identifiers?.role || 'unknown';
    const scope = entity?.identifiers?.subject_scope || 'unknown';
    const confidence = Number.isFinite(entity?.confidence) ? `${Math.round(entity.confidence)}%` : '—';
    return `<tr><td><strong>${escapeHtml(entity?.display_name || entity?.entity_key || 'Unknown')}</strong><br><span class="mono-key">${escapeHtml(entity?.entity_key || '')}</span></td><td>${escapeHtml(String(role).replaceAll('_', ' '))}</td><td>${escapeHtml(String(scope).replaceAll('_', ' '))}</td><td><span class="status-pill ${statusClass(entity?.match_status)}">${escapeHtml(entity?.match_status || 'unknown')}</span><br>${escapeHtml(confidence)}</td><td>${material}</td><td>${linked}/${entityFindings.length}</td></tr>`;
  }).join('');
  if (!rows) return '';
  return `<section class="report-visual subject-matrix"><div class="visual-title"><div><div class="eyebrow">Subject controls</div><h2>Subject status matrix</h2></div><span>${(bundle?.entities ?? []).length} entity record(s)</span></div><table><thead><tr><th>Entity</th><th>Role</th><th>Scope</th><th>Identity status</th><th>High / critical</th><th>Source-linked findings</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function claimEvidenceMatrix(bundle) {
  const sources = new Map((bundle?.sources ?? []).map((row) => [row?.source_key, row]));
  const weight = { critical: 5, high: 4, medium: 3, low: 2, informational: 1 };
  const ordered = [...(bundle?.findings ?? [])]
    .sort((a, b) => (weight[b?.materiality] ?? 0) - (weight[a?.materiality] ?? 0))
    .slice(0, 35);
  const rows = ordered.map((finding) => {
    const labels = (finding?.source_keys ?? []).slice(0, 5).map((key) => {
      const source = sources.get(key);
      const page = source?.page_reference ? ` · ${source.page_reference}` : '';
      return `${key}${page}`;
    }).join('; ') || 'No linked source';
    return `<tr><td>${escapeHtml(compact(finding?.claim, 360))}</td><td><span class="status-pill ${statusClass(finding?.evidence_status)}">${escapeHtml(finding?.evidence_status || 'unknown')}</span></td><td>${escapeHtml(finding?.materiality || 'unknown')}</td><td class="mono-key">${escapeHtml(labels)}</td></tr>`;
  }).join('');
  if (!rows) return '';
  return `<section class="report-visual claim-matrix"><div class="visual-title"><div><div class="eyebrow">Provenance</div><h2>Claim-to-evidence matrix</h2></div><span>${ordered.length}/${(bundle?.findings ?? []).length} finding(s) shown</span></div><table><thead><tr><th>Claim</th><th>Status</th><th>Materiality</th><th>Source / page</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function transactionControlMatrix(bundle) {
  const checks = (bundle?.checks ?? []).filter((row) => {
    const key = `${row?.check_key || ''} ${row?.check_type || ''}`;
    return /(?:bank|iban|bic|swift|imo|vessel|pricing|econom|trade|payment|product|title|logistic|terminal|sanction)/i.test(key);
  }).slice(0, 40);
  if (!checks.length) return '';
  const rows = checks.map((row) => `<tr><td>${escapeHtml(row?.check_type || row?.check_key || 'check')}</td><td>${escapeHtml(compact(row?.description, 320))}</td><td><span class="status-pill ${statusClass(row?.status)}">${escapeHtml(row?.status || 'unknown')}</span></td><td>${escapeHtml(compact(row?.outcome, 340))}</td></tr>`).join('');
  return `<section class="report-visual"><div class="visual-title"><div><div class="eyebrow">Transaction controls</div><h2>Banking, logistics & trade checks</h2></div><span>${checks.length} material check(s)</span></div><table><thead><tr><th>Control</th><th>Test</th><th>Status</th><th>Outcome</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function evidenceRegister(bundle) {
  const sources = (bundle?.sources ?? []).slice(0, 50);
  if (!sources.length) return '';
  const rows = sources.map((row) => `<tr><td class="mono-key">${escapeHtml(row?.source_key || '')}</td><td>${escapeHtml(row?.evidence_origin || '')}</td><td>${escapeHtml(compact(row?.title, 220))}</td><td>${escapeHtml(row?.page_reference || '—')}</td><td>${escapeHtml(compact(row?.reliability_note, 280))}</td></tr>`).join('');
  return `<section class="report-visual"><div class="visual-title"><div><div class="eyebrow">Evidence register</div><h2>Source coverage</h2></div><span>${(bundle?.sources ?? []).length} source(s)</span></div><table><thead><tr><th>Source key</th><th>Origin</th><th>Title</th><th>Page</th><th>Reliability / caveat</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function relationshipMap(bundle) {
  const entities = new Map((bundle?.entities ?? []).map((row) => [row?.entity_key, row?.display_name || row?.entity_key]));
  const rows = (bundle?.relationships ?? []).slice(0, 80).map((row) => {
    const from = entities.get(row?.from_entity_key) || row?.from_entity_key || 'Unknown entity';
    const to = entities.get(row?.to_entity_key) || row?.to_entity_key || 'Unknown entity';
    return `<tr><td>${escapeHtml(from)}</td><td class="edge">${escapeHtml(row?.relationship_type || 'related to')}</td><td>${escapeHtml(to)}</td><td><span class="status-pill ${statusClass(row?.evidence_status)}">${escapeHtml(row?.evidence_status || 'uncertain')}</span></td></tr>`;
  }).join('');
  if (!rows) return '';
  return `<section class="report-visual"><div class="visual-title"><div><div class="eyebrow">Evidence graph</div><h2>Entity relationship map</h2></div><span>${(bundle?.relationships ?? []).length} mapped link(s)</span></div><table><thead><tr><th>From</th><th>Relationship</th><th>To</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function contradictionMatrix(bundle) {
  const rows = (bundle?.contradictions ?? []).slice(0, 60).map((row) => `<tr><td>${escapeHtml(row?.contradiction_key || 'Contradiction')}</td><td>${escapeHtml(compact(row?.description, 420))}</td><td>${escapeHtml((row?.finding_keys ?? []).join(', '))}</td></tr>`).join('');
  if (!rows) return '';
  return `<section class="report-visual"><div class="visual-title"><div><div class="eyebrow">Conflict review</div><h2>Contradiction matrix</h2></div><span>${(bundle?.contradictions ?? []).length} item(s)</span></div><table><thead><tr><th>Conflict</th><th>What conflicts</th><th>Linked findings</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function unresolvedGates(bundle) {
  const rows = (bundle?.unresolved_checks ?? []).slice(0, 60).map((row, index) => `<li><strong>${index + 1}. ${escapeHtml(compact(row?.description, 300))}</strong><span><b>Blocker:</b> ${escapeHtml(compact(row?.blocker || row?.reason, 240))}</span><span><b>Required action:</b> ${escapeHtml(compact(row?.next_manual_action, 360))}</span></li>`).join('');
  if (!rows) return '';
  return `<section class="report-visual gates"><div class="visual-title"><div><div class="eyebrow">Closure controls</div><h2>Unresolved verification gates</h2></div><span>${(bundle?.unresolved_checks ?? []).length} gate(s)</span></div><ol>${rows}</ol></section>`;
}

function executionTimeline(bundle) {
  const stages = Array.isArray(bundle?.execution?.stages) ? bundle.execution.stages.slice(0, 32) : [];
  if (!stages.length) return '';
  const nodes = stages.map((stage, index) => `<li><span>${index + 1}</span><strong>${escapeHtml(stage)}</strong></li>`).join('');
  return `<section class="report-visual"><div class="visual-title"><div><div class="eyebrow">Execution trace</div><h2>Investigation timeline</h2></div><span>${escapeHtml(bundle?.execution?.terminal_outcome || 'unknown')}</span></div><ol class="timeline">${nodes}</ol></section>`;
}

export function buildIndexHtml(bundle) {
  const spec = buildRenderSpec(bundle);
  const caseId = escapeHtml(bundle?.case_id ?? '');
  const jobId = escapeHtml(bundle?.case_job_id ?? '');
  const generated = escapeHtml(bundle?.generated_at ?? '');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Integritas Due-Diligence Report</title>
<style>
@page { size: A4; margin: 20mm 14mm 20mm 14mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: #171717; font-family: "DejaVu Sans", Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; background: #fff; }
h1, h2, h3, h4 { color: #111; page-break-after: avoid; break-after: avoid-page; }
h1 { font-size: 23pt; border-bottom: 2px solid #b68a32; padding-bottom: 7px; margin-top: 25px; }
h2 { font-size: 16pt; margin-top: 22px; }
h3 { font-size: 12pt; margin-top: 16px; }
p, li { orphans: 3; widows: 3; }
table { width: 100%; border-collapse: collapse; margin: 10px 0 16px; font-size: 9pt; break-inside: avoid-page; }
th { background: #171717; color: #f2d083; text-align: left; padding: 7px; }
td { border: 1px solid #d8d0bf; padding: 7px; vertical-align: top; }
code { background: #f4f1ea; padding: 1px 4px; border-radius: 3px; }
pre { white-space: pre-wrap; background: #f4f1ea; padding: 10px; border-left: 3px solid #b68a32; }
blockquote { border-left: 3px solid #b68a32; margin-left: 0; padding-left: 12px; color: #555; }
.cover { background: #0b0b0b; color: white; padding: 22mm 16mm 18mm; margin: -20mm -14mm 14mm; min-height: 92mm; }
.cover .brand { color: #d4ad5f; letter-spacing: .18em; font-size: 10pt; text-transform: uppercase; }
.cover h1 { color: white; border: 0; font-size: 28pt; margin: 15px 0 10px; }
.cover .subtitle { color: #d9d9d9; max-width: 150mm; }
.cover-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin-top: 22px; font-size: 8.5pt; }
.cover-label { color: #b7a06c; text-transform: uppercase; letter-spacing: .08em; }
.evidence-dashboard { border: 1px solid #c8ad73; padding: 14px; margin: 14px 0 20px; break-inside: avoid-page; }
.dashboard-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
.eyebrow { color:#8d6a25; text-transform:uppercase; letter-spacing:.1em; font-size:8pt; font-weight:700; }
.dashboard-head h2 { margin:2px 0 10px; }
.status-pill { padding:5px 9px; border-radius:12px; font-size:8pt; font-weight:700; text-transform:uppercase; }
.status-ok { background:#e9f4ea; color:#22582a; }
.status-warn { background:#fff2cf; color:#75530d; }
.status-bad { background:#fde7e7; color:#7a1d1d; }
.status-neutral { background:#ededed; color:#444; }
.metrics { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
.metric { border:1px solid #e4dccb; padding:9px; background:#fbfaf7; }
.metric-value { font-size:17pt; font-weight:700; color:#171717; }
.metric-label { color:#6b5a39; font-size:8pt; text-transform:uppercase; letter-spacing:.06em; }
.metric-note { color:#777; font-size:7.5pt; margin-top:2px; }
.bar-panel { margin-top:12px; }
.bar-panel h3 { margin:0 0 8px; font-size:10pt; }
.bar-row { display:grid; grid-template-columns:30mm 1fr 9mm; gap:7px; align-items:center; font-size:8.5pt; margin:5px 0; }
.bar-track { height:7px; background:#eee9df; }
.bar-fill { height:7px; background:#b68a32; }
.bar-fill.materiality { background:#7b632d; }
.mono-key { font-family:"DejaVu Sans Mono", monospace; font-size:7.5pt; color:#5a5140; word-break:break-all; }
.subject-matrix table, .claim-matrix table { font-size:8.2pt; }
.report-visual { border:1px solid #ded2b5; padding:13px; margin:14px 0 20px; break-inside:avoid-page; background:#fffdf8; }
.visual-title { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; color:#6b5a39; font-size:8pt; }
.visual-title h2 { color:#171717; margin:2px 0 9px; }
.edge { color:#785719; font-weight:700; }
.gates ol { margin:8px 0 0; padding-left:19px; }
.gates li { margin:7px 0; padding:7px 9px; background:#fff5dd; border-left:3px solid #b68a32; break-inside:avoid; }
.gates li span { display:block; font-size:8.5pt; margin-top:2px; }
.timeline { list-style:none; padding:0; margin:10px 0 0; display:flex; flex-wrap:wrap; gap:7px; }
.timeline li { display:flex; align-items:center; gap:5px; border:1px solid #ded2b5; padding:5px 7px; font-size:8pt; }
.timeline li span { display:inline-grid; place-items:center; width:16px; height:16px; border-radius:50%; background:#171717; color:#f2d083; font-weight:700; }
.report-body > h1:first-child { margin-top: 8px; }
a { color:#785719; word-break:break-all; }
img { max-width:100%; }
hr { border:0; border-top:1px solid #d9cfb9; margin:18px 0; }
</style>
</head>
<body>
<section class="cover">
  <div class="brand">Integritas · Integrity · Governance · Excellence</div>
  <h1>Enhanced Due-Diligence Report</h1>
  <div class="subtitle">Evidence-led counterparty, identity and transaction verification. Draft work product for human review.</div>
  <div class="cover-grid">
    <div><div class="cover-label">Case ID</div><div>${caseId}</div></div>
    <div><div class="cover-label">Job ID</div><div>${jobId}</div></div>
    <div><div class="cover-label">Depth ceiling</div><div>${escapeHtml(bundle?.depth ?? '')}</div></div>
    <div><div class="cover-label">Generated</div><div>${generated}</div></div>
    <div><div class="cover-label">Template</div><div>${TEMPLATE_VERSION}</div></div>
    <div><div class="cover-label">Diligence status</div><div>${escapeHtml(spec.terminal_outcome)}</div></div>
  </div>
</section>
${summaryVisuals(bundle, spec)}
${subjectStatusMatrix(bundle)}
${relationshipMap(bundle)}
${claimEvidenceMatrix(bundle)}
${transactionControlMatrix(bundle)}
${contradictionMatrix(bundle)}
${unresolvedGates(bundle)}
${evidenceRegister(bundle)}
${executionTimeline(bundle)}
<main class="report-body">
{{ toHTML "report.md" }}
</main>
</body>
</html>`;
}

export function buildHeaderHtml(bundle) {
  return `<!doctype html><html><head><style>
html { -webkit-print-color-adjust: exact; font-family: Arial, sans-serif; font-size: 8px; color: #6b5a39; }
body { margin: 0 14mm; width: calc(100% - 28mm); }
.header { border-bottom: 1px solid #b68a32; padding: 0 0 4px; display:flex; justify-content:space-between; }
</style></head><body><div class="header"><span>INTEGRITAS · CONFIDENTIAL</span><span>${escapeHtml(bundle?.case_id ?? '')}</span></div></body></html>`;
}

export function buildFooterHtml() {
  return `<!doctype html><html><head><style>
html { -webkit-print-color-adjust: exact; font-family: Arial, sans-serif; font-size: 8px; color: #777; }
body { margin: 0 14mm; width: calc(100% - 28mm); }
.footer { border-top: 1px solid #d8d0bf; padding-top: 4px; display:flex; justify-content:space-between; }
</style></head><body><div class="footer"><span>Draft due-diligence work product · Human review required</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div></body></html>`;
}

export { TEMPLATE_VERSION };
