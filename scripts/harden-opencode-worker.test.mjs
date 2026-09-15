import {test} from 'node:test';
import assert from 'node:assert/strict';
import {harden, evidenceBoundary} from './harden-opencode-worker.mjs';

test('reject unexpected deployment shape without partial output', () => {
  assert.throws(() => harden([]), /missing/);
  assert.throws(() => harden([{name:'worker.ts',content:''},{name:'index.ts',content:''}]), /Baseline mismatch/);
});

test('capability instruction distinguishes inference from tool execution', () => {
  assert.match(evidenceBoundary, /model inference only/);
  assert.match(evidenceBoundary, /Missing evidence stays unresolved/);
});
