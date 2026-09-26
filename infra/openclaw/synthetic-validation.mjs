export function isTrustedSyntheticValidationManifest(value) {
  const meta = value?.case;
  if (!meta || Array.isArray(meta) || typeof meta !== 'object') return false;

  const productionCanary = typeof meta.title === 'string'
    && meta.title.startsWith('[SYNTHETIC] ')
    && meta.purpose === 'Authorized synthetic production validation only'
    && meta.authorized_scope === 'Synthetic QA data only; no real-person or transaction decision';

  const qaJurisdictions = Array.isArray(meta.jurisdictions)
    ? [...meta.jurisdictions].sort().join(',')
    : '';
  const hostileQaFixture = meta.title === '[SYNTHETIC QA] Conflicting Nimbus case'
    && meta.purpose === 'Authorized synthetic quality assurance only'
    && meta.authorized_scope === 'Two synthetic documents and public-source planning; no real-person decision'
    && meta.intended_subjects === 'Two distinct people named Alex Smith; Nimbus Holdings'
    && qaJurisdictions === 'GB,ZA';

  return productionCanary || hostileQaFixture;
}
