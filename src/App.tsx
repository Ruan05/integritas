import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, BookOpenCheck, ClipboardCheck, FileSearch,
  FolderOpen, Gavel, History, Network, Play, SearchCheck, Shield, UploadCloud,
} from 'lucide-react';
import {
  canStartInvestigation,
  createIntegritasBrowserClient,
  getIntegritasFunctionUrls,
  getAuthRedirectUrl,
  isInvestigationRuntimeReady,
  loadPersistedInvestigationResults,
  SUPPORTED_CASE_FILE_ACCEPT,
  validateCaseDocumentSelection,
  type CheckpointRow,
  type InvestigationDepth,
  type PersistedInvestigationResults,
  type RuntimeStatus,
} from './lib/integritas-browser';
import { InvestigationMilestones } from './InvestigationMilestones';
import { InvestigationResultsView } from './InvestigationResultsView';
import { isSupabaseConfigured, supabase, supabaseUrl } from './lib/supabase';
export { InvestigationResultsView } from './InvestigationResultsView';

type CaseRow = { id: string; title: string; revision: number; created_at: string };
type DocumentRow = { id: string; case_id: string; name: string; created_at: string };
type JobRow = { id: string; case_id: string; case_revision: number; control_command_id: string | null; stage: string; progress: number; runtime_provider: string; depth?: string; created_at?: string; updated_at?: string };
const navigation = [
  ['Dashboard', '#dashboard', Activity], ['Cases', '#cases', FolderOpen],
  ['Documents', '#documents', FileSearch], ['Entities', '#entities', Network],
  ['Investigation', '#investigation', SearchCheck], ['Findings', '#findings', Gavel],
  ['Evidence & Sources', '#evidence', BookOpenCheck], ['Contradictions', '#contradictions', AlertTriangle],
  ['Unresolved Checks', '#checks', ClipboardCheck], ['Research Jobs', '#jobs', Activity],
  ['Reports', '#reports', FileSearch], ['History & Audit', '#audit', History],
] as const;

const investigationStages = [
  ['queued', 'Queued'], ['extracting', 'Extracting'], ['analyzing_documents', 'Analyzing'],
  ['mapping_entities', 'Mapping'], ['planning_research', 'Planning'], ['researching', 'Researching'],
  ['verifying', 'Verifying'], ['cross_checking', 'Cross-checking'],
  ['independent_review', 'Independent review'], ['drafting_report', 'Drafting report'],
] as const;
const retryableInvestigationStages = new Set(['failed', 'incomplete', 'cancelled']);
const terminalInvestigationStages = new Set(['completed', 'incomplete', 'failed', 'cancelled', 'research_limit_reached']);

const openClawPreflight = [
  'Fresh Oracle runtime heartbeat and verified bounded-worker release',
  'Integritas DD skill installed in the verified OpenClaw workspace',
  'Signed manifest, durable checkpoints, and provider capability attested',
  'Explicit case access, case revision, and structured job payload verified',
  'Evidence/result persistence and analyst-review guards exercised',
] as const;
function ConfigurationHealth({ authenticated, runtimeReady }: { authenticated: boolean; runtimeReady: boolean }) {
  let message = 'Preview environment — server connection not configured';
  if (isSupabaseConfigured && !authenticated) message = 'Configuration detected — authenticated admin session required';
  if (authenticated && !runtimeReady) message = 'Authenticated — waiting for attested Oracle/OpenClaw investigation runtime';
  if (authenticated && runtimeReady) message = 'Authenticated — bounded Oracle/OpenClaw investigation runtime ready';
  return (
    <div className={`health ${runtimeReady ? 'ok' : 'warn'}`} role="status">
      {runtimeReady ? <Shield size={18} /> : <AlertTriangle size={18} />}
      {message}
    </div>
  );
}

export function App() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [job, setJob] = useState<JobRow | null>(null);
  const [caseJobs, setCaseJobs] = useState<JobRow[]>([]);
  const [commandStatus, setCommandStatus] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [depth, setDepth] = useState<InvestigationDepth>('deep');
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [results, setResults] = useState<PersistedInvestigationResults | null>(null);
  const [liveCheckpoints, setLiveCheckpoints] = useState<CheckpointRow[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const browserClient = useMemo(() => {
    if (!supabaseUrl) return null;
    const urls = getIntegritasFunctionUrls(supabaseUrl, {
      adminApiUrl: import.meta.env.VITE_INTEGRITAS_ADMIN_API_URL as string | undefined,
      controlApiUrl: import.meta.env.VITE_INTEGRITAS_CONTROL_API_URL as string | undefined,
    });
    return createIntegritasBrowserClient(urls);
  }, []);
  const selectedCase = useMemo(() => cases.find((item) => item.id === selectedCaseId) ?? null, [cases, selectedCaseId]);
  const runtimeReady = isInvestigationRuntimeReady(runtime);
  const startAllowed = canStartInvestigation({
    authenticated: !!token,
    hasCase: !!selectedCase,
    documentCount: documents.length,
    runtimeReady,
    busy,
    hasCurrentRevisionJob: !!(job && selectedCase && job.case_revision === selectedCase.revision),
  });
  const retryAllowed = !!token && !!browserClient && !!job && retryableInvestigationStages.has(job.stage) && !busy;
  const cancelAllowed = !!token && !!browserClient && !!job && !terminalInvestigationStages.has(job.stage) && !busy;
  const pauseAllowed = !!token && !!browserClient && !!job && job.stage !== 'paused' && !terminalInvestigationStages.has(job.stage) && !busy;
  const resumeAllowed = !!token && !!browserClient && !!job && job.stage === 'paused' && !busy;

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setToken(data.session?.access_token ?? null);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) setToken(session?.access_token ?? null);
    });
    return () => { mounted = false; data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!token || !browserClient) { setCases([]); setSelectedCaseId(''); return; }
    let cancelled = false;
    browserClient.listCases(token)
      .then((data) => {
        if (cancelled) return;
        const rows = data as CaseRow[];
        setCases(rows);
        setSelectedCaseId((current) => rows.some((row) => row.id === current) ? current : (rows[0]?.id ?? ''));
      })
      .catch((error) => {
        if (cancelled) return;
        setCases([]);
        setSelectedCaseId('');
        setNotice(error instanceof Error ? error.message : String(error));
      });
    return () => { cancelled = true; };
  }, [token, browserClient]);

  useEffect(() => {
    if (!token || !browserClient) { setRuntime(null); return; }
    let cancelled = false;
    const refresh = async () => {
      try {
        const runtimes = await browserClient.runtimeStatus(token);
        if (!cancelled) setRuntime((runtimes.find((item: RuntimeStatus) => item.worker_id === 'oracle-primary') ?? runtimes[0] ?? null) as RuntimeStatus | null);
      } catch {
        if (!cancelled) {
          // Preserve the last attested heartbeat across a transient network failure.
          // Readiness naturally expires once last_seen_at becomes stale.
          setRuntime((current) => current);
        }
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 30_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [token, browserClient]);

  useEffect(() => {
    if (!token || !supabase || !selectedCaseId) { setDocuments([]); setJob(null); setCaseJobs([]); return; }
    let cancelled = false;
    Promise.all([
      supabase.from('integritas_documents').select('id,case_id,name,created_at').eq('case_id', selectedCaseId).order('created_at'),
      supabase.from('integritas_case_jobs').select('id,case_id,case_revision,control_command_id,stage,progress,runtime_provider,depth,created_at,updated_at').eq('case_id', selectedCaseId).eq('runtime_provider', 'openclaw-oracle').order('created_at', { ascending: false }),
    ]).then(([documentResult, jobResult]) => {
      if (cancelled) return;
      if (documentResult.error) { setNotice(documentResult.error.message); return; }
      if (jobResult.error) { setNotice(jobResult.error.message); return; }
      setDocuments((documentResult.data ?? []) as DocumentRow[]);
      const rows = (jobResult.data ?? []) as JobRow[];
      setCaseJobs(rows);
      setJob((current) => rows.find((row) => row.id === current?.id) ?? rows[0] ?? null);
    });
    return () => { cancelled = true; };
  }, [token, selectedCaseId]);

  useEffect(() => {
    if (!token || !browserClient || !supabase || !job?.control_command_id || !selectedCaseId) {
      setCommandStatus('');
      setLiveCheckpoints([]);
      return;
    }
    const dataClient = supabase;
    let cancelled = false;
    const refresh = async () => {
      try {
        const [command, jobResult, checkpointResult] = await Promise.all([
          browserClient.commandStatus(token, job.control_command_id as string),
          dataClient.from('integritas_case_jobs')
            .select('id,case_id,case_revision,control_command_id,stage,progress,runtime_provider')
            .eq('id', job.id)
            .eq('case_id', selectedCaseId)
            .maybeSingle(),
          dataClient.from('integritas_case_job_checkpoints')
            .select('id,stage,progress,safe_metadata,created_at')
            .eq('case_id', selectedCaseId)
            .eq('case_job_id', job.id)
            .order('created_at'),
        ]);
        if (jobResult.error) throw jobResult.error;
        if (checkpointResult.error) throw checkpointResult.error;
        if (!cancelled) {
          setCommandStatus(String(command?.status ?? ''));
          if (jobResult.data) setJob(jobResult.data as JobRow);
          setLiveCheckpoints((checkpointResult.data ?? []) as CheckpointRow[]);
        }
      } catch (error) { if (!cancelled) setNotice(error instanceof Error ? error.message : String(error)); }
    };
    void refresh();
    const interval = window.setInterval(refresh, 5_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [token, browserClient, job?.id, job?.control_command_id, selectedCaseId]);

  useEffect(() => {
    if (!token || !supabase || !selectedCaseId || !job?.id) {
      setResults(null);
      return;
    }
    const dataClient = supabase;
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await loadPersistedInvestigationResults(dataClient, selectedCaseId, job.id);
        if (!cancelled) setResults(next);
      } catch (error) {
        if (!cancelled) {
          setResults(null);
          setNotice(error instanceof Error ? error.message : String(error));
        }
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 10_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [token, selectedCaseId, job?.id]);

  const sendMagicLink = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase || !isSupabaseConfigured) { setNotice('Supabase sign-in is not configured for this deployment.'); return; }
    const address = email.trim();
    if (!address) return;
    setBusy(true); setNotice('Sending secure sign-in link…');
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: address,
        options: {
          emailRedirectTo: getAuthRedirectUrl(import.meta.env.VITE_AUTH_REDIRECT_URL as string | undefined, window.location.href),
          shouldCreateUser: true,
        },
      });
      if (error) throw error;
      setNotice('Check your email and open the secure sign-in link on this device.');
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const signOut = async () => {
    if (!supabase) return;
    setBusy(true);
    try { await supabase.auth.signOut(); setNotice('Signed out.'); }
    finally { setBusy(false); }
  };

  const onFileSelection = (nextFiles: File[]) => {
    try {
      validateCaseDocumentSelection(documents.length, nextFiles);
      setFiles(nextFiles);
      setNotice('');
    } catch (error) {
      setFiles([]);
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const refreshSelectedCase = async () => {
    if (!supabase || !selectedCaseId) return;
    const [caseResult, documentResult, jobResult] = await Promise.all([
      supabase.from('integritas_cases').select('id,title,revision,created_at').eq('id', selectedCaseId).single(),
      supabase.from('integritas_documents').select('id,case_id,name,created_at').eq('case_id', selectedCaseId).order('created_at'),
      supabase.from('integritas_case_jobs').select('id,case_id,case_revision,control_command_id,stage,progress,runtime_provider,depth,created_at,updated_at').eq('case_id', selectedCaseId).eq('runtime_provider', 'openclaw-oracle').order('created_at', { ascending: false }),
    ]);
    if (caseResult.error) throw caseResult.error;
    if (documentResult.error) throw documentResult.error;
    if (jobResult.error) throw jobResult.error;
    setCases((current) => current.map((item) => item.id === selectedCaseId ? caseResult.data as CaseRow : item));
    setDocuments((documentResult.data ?? []) as DocumentRow[]);
    const rows = (jobResult.data ?? []) as JobRow[];
    setCaseJobs(rows);
    setJob((current) => rows.find((row) => row.id === current?.id) ?? rows[0] ?? null);
  };

  const uploadSelected = async () => {
    if (!token || !browserClient || !selectedCase || files.length === 0) return;
    setBusy(true); setNotice('Uploading evidence…');
    try {
      await browserClient.uploadFiles(token, selectedCase.id, documents.length, files);
      await refreshSelectedCase();
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setNotice('Evidence upload completed and case state refreshed.');
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const startInvestigation = async () => {
    if (!token || !browserClient || !selectedCase || !startAllowed) return;
    setBusy(true); setNotice('Queueing Oracle/OpenClaw investigation…');
    try {
      const idempotencyKey = `ui:${selectedCase.id}:rev:${selectedCase.revision}:depth:${depth}`;
      const investigation = await browserClient.startInvestigation(token, {
        caseId: selectedCase.id, caseRevision: selectedCase.revision, depth, idempotencyKey,
      });
      setJob({ id: investigation.case_job_id, case_id: selectedCase.id, case_revision: selectedCase.revision, control_command_id: investigation.control_command_id, stage: 'queued', progress: 0, runtime_provider: 'openclaw-oracle' });
      setLiveCheckpoints([]);
      setCommandStatus('queued');
      setNotice('Investigation queued. You can close this page; progress is durable server-side.');
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const retryInvestigation = async (targetJob = job) => {
    if (!token || !browserClient || !targetJob || !retryableInvestigationStages.has(targetJob.stage) || busy) return;
    setBusy(true); setNotice('Continuing from the last trustworthy checkpoint…');
    try {
      const investigation = await browserClient.retryInvestigation(token, targetJob.id);
      setJob((current) => current?.id === targetJob.id ? {
        ...current,
        stage: investigation?.stage ?? current.stage,
        progress: Number.isInteger(investigation?.progress) ? investigation.progress : current.progress,
      } : current);
      setCommandStatus('queued');
      await refreshSelectedCase();
      const resumeProgress = Number.isInteger(investigation?.progress) ? investigation.progress : null;
      setNotice(resumeProgress === null
        ? 'Investigation continuation queued. Valid completed work will be reused.'
        : `Investigation continuing from ${resumeProgress}%. Valid completed phases are reused; only missing or blocked work is rerun.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const cancelInvestigation = async () => {
    if (!token || !browserClient || !job || !cancelAllowed) return;
    setBusy(true); setNotice('Requesting investigation cancellation…');
    try {
      await browserClient.cancelInvestigation(token, job.id);
      await refreshSelectedCase();
      setNotice('Cancellation requested. The Oracle worker will stop at the next safe checkpoint.');
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const pauseInvestigation = async () => {
    if (!token || !browserClient || !job || !pauseAllowed) return;
    setBusy(true); setNotice('Pausing at the next durable checkpoint…');
    try {
      await browserClient.pauseInvestigation(token, job.id);
      await refreshSelectedCase();
      setNotice('Pause requested. Completed evidence and checkpoints remain preserved.');
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const resumeInvestigation = async () => {
    if (!token || !browserClient || !job || !resumeAllowed) return;
    setBusy(true); setNotice('Resuming from the latest durable checkpoint…');
    try {
      await browserClient.resumeInvestigation(token, job.id);
      await refreshSelectedCase();
      setNotice('Investigation resumed from its durable checkpoint.');
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const openReportPdf = async () => {
    if (!token || !browserClient || !job || pdfBusy) return;
    const popup = window.open('', '_blank', 'noopener,noreferrer');
    setPdfBusy(true);
    setNotice('Preparing the canonical server-rendered Integritas PDF…');
    try {
      const artifact = await browserClient.getReportPdfUrl(token, job.id);
      if (popup) popup.location.replace(artifact.url);
      else window.location.assign(artifact.url);
      setNotice(`Canonical PDF ready · ${Math.max(1, Math.round((artifact.sizeBytes || 0) / 1024))} KB · SHA-256 ${artifact.sha256.slice(0, 12)}…`);
    } catch (error) {
      if (popup) popup.close();
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setPdfBusy(false);
    }
  };

  const deleteDocument = async (document: DocumentRow) => {
    if (!token || !browserClient || !selectedCase || busy) return;
    if (!window.confirm(`Delete ${document.name}? This is permanent. Documents cited by a saved investigation are protected.`)) return;
    setBusy(true); setNotice('Removing private evidence and its case record…');
    try {
      await browserClient.deleteDocument(token, selectedCase.id, document.id);
      await refreshSelectedCase();
      setNotice('Document removed. The case revision was advanced to keep prior reports stale.');
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const activeStageIndex = investigationStages.findIndex(([key]) => key === job?.stage);
  const stageIndex = activeStageIndex < 0 && job ? investigationStages.length : Math.max(0, activeStageIndex);

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="Integritas navigation">
        <div className="brand">
          <span className="brand-mark">I</span>
          <div><strong>Integritas</strong><small>Private Command Center</small></div>
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
          <div><p className="eyebrow">Private Admin Workspace</p><h1>AI investigation control panel</h1></div>
          <ConfigurationHealth authenticated={!!token} runtimeReady={runtimeReady} />
        </header>

        {!token && (
          <form className="login-card" onSubmit={sendMagicLink}>
            <div><p className="eyebrow">Authorized analysts only</p><h2>Secure email sign-in</h2></div>
            <label htmlFor="admin-email">Email address</label>
            <input id="admin-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            <button type="submit" disabled={!isSupabaseConfigured || busy || !email.trim()}>Send secure sign-in link</button>
          </form>
        )}
        {token && <div className="session-actions"><button type="button" className="secondary" onClick={signOut} disabled={busy}>Sign out</button></div>}

        <section className="command-card" id="dashboard">
          <div>
            <p className="eyebrow">Case intake and investigation</p>
            <h2>Upload evidence, verify the bounded Oracle runtime, then start a durable OpenClaw investigation.</h2>
          </div>
          <div className="actions">
            <button type="button" className="secondary" disabled={!token || !selectedCase || busy} onClick={() => fileInputRef.current?.click()}>
              <UploadCloud size={18} />Upload evidence
            </button>
            <button type="button" disabled={!startAllowed} onClick={startInvestigation} title={runtimeReady ? 'Start bounded case investigation' : 'Requires attested Oracle/OpenClaw runtime'}>
              <Play size={18} />Start Deep Investigation
            </button>
          </div>
        </section>

        {notice && <div className="notice" role="status">{notice}</div>}

        <section className="workflow" aria-label="Investigation workflow">
          {['Case access', 'Evidence intake', 'Investigation', 'Analyst review', 'Report finalisation'].map((step, index) => (
            <div className="workflow-step" key={step}>
              <span>{index + 1}</span><strong>{step}</strong>
              <small>{index === 0 ? 'Server-gated' : 'Case-scoped'}</small>
            </div>
          ))}
        </section>

        <section className="grid">
          <article className="panel" id="cases">
            <div className="panel-head"><h2>Cases and documents</h2><span>{token ? 'Authenticated' : 'Authentication required'}</span></div>
            <p className="muted" id="documents">Uploads are private, SHA-256 deduplicated, revisioned, and capped at 20 documents per case.</p>
            <div className="evidence-intake">
              <label htmlFor="active-case">Active case</label>
              <select id="active-case" value={selectedCaseId} disabled={!token || cases.length === 0 || busy} onChange={(event) => setSelectedCaseId(event.target.value)}>
                {cases.length === 0 && <option value="">No assigned cases</option>}
                {cases.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
              <label htmlFor="case-documents">Case documents</label>
              <input ref={fileInputRef} id="case-documents" type="file" accept={SUPPORTED_CASE_FILE_ACCEPT} multiple disabled={!token || !selectedCase || busy} onChange={(event) => onFileSelection(Array.from(event.target.files ?? []))} />
              <small>Upload up to 20 documents per case. {documents.length}/20 are currently registered.</small>
              {documents.length > 0 && <ul className="document-list">{documents.map((document) => <li key={document.id}><span>{document.name}</span><button type="button" className="text-button" disabled={busy} onClick={() => deleteDocument(document)}>Delete</button></li>)}</ul>}
              <button type="button" className="secondary" disabled={!token || !selectedCase || files.length === 0 || busy} onClick={uploadSelected}>
                <UploadCloud size={18} />Upload selected documents
              </button>
            </div>
          </article>

          <article className="panel" id="investigation">
            <div className="panel-head"><h2>Investigation pipeline</h2><span>{job ? `${job.progress ?? 0}%` : 'Case-scoped'}</span></div>
            <ol className="pipeline">
              {investigationStages.map(([key, label], index) => {
                const state = !job ? 'waiting' : index < stageIndex ? 'done' : index === stageIndex ? 'active' : 'waiting';
                return <li key={key}><span className={`status-dot ${state}`} /><span>{label}</span><small>{state}</small></li>;
              })}
            </ol>
            {job && <p className="muted job-summary">Command status: {commandStatus || 'queued'} · provider: {job.runtime_provider}</p>}
            {job && (
              <div className="actions">
                {retryAllowed && <button type="button" className="secondary" onClick={() => void retryInvestigation()}>Continue investigation</button>}
                {pauseAllowed && <button type="button" className="secondary" onClick={pauseInvestigation}>Pause safely</button>}
                {resumeAllowed && <button type="button" className="secondary" onClick={resumeInvestigation}>Continue investigation</button>}
                {cancelAllowed && <button type="button" className="secondary" onClick={cancelInvestigation}>Cancel investigation</button>}
              </div>
            )}
          </article>

          {job && (
            <InvestigationMilestones
              checkpoints={liveCheckpoints.length > 0 ? liveCheckpoints : (results?.checkpoints ?? [])}
              checks={results?.checks ?? []}
              jobStage={job.stage}
              jobProgress={job.progress ?? 0}
            />
          )}

          <article className="panel wide" id="history-runs">
            <div className="panel-head"><h2>Previous investigations</h2><span>{caseJobs.length}</span></div>
            {caseJobs.length === 0 ? <p className="muted">No previous investigation runs for this case.</p> : (
              <ul className="run-history">
                {caseJobs.map((row) => (
                  <li key={row.id} className={row.id === job?.id ? 'selected' : undefined}>
                    <div><strong>{row.stage.replaceAll('_', ' ')}</strong><small>{row.depth ?? '—'} depth · revision {row.case_revision} · {row.progress}%</small></div>
                    <details className="run-menu"><summary aria-label={`Actions for investigation ${row.id}`}>•••</summary><div>
                      <button type="button" onClick={() => setJob(row)}>Open</button>
                      {retryableInvestigationStages.has(row.stage) && <button type="button" disabled={busy} onClick={() => { setJob(row); void retryInvestigation(row); }}>Continue from checkpoint</button>}
                    </div></details>
                  </li>
                ))}
              </ul>
            )}
          </article>

          {results && selectedCase && job ? (
            <InvestigationResultsView
              results={results}
              caseRevision={selectedCase.revision}
              job={{ case_revision: job.case_revision, stage: job.stage }}
              onOpenPdf={() => { void openReportPdf(); }}
              pdfBusy={pdfBusy}
            />
          ) : (
            <article className="panel" id="entities">
              <div className="panel-head"><h2>Persisted investigation results</h2><span>Awaiting results</span></div>
              <p className="muted">Structured entities, findings, evidence, checks, and the draft report will appear here from Supabase after the bounded investigation persists them.</p>
            </article>
          )}

          <article className="panel" id="jobs">
            <div className="panel-head"><h2>OpenClaw due-diligence runner</h2><span>{runtimeReady ? 'Ready' : 'Preflight required'}</span></div>
            <p className="muted">The panel dispatches only typed, case-scoped jobs. The OpenClaw gateway remains private and no browser-exposed shell is used.</p>
            <div className="runtime-summary">
              <strong>{runtime?.worker_id ?? 'Oracle worker unavailable'}</strong>
              <small>Worker {runtime?.worker_version ?? '—'} · OpenClaw {runtime?.openclaw_status ?? 'unknown'}</small>
            </div>
            <label htmlFor="investigation-depth">Investigation depth</label>
            <select id="investigation-depth" value={depth} disabled={!token || busy} onChange={(event) => setDepth(event.target.value as InvestigationDepth)}>
              <option value="fast">Fast</option><option value="standard">Standard</option><option value="deep">Deep</option><option value="maximum">Maximum appropriate depth</option>
            </select>
            <ul className="checks compact-checks">{openClawPreflight.map((check) => <li key={check}>{check}</li>)}</ul>
          </article>

          <article className="panel wide" id="audit-boundary">
            <div className="panel-head"><h2>Control and audit boundary</h2><span>Approval-gated</span></div>
            <ul className="checks">
              <li>All case access, investigation actions, and reports are authorised server-side.</li>
              <li>New evidence changes the case revision and stale revisions cannot start an investigation.</li>
              <li>Infrastructure controls use typed, audited commands—not a browser-exposed shell.</li>
              <li>Reports remain review-gated; production publication and PR merge remain separate controls.</li>
            </ul>
          </article>
        </section>
      </section>
    </main>
  );
}
