import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('Integritas Command Center', () => {
  it('renders the investigation workspace and primary action', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: /AI investigation control panel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start Deep Investigation/i })).toBeInTheDocument();
    expect(screen.getByText(/RLS policies for every Integritas table/i)).toBeInTheDocument();
  });
});
