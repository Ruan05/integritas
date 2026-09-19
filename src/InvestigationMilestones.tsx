import { deriveInvestigationMilestones, type CheckpointRow, type CheckResultRow, type InvestigationMilestone } from './lib/integritas-browser';

const statusLabels: Record<InvestigationMilestone['status'], string> = {
  waiting: 'Waiting',
  active: 'In progress',
  complete: 'Complete',
  blocked: 'Blocked',
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
            <span className="milestone-check" aria-hidden="true">{row.status === 'complete' ? '✓' : row.status === 'active' ? '•' : ' '}</span>
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
  jobProgress,
}: {
  checkpoints: CheckpointRow[];
  checks: CheckResultRow[];
  jobProgress: number;
}) {
  const rows = deriveInvestigationMilestones(checkpoints, checks);
  const core = rows.filter((row) => row.id.startsWith('core.'));
  const research = rows.filter((row) => row.id.startsWith('lane.'));
  const completed = rows.filter((row) => row.status === 'complete').length;
  const blocked = rows.filter((row) => row.status === 'blocked' || row.status === 'manual').length;
  const total = rows.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : Math.max(0, Math.min(100, jobProgress || 0));

  return (
    <article className="panel wide milestone-board" id="milestones" aria-live="polite">
      <div className="panel-head milestone-head">
        <div>
          <h2>Live investigation milestones</h2>
          <p className="muted">Checks tick off only when the Oracle investigation record confirms them.</p>
        </div>
        <span>{total > 0 ? `${completed}/${total} complete` : `${jobProgress || 0}%`}</span>
      </div>

      <div className="milestone-progress" aria-label={`Investigation milestone completion ${pct}%`}>
        <span style={{ width: `${pct}%` }} />
      </div>

      {blocked > 0 && (
        <p className="milestone-alert">
          {blocked} check{blocked === 1 ? '' : 's'} still need{blocked === 1 ? 's' : ''} manual verification or are blocked.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="muted">Milestones will appear as soon as the Oracle worker begins the investigation.</p>
      ) : (
        <div className="milestone-columns">
          <MilestoneGroup title="Investigation process" rows={core} />
          <MilestoneGroup title="Case-specific research checks" rows={research} />
        </div>
      )}
    </article>
  );
}
