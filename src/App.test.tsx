import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App, InvestigationResultsView } from './App';

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
    expect(screen.getByText((_, element) => element?.textContent === '# Draft report\nEvidence only.')).toBeInTheDocument();
  });

  it('surfaces terminal failure/cancel states from durable job state', () => {
    render(<InvestigationResultsView results={results} caseRevision={2} job={{ case_revision: 2, stage: 'failed' }} />);
    expect(screen.getByText(/investigation failed/i)).toBeInTheDocument();
    expect(screen.getByText(/registry timeout/i)).toBeInTheDocument();
  });
});
