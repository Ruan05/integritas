import test from 'node:test';
import assert from 'node:assert/strict';
import { isTrustedSyntheticValidationManifest } from '../../synthetic-validation.mjs';

const trusted = {
  case: {
    title: '[SYNTHETIC] OpenClaw one-document canary',
    purpose: 'Authorized synthetic production validation only',
    authorized_scope: 'Synthetic QA data only; no real-person or transaction decision',
  },
};

test('recognizes only explicitly trusted synthetic production-validation metadata', () => {
  assert.equal(isTrustedSyntheticValidationManifest(trusted), true);
  assert.equal(isTrustedSyntheticValidationManifest({
    case: { ...trusted.case, title: 'Real counterparty investigation' },
  }), false);
  assert.equal(isTrustedSyntheticValidationManifest({
    case: { ...trusted.case, purpose: 'Customer due diligence' },
  }), false);
  assert.equal(isTrustedSyntheticValidationManifest({
    case: { ...trusted.case, authorized_scope: 'Synthetic-looking label on a real case' },
  }), false);
  assert.equal(isTrustedSyntheticValidationManifest({ case: null }), false);
});
