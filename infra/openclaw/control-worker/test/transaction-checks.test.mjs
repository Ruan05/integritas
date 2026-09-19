import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ibanChecksum, imoChecksum, bicFormat, buildDeterministicChecks,
} from '../transaction-checks.mjs';

test('IBAN mod-97 catches the historical Shell-style invalid account and accepts a valid control', () => {
  const invalid = ibanChecksum('NL91ABNA0793164363');
  assert.equal(invalid.mod97_remainder, 35);
  assert.equal(invalid.checksum_valid, false);

  const valid = ibanChecksum('GB82 WEST 1234 5698 7654 32');
  assert.equal(valid.mod97_remainder, 1);
  assert.equal(valid.checksum_valid, true);
});

test('IMO checksum requires an explicit IMO label and validates the check digit', () => {
  assert.equal(imoChecksum('9776547'), null, 'bare seven-digit identifiers must not be assumed to be vessels');
  assert.equal(imoChecksum('company RC 1093130'), null);
  assert.deepEqual(imoChecksum('IMO 9776547'), {
    value: 'IMO9776547',
    calculated_check_digit: 7,
    checksum_valid: true,
  });
  assert.equal(imoChecksum('IMO 9776541').checksum_valid, false);
});

test('BIC validation is explicitly format-only', () => {
  const result = bicFormat('ABNANL2A');
  assert.equal(result.value, 'ABNANL2A');
  assert.equal(result.format_valid, true);
  assert.match(result.note, /does not establish/i);
  assert.equal(bicFormat('not-a-bic'), null);
});

test('transaction checks preserve document provenance and detect repeated candidate identifiers', () => {
  const plan = {
    document_profiles: [
      {
        document_id: '11111111-1111-4111-8111-111111111111',
        material_identifiers: ['NL91ABNA0793164363', 'CI 4957/1802590', 'IMO 9776547', 'ABNANL2A'],
      },
      {
        document_id: '22222222-2222-4222-8222-222222222222',
        material_identifiers: ['CI-4957-1802590'],
      },
    ],
  };
  const result = buildDeterministicChecks(plan);
  assert.equal(result.tool, 'integritas_transaction_checks_v1');
  assert.equal(result.iban_checks.length, 1);
  assert.equal(result.imo_checks.length, 1);
  assert.equal(result.bic_format_checks.length, 1);
  assert.deepEqual(result.repeated_identifier_candidates, [{
    normalized_value: 'CI49571802590',
    document_ids: [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ],
  }]);
});
