import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

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
