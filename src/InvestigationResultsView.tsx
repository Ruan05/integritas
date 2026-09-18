import { isInvestigationResultStale, type PersistedInvestigationResults } from './lib/integritas-browser';

type ResultJob = { case_revision: number; stage: string };

export function InvestigationResultsView({
  results,
  caseRevision,
  job,
}: {
  results: PersistedInvestigationResults;
  caseRevision: number;
  job: ResultJob;
}) {
  const sourceById = new Map(results.sources.map((source) => [source.id, source]));
  const contradictions = results.findings.filter((finding) => finding.finding_type === 'contradiction');
  const unresolved = results.checks.filter((check) => check.check_type === 'unresolved' || check.status !== 'complete');
  const stale = isInvestigationResultStale(caseRevision, job.case_revision, results.report?.based_on_revision ?? null);
  const latestCheckpoint = results.checkpoints.at(-1);
  const terminalLabels: Record<string, string> = {
    failed: 'Investigation failed',
    cancelled: 'Investigation cancelled',
    incomplete: 'Investigation incomplete',
    research_limit_reached: 'Research limit reached',
  };
  const terminalLabel = terminalLabels[job.stage];

  return (
    <>
      {terminalLabel && (
        <div className="result-banner danger" role="alert">
          <strong>{terminalLabel}</strong>
          {typeof latestCheckpoint?.safe_metadata?.message === 'string' && <span>{latestCheckpoint.safe_metadata.message}</span>}
        </div>
      )}
      {stale && (
        <div className="result-banner warn" role="status">
          <strong>Stale report</strong>
          <span>Current case revision {caseRevision}; investigation revision {job.case_revision}.</span>
        </div>
      )}

      <article className="panel" id="entities">
        <div className="panel-head"><h2>Entities</h2><span>{results.entities.length}</span></div>
        {results.entities.length === 0 ? <p className="muted">No persisted entities yet.</p> : (
          <ul className="result-list">
            {results.entities.map((entity) => (
              <li key={entity.id}>
                <strong>{entity.display_name}</strong>
                <span className="result-key">{entity.entity_key}</span>
                <small>
                  {entity.entity_type} · {entity.match_status}
                  {entity.match_confidence == null ? '' : ' · ' + entity.match_confidence + '%'}
                </small>
              </li>
            ))}
          </ul>
        )}
      </article>
      <article className="panel" id="findings">
        <div className="panel-head"><h2>Findings</h2><span>Source-linked</span></div>
        {results.findings.filter((finding) => finding.finding_type !== 'contradiction').length === 0 ? (
          <p className="muted">No persisted findings yet.</p>
        ) : results.findings.filter((finding) => finding.finding_type !== 'contradiction').map((finding) => (
          <div className="finding-card" key={finding.id}>
            <strong>{finding.claim}</strong>
            <small>{finding.evidence_status} · {finding.materiality} · {finding.reliability}</small>
            {finding.source_ids.length > 0 && (
              <ul className="source-links">
                {finding.source_ids.map((sourceId) => {
                  const source = sourceById.get(sourceId);
                  return source ? <li key={sourceId}>{source.title}</li> : null;
                })}
              </ul>
            )}
          </div>
        ))}
      </article>

      <article className="panel" id="evidence">
        <div className="panel-head"><h2>Evidence &amp; Sources</h2><span>{results.sources.length}</span></div>
        <ul className="result-list">
          {results.sources.map((source) => (
            <li key={source.id}>
              <strong>{source.source_key}</strong>
              <small>{source.source_type}{source.page_reference ? ' · page ' + source.page_reference : ''}</small>
              <span>{source.excerpt || 'No excerpt persisted.'}</span>
            </li>
          ))}
        </ul>
      </article>

      <article className="panel" id="contradictions">
        <div className="panel-head"><h2>Contradictions</h2><span>{contradictions.length}</span></div>
        {contradictions.length === 0 ? <p className="muted">No contradictions persisted.</p> : (
          <ul className="result-list">
            {contradictions.map((finding) => <li key={finding.id}><strong>{finding.claim}</strong></li>)}
          </ul>
        )}
      </article>

      <article className="panel" id="checks">
        <div className="panel-head"><h2>Unresolved Checks</h2><span>{unresolved.length}</span></div>
        {unresolved.length === 0 ? <p className="muted">No unresolved checks.</p> : (
          <ul className="result-list">
            {unresolved.map((check) => (
              <li key={check.id}>
                <strong>{check.description}</strong>
                <small>{check.status}</small>
                {check.outcome && <span>{check.outcome}</span>}
              </li>
            ))}
          </ul>
        )}
      </article>

      <article className="panel wide" id="reports">
        <div className="panel-head"><h2>Report</h2><span>{results.report?.status ?? 'Not generated'}</span></div>
        {results.report ? (
          <>
            <p className="muted">{results.report.summary}</p>
            <pre className="report-markdown">{results.report.content_markdown}</pre>
            {results.report.limitations && <p className="report-limitations">Limitations: {results.report.limitations}</p>}
          </>
        ) : <p className="muted">No persisted report yet.</p>}
      </article>

      <article className="panel wide" id="audit">
        <div className="panel-head"><h2>History &amp; Audit</h2><span>{results.auditEvents.length + results.checkpoints.length}</span></div>
        <div className="audit-stream">
          {results.checkpoints.map((checkpoint) => (
            <div key={checkpoint.id}><strong>{checkpoint.stage}</strong><small>{checkpoint.progress}%</small></div>
          ))}
          {results.auditEvents.map((event) => (
            <div key={String(event.id)}><strong>{event.event_type}</strong><small>{event.created_at}</small></div>
          ))}
        </div>
      </article>
    </>
  );
}