import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('Integritas Command Center', () => {
  it('renders a server-gated investigation workspace without fabricated case data', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: /AI investigation control panel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start Deep Investigation/i })).toBeDisabled();
    expect(screen.getByText(/No case data is loaded in this preview/i)).toBeInTheDocument();
    expect(screen.queryByText('INT-001')).not.toBeInTheDocument();
  });
});
