import {
  deriveInvestigationMilestoneSnapshot,
  type CheckpointRow,
  type CheckResultRow,
  type InvestigationLiveTask,
  type InvestigationMilestone,
} from './lib/integritas-browser';

const statusLabels: Record<InvestigationMilestone['status'], string> = {
  waiting: 'Waiting',
  active: 'In progress',
  complete: 'Complete',
  reused: 'Reused',
  blocked: 'Blocked',
  failed: 'Failed',
  manual: 'Manual check',
};

const taskStatusLabels: Record<InvestigationLiveTask['status'], string> = {
  waiting: 'Waiting',
  active: 'Live',
  complete: 'Complete',
  blocked: 'Needs follow-up',
  failed: 'Failed',
  manual: 'Manual',
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

function LiveTaskList({ rows }: { rows: InvestigationLiveTask[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="live-work" aria-label="Live investigation work">
      <div className="live-work-head">
        <h3>Live work</h3>
        <span>{rows.length} task{rows.length === 1 ? '' : 's'} observed</span>
      </div>
      <ol className="live-task-list">
        {rows.map((task) => (
          <li className={`live-task ${task.status}`} key={task.id}>
            <span className="live-task-dot" aria-hidden="true" />
            <div>
              <strong>{task.label}</strong>
              {task.detail && <small>{task.detail}</small>}
              {(task.provider || task.model) && (
                <small>{[task.provider, task.model].filter(Boolean).join(' · ')}</small>
              )}
            </div>
            <span>{taskStatusLabels[task.status]}</span>
          </li>
        ))}
      </ol>
    </section>
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
  const draftReady = snapshot.renderStatus === 'ready';
  const progressLabel = snapshot.isLive
    ? `${pct}% live progress`
    : jobStage === 'incomplete'
      ? draftReady
        ? `${pct}% execution complete · draft report ready`
        : `${pct}% execution complete · investigation needs review`
      : (total > 0 ? `${completed}/${total} complete` : `${pct}%`);

  const latestEvent = snapshot.liveEvents.at(-1)
    ?? (snapshot.message
      ? {
          id: 'checkpoint-message',
          category: snapshot.isLive ? 'LIVE' : 'STATUS',
          message: snapshot.message,
          state: 'info' as const,
          at: '',
        }
      : null);

  const readyProviders = snapshot.modelDiscovery?.providers.filter((row) => row.status === 'ready').length ?? 0;
  const visibleModels = snapshot.modelDiscovery?.providers.reduce((sum, row) => sum + row.model_count, 0) ?? 0;
  const newModels = snapshot.modelDiscovery?.providers.reduce((sum, row) => sum + row.new_count, 0) ?? 0;

  return (
    <article className="panel wide milestone-board" id="milestones" aria-live="polite">
      <div className="panel-head milestone-head">
        <div>
          <p className="eyebrow">Investigation progress</p>
          <h2>{snapshot.isLive ? 'Live investigation' : draftReady ? 'Report ready for review' : 'Investigation status'}</h2>
        </div>
        <span>{progressLabel}</span>
      </div>

      {latestEvent && (
        <section className={`investigation-wire ${latestEvent.state}`} aria-label="Latest investigation discovery">
          <strong>{latestEvent.category}</strong>
          <div className="wire-viewport">
            <div className="wire-track">{latestEvent.message}</div>
          </div>
        </section>
      )}

      <div className="milestone-progress" aria-label={`Investigation milestone completion ${pct}%`}>
        <span style={{ width: `${pct}%` }} />
      </div>

      {snapshot.modelDiscovery && (
        <div className="model-routing-strip" aria-label="AI routing status">
          <strong>AI routing</strong>
          <span>{readyProviders} provider{readyProviders === 1 ? '' : 's'} ready</span>
          <span>{visibleModels} model{visibleModels === 1 ? '' : 's'} discovered</span>
          {newModels > 0 && <span>{newModels} new since last scan</span>}
        </div>
      )}

      {snapshot.currentTask && (
        <section className={`current-task-card ${snapshot.currentTask.status}`} aria-label="Current investigation task">
          <p className="eyebrow">Current task</p>
          <div className="current-task-row">
            <div>
              <h3>{snapshot.currentTask.label}</h3>
              {snapshot.currentTask.detail && <p>{snapshot.currentTask.detail}</p>}
            </div>
            <span>{taskStatusLabels[snapshot.currentTask.status]}</span>
          </div>
          {(snapshot.currentTask.provider || snapshot.currentTask.model) && (
            <small>{[snapshot.currentTask.provider, snapshot.currentTask.model].filter(Boolean).join(' · ')}</small>
          )}
        </section>
      )}

      <LiveTaskList rows={snapshot.liveTasks} />

      {blocked > 0 && (
        <p className="milestone-alert">
          {blocked === 1
            ? '1 check still needs manual verification or is blocked.'
            : `${blocked} checks still need manual verification or are blocked.`}
        </p>
      )}

      {!snapshot.isLive && jobStage === 'incomplete' && (
        <p className="milestone-alert">
          {draftReady
            ? 'The technical workflow and private PDF commit succeeded. Unresolved verification gates remain open for analyst review.'
            : 'The investigation stopped with unresolved verification gates. Preserved work can be continued from its latest trustworthy checkpoint.'}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="muted">Live tasks will appear as soon as the Oracle worker begins the investigation.</p>
      ) : (
        <div className="milestone-columns">
          <MilestoneGroup title="Investigation process" rows={core} />
          <MilestoneGroup title="Workflow modules" rows={modules} />
          {!snapshot.isLive && <MilestoneGroup title="Case-specific research checks" rows={research} />}
        </div>
      )}
    </article>
  );
}
