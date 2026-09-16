import {
  Activity,
  AlertTriangle,
  BookOpenCheck,
  ClipboardCheck,
  FileSearch,
  FolderOpen,
  Gavel,
  History,
  Network,
  Play,
  SearchCheck,
  Shield,
  UploadCloud,
} from 'lucide-react';
import { isSupabaseConfigured } from './lib/supabase';

const navigation = [
  ['Dashboard', '#dashboard', Activity],
  ['Cases', '#cases', FolderOpen],
  ['Documents', '#documents', FileSearch],
  ['Entities', '#entities', Network],
  ['Investigation', '#investigation', SearchCheck],
  ['Findings', '#findings', Gavel],
  ['Evidence & Sources', '#evidence', BookOpenCheck],
  ['Contradictions', '#contradictions', AlertTriangle],
  ['Unresolved Checks', '#checks', ClipboardCheck],
  ['Research Jobs', '#jobs', Activity],
  ['Reports', '#reports', FileSearch],
  ['History & Audit', '#audit', History],
] as const;

const investigationStages = [
  'Queued',
  'Extracting',
  'Analyzing',
  'Mapping',
  'Planning',
  'Researching',
  'Verifying',
  'Cross-checking',
  'Independent review',
  'Drafting report',
] as const;

function ConfigurationHealth() {
  return (
    <div className="health warn" role="status">
      <AlertTriangle size={18} />
      {isSupabaseConfigured
        ? 'Configuration detected — session verification required'
        : 'Preview environment — server connection not configured'}
    </div>
  );
}

export function App() {
  return (
    <main className="shell">
      <aside className="sidebar" aria-label="Integritas navigation">
        <div className="brand">
          <span className="brand-mark">I</span>
          <div>
            <strong>Integritas</strong>
            <small>Private Command Center</small>
          </div>
        </div>
        <nav>
          {navigation.map(([label, href, Icon], index) => (
            <a className={index === 0 ? 'active' : undefined} href={href} key={label}>
              <Icon size={18} />{label}
            </a>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Private Admin Workspace</p>
            <h1>AI investigation control panel</h1>
          </div>
          <ConfigurationHealth />
        </header>

        <section className="command-card" id="dashboard">
          <div>
            <p className="eyebrow">Case intake and investigation</p>
            <h2>Start with verified case access, preserve the evidence trail, then move work through review and finalisation.</h2>
          </div>
          <div className="actions">
            <button type="button" className="secondary" disabled title="Requires an authenticated case session">
              <UploadCloud size={18} />Upload evidence
            </button>
            <button type="button" disabled title="Requires an authenticated case session">
              <Play size={18} />Start Deep Investigation
            </button>
          </div>
        </section>

        <section className="workflow" aria-label="Investigation workflow">
          {['Case access', 'Evidence intake', 'Investigation', 'Analyst review', 'Report finalisation'].map((step, index) => (
            <div className="workflow-step" key={step}>
              <span>{index + 1}</span>
              <strong>{step}</strong>
              <small>{index === 0 ? 'Server-gated' : 'Case-scoped'}</small>
            </div>
          ))}
        </section>

        <section className="grid">
          <article className="panel" id="cases">
            <div className="panel-head">
              <h2>Cases and documents</h2>
              <span>Authenticated only</span>
            </div>
            <p className="muted" id="documents">A case must be explicitly assigned before documents, entities, relationships, and identifiers can be displayed. Uploads are SHA-256 deduplicated and case revisioned on the server.</p>
          </article>

          <article className="panel" id="investigation">
            <div className="panel-head">
              <h2>Investigation pipeline</h2>
              <span>Case-scoped</span>
            </div>
            <ol className="pipeline">
              {investigationStages.map((stage) => (
                <li key={stage}>
                  <span className="status-dot waiting" aria-label="Awaiting authenticated case" />
                  <span>{stage}</span>
                  <small>Awaiting case</small>
                </li>
              ))}
            </ol>
          </article>

          <article className="panel" id="entities">
            <div className="panel-head">
              <h2>Evidence-led analysis</h2>
              <span>Review required</span>
            </div>
            <p className="muted" id="findings">Entities, source-linked findings, evidence, contradictions, and unresolved checks remain separated until the analyst verifies each conclusion.</p>
            <div className="tag-row">
              <span id="evidence">Evidence &amp; sources</span>
              <span id="contradictions">Contradictions</span>
              <span id="checks">Unresolved checks</span>
            </div>
          </article>

          <article className="panel" id="jobs">
            <div className="panel-head">
              <h2>Research jobs and reports</h2>
              <span>Durable state</span>
            </div>
            <p className="muted" id="reports">Jobs, report revisions, review decisions, and finalisation guards are retained in Supabase. The browser is never the system of record.</p>
          </article>

          <article className="panel wide" id="audit">
            <div className="panel-head">
              <h2>Control and audit boundary</h2>
              <span>Approval-gated</span>
            </div>
            <ul className="checks">
              <li>All case access, investigation actions, and reports are authorised server-side.</li>
              <li>New evidence marks older reports stale until reviewed again.</li>
              <li>Infrastructure controls use typed, audited commands—not a browser-exposed shell.</li>
              <li>Production changes require a branch, tests, review, and explicit approval.</li>
            </ul>
          </article>
        </section>
      </section>
    </main>
  );
}
