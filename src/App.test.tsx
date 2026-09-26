import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App, InvestigationResultsView } from './App';
import { InvestigationMilestones } from './InvestigationMilestones';

describe('Integritas Command Center', () => {
  it('renders the private case workflow without fabricating case data or OpenClaw readiness', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /AI investigation control panel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start Deep Investigation/i })).toBeDisabled();
    expect(screen.getByRole('link', { name: /Evidence & Sources/i })).toBeInTheDocument();
    expect(screen.getByText(/OpenClaw due-diligence runner/i)).toBeInTheDocument();
    expect(screen.queryByText('INT-001')).not.toBeInTheDocument();
  });

  it('exposes a case-scoped multiple-document intake capped at 20 files', () => {
    render(<App />);
    const input = screen.getByLabelText(/case documents/i) as HTMLInputElement;
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe('.pdf,.txt,.md,.csv');
    expect(screen.getByText(/up to 20 documents/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload selected documents/i })).toBeDisabled();
  });

  it('offers magic-link sign-in while unauthenticated', () => {
    render(<App />);
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send secure sign-in link/i })).toBeInTheDocument();
  });
});

describe('live investigation milestone presentation', () => {
  it('shows worker-driven submodules and truthful active-run progress', () => {
    render(
      <InvestigationMilestones
        jobStage="cross_checking"
        jobProgress={60}
        checkpoints={[{
          id: 'cp-1', stage: 'cross_checking', progress: 60, created_at: '2026-09-19T20:00:00Z',
          safe_metadata: {
            milestones: [
              { id: 'core.research', label: 'External and browser research', status: 'complete', priority: 'high' },
              { id: 'module.research_lanes', label: 'Bounded parallel specialist research', status: 'active', priority: 'medium' },
            ],
            phase: 'large_research_lanes',
            message: 'Lane 5 of 9 is collecting authoritative sources.',
            current_task: {
              id: 'lane.core.corporate_identity',
              label: 'Verify corporate identity',
              status: 'active',
              detail: 'Opening authoritative registry sources.',
            },
            live_events: [{
              id: 'evt-1',
              category: 'FILE DISCOVERY',
              message: 'Submitted file names a corporate counterparty — verification is underway.',
              state: 'discovery',
              at: '2026-09-19T20:00:00Z',
            }],
            model_discovery: {
              status: 'complete',
              refreshed_at: '2026-09-19T19:59:55Z',
              providers: [
                { provider: 'nvidia', status: 'ready', model_count: 8, new_count: 1, removed_count: 0 },
                { provider: 'openrouter', status: 'ready', model_count: 20, new_count: 2, removed_count: 1 },
              ],
            },
          },
        }]}
        checks={[]}
      />,
    );
    expect(screen.getByRole('heading', { name: /^live investigation$/i })).toBeInTheDocument();
    expect(screen.getByText('Bounded parallel specialist research')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Verify corporate identity' })).toBeInTheDocument();
    expect(screen.getByText('FILE DISCOVERY')).toBeInTheDocument();
    expect(screen.getByText(/Submitted file names a corporate counterparty/i)).toBeInTheDocument();
    expect(screen.getByText(/2 providers ready/i)).toBeInTheDocument();
    expect(screen.getByText(/28 models discovered/i)).toBeInTheDocument();
    expect(screen.getByText(/60% live progress/i)).toBeInTheDocument();
    expect(screen.getAllByText('Complete').length).toBeGreaterThan(0);
    expect(screen.getAllByText('In progress').length).toBeGreaterThan(0);
  });
});

describe('persisted investigation result presentation', () => {
  const results = {
    checkpoints: [{ id: 'cp-1', stage: 'failed', progress: 72, safe_metadata: { message: 'Registry timeout' }, created_at: '2026-09-18T00:00:00Z' }],
    entities: [
      { id: 'e-1', entity_key: 'person-a', entity_type: 'person', display_name: 'Same Name', match_status: 'verified', match_confidence: 95, identifiers: { passport: 'A1' }, aliases: [] },
      { id: 'e-2', entity_key: 'person-b', entity_type: 'person', display_name: 'Same Name', match_status: 'verified', match_confidence: 93, identifiers: { passport: 'B2' }, aliases: [] },
    ],
    relationships: [],
    findings: [{ id: 'f-1', finding_key: 'finding-a', finding_type: 'identity', claim: 'Verified identity claim', evidence_status: 'verified', materiality: 'medium', reliability: 'high', source_ids: ['s-1'] }],
    sources: [{ id: 's-1', source_key: 'src-1', source_type: 'document', title: 'Official registry', excerpt: 'Registry extract', reliability_note: 'Primary source' }],
    sourceLinks: [{ finding_id: 'f-1', source_id: 's-1' }],
    checks: [{ id: 'c-1', check_key: 'unresolved:manual-1', check_type: 'unresolved', description: 'Manual registry follow-up', status: 'blocked', outcome: 'Retry registry' }],
    report: { id: 'r-1', status: 'draft', based_on_revision: 2, summary: 'Draft summary', content_markdown: '# Draft report\nEvidence only.', limitations: 'Registry unavailable' },
    auditEvents: [{ id: 1, event_type: 'investigation_bundle_committed', created_at: '2026-09-18T00:01:00Z', safe_metadata: {} }],
  } as any;

  it('renders source-linked findings and keeps same-name entities distinct', () => {
    render(<InvestigationResultsView results={results} caseRevision={2} job={{ case_revision: 2, stage: 'completed' }} />);
    expect(screen.getAllByText('Same Name')).toHaveLength(2);
    expect(screen.getByText('person-a')).toBeInTheDocument();
    expect(screen.getByText('person-b')).toBeInTheDocument();
    expect(screen.getByText('Verified identity claim')).toBeInTheDocument();
    expect(screen.getByText('Official registry')).toBeInTheDocument();
  });

  it('marks stale draft reports and unresolved checks clearly', () => {
    render(<InvestigationResultsView results={results} caseRevision={3} job={{ case_revision: 2, stage: 'completed' }} />);
    expect(screen.getByText(/stale report/i)).toBeInTheDocument();
    expect(screen.getByText(/manual registry follow-up/i)).toBeInTheDocument();
    expect(screen.getByText('draft', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Draft report' })).toBeInTheDocument();
    expect(screen.getByText('Evidence only.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open canonical integritas pdf/i })).toBeDisabled();
  });

  it('surfaces terminal failure/cancel states from durable job state', () => {
    render(<InvestigationResultsView results={results} caseRevision={2} job={{ case_revision: 2, stage: 'failed' }} />);
    expect(screen.getByText(/investigation failed/i)).toBeInTheDocument();
    expect(screen.getByText(/registry timeout/i)).toBeInTheDocument();
  });

  it('keeps an incomplete investigation separate from a successfully committed draft PDF', () => {
    const incompleteWithPdf = {
      ...results,
      checkpoints: [{
        id: 'cp-pdf',
        stage: 'incomplete',
        progress: 100,
        safe_metadata: { render_status: 'ready', message: 'Unresolved verification gates remain.' },
        created_at: '2026-09-18T00:02:00Z',
      }],
    } as any;
    render(
      <InvestigationResultsView
        results={incompleteWithPdf}
        caseRevision={2}
        job={{ case_revision: 2, stage: 'incomplete' }}
        onOpenPdf={() => {}}
      />,
    );
    expect(screen.getByText(/draft report ready — analyst review required/i)).toBeInTheDocument();
    expect(screen.getByText(/private PDF artifact is ready/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open draft integritas pdf/i })).toBeEnabled();
  });
});
