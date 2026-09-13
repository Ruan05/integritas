import { Activity, AlertTriangle, CheckCircle2, FileSearch, Gavel, History, Play, Shield, UploadCloud } from 'lucide-react';
import { isSupabaseConfigured } from './lib/supabase';
import type { CaseSummary, PipelineStep } from './types';

const pipeline: PipelineStep[] = [
  { label: 'Upload validation', status: 'done' },
  { label: 'Entity and claim extraction', status: 'done' },
  { label: 'Browser research', status: 'active' },
  { label: 'Cross-checking', status: 'waiting' },
  { label: 'Analyst approval', status: 'waiting' },
];

const cases: CaseSummary[] = [
  { id: 'INT-001', name: 'Synthetic trade due diligence', risk: 'High', status: 'Researching', updatedAt: 'Today' },
  { id: 'INT-002', name: 'Buyer identity verification', risk: 'Medium', status: 'Needs review', updatedAt: 'Yesterday' },
  { id: 'INT-003', name: 'Seller source-of-funds screen', risk: 'Low', status: 'Completed', updatedAt: 'Sep 11' },
];

function StatusDot({ status }: { status: PipelineStep['status'] }) {
  return <span className={`status-dot ${status}`} aria-label={status} />;
}

export function App() {
  return (
    <main className="shell">
      <aside className="sidebar" aria-label="Integritas navigation">
        <div className="brand">
          <span className="brand-mark">I</span>
          <div>
            <strong>Integritas</strong>
            <small>Command Center</small>
          </div>
        </div>
        <nav>
          <a className="active" href="#dashboard"><Activity size={18} />Dashboard</a>
          <a href="#cases"><FileSearch size={18} />Cases</a>
          <a href="#evidence"><Shield size={18} />Evidence</a>
          <a href="#findings"><Gavel size={18} />Findings</a>
          <a href="#audit"><History size={18} />Audit</a>
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Private Admin Workspace</p>
            <h1>AI investigation control panel</h1>
          </div>
          <div className={isSupabaseConfigured ? 'health ok' : 'health warn'}>
            {isSupabaseConfigured ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            {isSupabaseConfigured ? 'Supabase configured' : 'Preview env not configured'}
          </div>
        </header>

        <section className="command-card" id="dashboard">
          <div>
            <p className="eyebrow">Start Investigation</p>
            <h2>Upload documents, route work to workers, keep review gates human-controlled.</h2>
          </div>
          <div className="actions">
            <button type="button" className="secondary"><UploadCloud size={18} />Upload</button>
            <button type="button"><Play size={18} />Start Deep Investigation</button>
          </div>
        </section>

        <section className="grid">
          <article className="panel" id="cases">
            <div className="panel-head">
              <h2>Active cases</h2>
              <span>3 open</span>
            </div>
            <div className="case-list">
              {cases.map((item) => (
                <div className="case-row" key={item.id}>
                  <div>
                    <strong>{item.id}</strong>
                    <p>{item.name}</p>
                  </div>
                  <span className={`risk ${item.risk.toLowerCase()}`}>{item.risk}</span>
                  <small>{item.status}</small>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panel-head">
              <h2>Current pipeline</h2>
              <span>Live</span>
            </div>
            <ol className="pipeline">
              {pipeline.map((step) => (
                <li key={step.label}>
                  <StatusDot status={step.status} />
                  <span>{step.label}</span>
                </li>
              ))}
            </ol>
          </article>

          <article className="panel" id="evidence">
            <div className="panel-head">
              <h2>Evidence and sources</h2>
              <span>Source-linked</span>
            </div>
            <p className="muted">Document hashes, browser evidence, extracted claims, unresolved checks, and report artifacts should persist in Supabase with case-level access checks.</p>
          </article>

          <article className="panel" id="findings">
            <div className="panel-head">
              <h2>Required controls</h2>
              <span>Before production</span>
            </div>
            <ul className="checks">
              <li>RLS policies for every Integritas table</li>
              <li>Human approval before production deploys</li>
              <li>Sandboxed workers with no secret access</li>
              <li>Retry, cancel, timeout, and audit trails</li>
            </ul>
          </article>
        </section>
      </section>
    </main>
  );
}
