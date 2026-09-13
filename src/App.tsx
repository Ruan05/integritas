import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  FileSearch,
  Gavel,
  History,
  Play,
  Shield,
  UploadCloud,
} from 'lucide-react';
import { isSupabaseConfigured } from './lib/supabase';

const capabilityStates = [
  ['Investigation', 'Server-gated'],
  ['Development', 'Approval-gated'],
  ['Admin Agent', 'Server-gated'],
  ['Maximum Guarded', 'Approval-gated'],
] as const;

function ConfigurationHealth() {
  return (
    <div className={isSupabaseConfigured ? 'health warn' : 'health warn'}>
      {isSupabaseConfigured ? <AlertTriangle size={18} /> : <AlertTriangle size={18} />}
      {isSupabaseConfigured
        ? 'Configuration detected - health not verified'
        : 'Preview env not configured'}
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
            <small>Command Center Preview</small>
          </div>
        </div>
        <nav>
          <a className="active" href="#dashboard"><Activity size={18} />Dashboard</a>
          <a href="#cases"><FileSearch size={18} />Cases</a>
          <a href="#investigation"><Shield size={18} />Investigation</a>
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
          <ConfigurationHealth />
        </header>

        <section className="command-card" id="dashboard">
          <div>
            <p className="eyebrow">Investigation control</p>
            <h2>Authenticated case access and live worker health are required before an investigation can start.</h2>
          </div>
          <div className="actions">
            <button type="button" className="secondary" disabled title="Requires an authenticated case session">
              <UploadCloud size={18} />Upload
            </button>
            <button type="button" disabled title="Requires an authenticated case session">
              <Play size={18} />Start Deep Investigation
            </button>
          </div>
        </section>

        <section className="grid">
          <article className="panel" id="cases">
            <div className="panel-head">
              <h2>Cases</h2>
              <span>Server-gated</span>
            </div>
            <p className="muted">No case data is loaded in this preview. The production admin API remains the source of truth for case-scoped access.</p>
          </article>

          <article className="panel" id="investigation">
            <div className="panel-head">
              <h2>Capability state</h2>
              <span>Truthful status</span>
            </div>
            <ul className="pipeline">
              {capabilityStates.map(([name, state]) => (
                <li key={name}>
                  <span className="status-dot waiting" aria-label={state} />
                  <span>{name}</span>
                  <small>{state}</small>
                </li>
              ))}
            </ul>
          </article>

          <article className="panel" id="findings">
            <div className="panel-head">
              <h2>Evidence and findings</h2>
              <span>Case-scoped</span>
            </div>
            <p className="muted">Entities, contradictions, unresolved checks, findings, sources, reports, approvals, and artifacts are loaded only after the server verifies case access.</p>
          </article>

          <article className="panel" id="audit">
            <div className="panel-head">
              <h2>Guardrails</h2>
              <span>Required</span>
            </div>
            <ul className="checks">
              <li>Durable job state remains in Supabase, not in the browser.</li>
              <li>Development changes require branch, tests, PR, and review.</li>
              <li>Production deploys and destructive actions require approval.</li>
              <li>Untrusted documents and web content cannot alter permissions.</li>
            </ul>
          </article>
        </section>
      </section>
    </main>
  );
}
