export function isTrustedSyntheticValidationManifest(value) {
  const meta = value?.case;
  return !!meta && !Array.isArray(meta) && typeof meta === 'object'
    && typeof meta.title === 'string' && meta.title.startsWith('[SYNTHETIC] ')
    && meta.purpose === 'Authorized synthetic production validation only'
    && meta.authorized_scope === 'Synthetic QA data only; no real-person or transaction decision';
}
