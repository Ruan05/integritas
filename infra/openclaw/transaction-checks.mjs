function normalizeCandidate(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function ibanChecksum(candidate) {
  const value = normalizeCandidate(candidate);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(value)) return null;
  const rotated = value.slice(4) + value.slice(0, 4);
  let remainder = 0;
  for (const ch of rotated) {
    const digits = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return { value, mod97_remainder: remainder, checksum_valid: remainder === 1 };
}

export function imoChecksum(candidate) {
  const raw = String(candidate ?? '');
  const match = raw.match(/\bIMO\s*[:#-]?\s*([0-9]{7})\b/i);
  if (!match) return null;
  const value = match[1];
  const digits = [...value].map(Number);
  const checksum = digits.slice(0, 6).reduce((sum, digit, index) => sum + digit * (7 - index), 0) % 10;
  return { value: `IMO${value}`, calculated_check_digit: checksum, checksum_valid: checksum === digits[6] };
}

export function bicFormat(candidate) {
  const value = normalizeCandidate(candidate);
  if (!/^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(value)) return null;
  return {
    value,
    format_valid: true,
    note: 'Format only; this does not establish that the bank, branch, account, beneficiary or transaction instruction is genuine.',
  };
}

function structuralCandidateFragments(value) {
  const raw = String(value ?? '').trim();
  const fragments = [raw];
  const compactIban = raw.match(/\b[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}\b/gi) ?? [];
  fragments.push(...compactIban);
  const bic = raw.match(/(?:SWIFT(?:\/BIC)?|BIC)[\s:;=/-]*(?:VALUE[\s:;=-]*)?([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)/i);
  if (bic?.[1]) fragments.push(bic[1]);
  return [...new Set(fragments.filter(Boolean))];
}

export function buildDeterministicChecks(plan) {
  const candidates = [];
  for (const profile of plan?.document_profiles ?? []) {
    for (const value of profile?.material_identifiers ?? []) {
      candidates.push({ document_id: profile.document_id, value });
    }
  }
  const ibans = [];
  const imoNumbers = [];
  const bicCandidates = [];
  const repeated = new Map();
  for (const candidate of candidates) {
    const normalized = normalizeCandidate(candidate.value);
    if (normalized.length >= 6) {
      const rows = repeated.get(normalized) ?? [];
      rows.push(candidate.document_id);
      repeated.set(normalized, rows);
    }
    for (const fragment of structuralCandidateFragments(candidate.value)) {
      const iban = ibanChecksum(fragment);
      // A structural result is about the candidate value, not every document in
      // which that value appears. Cross-document repetition is retained below.
      if (iban && !ibans.some((row) => row.value === iban.value)) {
        ibans.push({ document_id: candidate.document_id, ...iban });
      }
      const bic = bicFormat(fragment);
      if (bic && !bicCandidates.some((row) => row.value === bic.value)) {
        bicCandidates.push({ document_id: candidate.document_id, ...bic });
      }
    }
    const imo = imoChecksum(candidate.value);
    if (imo && !imoNumbers.some((row) => row.value === imo.value)) {
      imoNumbers.push({ document_id: candidate.document_id, ...imo });
    }
  }
  return {
    schema_version: 1,
    tool: 'integritas_transaction_checks_v1',
    derived_from: 'planner-extracted candidate identifiers; verify candidate extraction against submitted evidence before relying on a result',
    iban_checks: ibans.slice(0, 100),
    imo_checks: imoNumbers.slice(0, 100),
    bic_format_checks: bicCandidates.slice(0, 100),
    repeated_identifier_candidates: [...repeated.entries()]
      .filter(([, ids]) => new Set(ids).size > 1)
      .slice(0, 100)
      .map(([normalized_value, ids]) => ({
        normalized_value,
        document_ids: [...new Set(ids)],
      })),
  };
}

function documentSourceKey(documentId) {
  return `doc.${String(documentId).replaceAll('-', '')}`;
}

/** Promote deterministic structural checks into the canonical evidence ledger.
 * These records prove only the computation performed on a candidate extracted
 * from submitted evidence; they never establish ownership, authority or authenticity.
 */
export function applyDeterministicChecksToBundle(bundle, deterministicChecks) {
  if (!bundle || typeof bundle !== 'object') throw new Error('bundle is required');
  if (!Array.isArray(bundle.findings)) bundle.findings = [];
  if (!Array.isArray(bundle.checks)) bundle.checks = [];
  const findingKeys = new Set(bundle.findings.map((row) => row?.finding_key).filter(Boolean));
  const findingClaims = new Set(bundle.findings.map((row) => row?.claim).filter((claim) => typeof claim === 'string' && claim.length > 0));
  const checkKeys = new Set(bundle.checks.map((row) => row?.check_key).filter(Boolean));
  const add = ({ key, checkType, claim, materiality, sourceKey, outcome }) => {
    const findingKey = `deterministic.${key}`.slice(0, 128);
    const checkKey = `deterministic.${key}.check`.slice(0, 128);
    if (!findingKeys.has(findingKey) && !findingClaims.has(claim)) {
      bundle.findings.push({
        finding_key: findingKey,
        entity_key: null,
        finding_type: checkType,
        claim,
        evidence_status: 'verified',
        materiality,
        reliability: 'high',
        evidence_excerpt: outcome,
        source_keys: [sourceKey],
      });
      findingKeys.add(findingKey);
      findingClaims.add(claim);
    }
    if (!checkKeys.has(checkKey)) {
      bundle.checks.push({
        check_key: checkKey,
        entity_key: null,
        check_type: checkType,
        description: claim,
        priority: materiality === 'critical' ? 'critical' : materiality === 'high' ? 'high' : 'medium',
        required_source: 'Submitted evidence candidate plus deterministic structural calculation',
        status: 'complete',
        outcome,
      });
      checkKeys.add(checkKey);
    }
  };
  for (const [index, row] of (deterministicChecks?.iban_checks ?? []).entries()) {
    add({
      key: `iban.${String(index + 1).padStart(2, '0')}`,
      checkType: 'iban_checksum',
      claim: `Submitted IBAN candidate ${row.value} has ISO 13616 mod-97 remainder ${row.mod97_remainder}; structural checksum is ${row.checksum_valid ? 'valid' : 'invalid'}.`,
      materiality: row.checksum_valid ? 'medium' : 'high',
      sourceKey: documentSourceKey(row.document_id),
      outcome: `Deterministic mod-97 computation returned ${row.mod97_remainder}. A valid IBAN requires remainder 1. This structural result does not establish account ownership or transaction authenticity.`,
    });
  }
  for (const [index, row] of (deterministicChecks?.imo_checks ?? []).entries()) {
    add({
      key: `imo.${String(index + 1).padStart(2, '0')}`,
      checkType: 'imo_checksum',
      claim: `Submitted IMO candidate ${row.value} has a ${row.checksum_valid ? 'valid' : 'invalid'} check digit.`,
      materiality: row.checksum_valid ? 'medium' : 'high',
      sourceKey: documentSourceKey(row.document_id),
      outcome: `Calculated IMO check digit ${row.calculated_check_digit}; checksum validity ${row.checksum_valid}. This does not establish vessel ownership, control, nomination or cargo linkage.`,
    });
  }
  for (const [index, row] of (deterministicChecks?.bic_format_checks ?? []).entries()) {
    add({
      key: `bic.${String(index + 1).padStart(2, '0')}`,
      checkType: 'bic_format',
      claim: `Submitted BIC/SWIFT candidate ${row.value} matches structural BIC format.`,
      materiality: 'informational',
      sourceKey: documentSourceKey(row.document_id),
      outcome: row.note,
    });
  }
  return bundle;
}
