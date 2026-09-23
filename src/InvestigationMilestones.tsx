import { deriveInvestigationMilestoneSnapshot, type CheckpointRow, type CheckResultRow, type InvestigationMilestone } from './lib/integritas-browser';

const statusLabels: Record<InvestigationMilestone['status'], string> = {
  waiting: 'Waiting',
  active: 'In progress',
  complete: 'Complete',
  reused: 'Reused',
  blocked: 'Blocked',
  failed: 'Failed',
  manual: 'Manual check',
};

function MilestoneGroup({
  title,
  rows,
}: {
  title: string;
  rows: InvestigationMilestone[];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="milestone-group">
      <h3>{title}</h3>
      <ol className="milestone-list">
        {rows.map((row) => (
          <li className={`milestone-item ${row.status}`} key={row.id}>
            <span className="milestone-check" aria-hidden="true">{row.status === 'complete' || row.status === 'reused' ? '✓' : row.status === 'failed' ? '!' : row.status === 'active' ? '•' : ' '}</span>
            <div className="milestone-copy">
              <strong>{row.label}</strong>
              <small>{row.priority} priority · {statusLabels[row.status]}</small>
            </div>
            <span className={`milestone-state ${row.status}`}>{statusLabels[row.status]}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function InvestigationMilestones({
  checkpoints,
  checks,
  jobStage,
  jobProgress,
  currentAttempt,
}: {
  checkpoints: CheckpointRow[];
  checks: CheckResultRow[];
  jobStage: string;
  jobProgress: number;
  currentAttempt?: number;
}) {
  const snapshot = deriveInvestigationMilestoneSnapshot(checkpoints, checks, jobStage, jobProgress, currentAttempt);
  const { rows } = snapshot;
  const core = rows.filter((row) => row.id.startsWith('core.'));
  const modules = rows.filter((row) => row.id.startsWith('module.'));
  const research = rows.filter((row) => row.id.startsWith('lane.'));
  const completed = rows.filter((row) => row.status === 'complete' || row.status === 'reused').length;
  const blocked = rows.filter((row) => row.status === 'blocked' || row.status === 'failed' || row.status === 'manual').length;
  const total = rows.length;
  const pct = snapshot.progress;
  const progressLabel = snapshot.isLive
    ? `${pct}% live progress`
    : jobStage === 'incomplete'
      ? `${pct}% execution complete · investigation incomplete`
      : (total > 0 ? `${completed}/${total} complete` : `${pct}%`);

  return (
    <article className="panel wide milestone-board" id="milestones" aria-live="polite">
      <div className="panel-head milestone-head">
        <div>
          <h2>Live investigation milestones</h2>
          <p className="muted">Live progress follows the Oracle worker checkpoint; completed checks appear only after the current run reaches a terminal state.</p>
        </div>
        <span>{progressLabel}</span>
      </div>

      <div className="milestone-progress" aria-label={`Investigation milestone completion ${pct}%`}>
        <span style={{ width: `${pct}%` }} />
      </div>

      {(snapshot.phase || snapshot.message) && (
        <section className="milestone-activity" aria-label="Current investigation activity">
          <strong>Current submodule</strong>
          <span>{snapshot.phase ? snapshot.phase.replaceAll('_', ' ') : snapshot.stage.replaceAll('_', ' ')}</span>
          {snapshot.message && <small>{snapshot.message}</small>}
        </section>
      )}

      {blocked > 0 && (
        <p className="milestone-alert">
          {blocked === 1
            ? '1 check still needs manual verification or is blocked.'
            : `${blocked} checks still need manual verification or are blocked.`}
        </p>
      )}

      {!snapshot.isLive && jobStage === 'incomplete' && (
        <p className="milestone-alert">Technical workflow completed. Outstanding verification gates require analyst review; they are not a service failure.</p>
      )}

      {rows.length === 0 ? (
        <p className="muted">Milestones will appear as soon as the Oracle worker begins the investigation.</p>
      ) : (
        <div className="milestone-columns">
          <MilestoneGroup title="Investigation process" rows={core} />
          <MilestoneGroup title="Live workflow submodules" rows={modules} />
          {!snapshot.isLive && <MilestoneGroup title="Case-specific research checks" rows={research} />}
        </div>
      )}
    </article>
  );
}
