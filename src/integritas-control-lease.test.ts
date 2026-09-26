import { describe, expect, it } from 'vitest';
import { normalizeLeaseCommand } from '../supabase/functions/integritas-control/lease';

describe('normalizeLeaseCommand', () => {
  it('treats an all-null composite row as an empty queue', () => {
    expect(normalizeLeaseCommand({
      id: null,
      command_type: null,
      payload: null,
      status: null,
    })).toBeNull();
  });

  it('preserves a valid leased command', () => {
    const command = {
      id: '11111111-1111-4111-8111-111111111111',
      command_type: 'health',
      payload: {},
    };
    expect(normalizeLeaseCommand([command])).toEqual(command);
  });
});
