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
    const iban = ibanChecksum(candidate.value);
    if (iban) ibans.push({ document_id: candidate.document_id, ...iban });
    const imo = imoChecksum(candidate.value);
    if (imo) imoNumbers.push({ document_id: candidate.document_id, ...imo });
    const bic = bicFormat(candidate.value);
    if (bic) bicCandidates.push({ document_id: candidate.document_id, ...bic });
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
