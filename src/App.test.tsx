import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('Integritas Command Center', () => {
  it('renders the private case workflow without fabricating case data or OpenClaw readiness', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: /AI investigation control panel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start Deep Investigation/i })).toBeDisabled();
    expect(screen.getByRole('link', { name: /Evidence & Sources/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Unresolved Checks/i })).toBeInTheDocument();
    expect(screen.getByText(/SHA-256 deduplicated/i)).toBeInTheDocument();
    expect(screen.getByText(/OpenClaw due-diligence runner/i)).toBeInTheDocument();
    expect(screen.getByText(/Preflight required/i)).toBeInTheDocument();
    expect(screen.getByText(/does not expose the gateway or an arbitrary shell/i)).toBeInTheDocument();
    expect(screen.queryByText('INT-001')).not.toBeInTheDocument();
  });
});
