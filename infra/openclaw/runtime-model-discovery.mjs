import { readFile, rename, writeFile } from 'node:fs/promises';

const CACHE_PATH = '/var/lib/openclaw/integritas-model-discovery-cache.json';
const MAX_CACHE_MODELS = 1000;
const CATALOG_TIMEOUT_MS = 8000;
const MAX_COOLDOWN_MS = 15 * 60 * 1000;

const PROVIDERS = Object.freeze([
  { id: 'nvidia', env: 'NVIDIA_API_KEY', endpoint: 'https://integrate.api.nvidia.com/v1/models' },
  { id: 'openrouter', env: 'OPENROUTER_API_KEY', endpoint: 'https://openrouter.ai/api/v1/models' },
  { id: 'opencode-zen', env: 'OPENCODE_ZEN_API_KEY', endpoint: 'https://opencode.ai/zen/v1/models' },
  { id: 'groq', env: 'GROQ_API_KEY', endpoint: 'https://api.groq.com/openai/v1/models' },
]);

const runtime = {
  catalogs: new Map(),
  cooldowns: new Map(),
  summary: null,
};

function providerIdForModel(model) {
  const value = String(model || '');
  if (value.startsWith('integritas-nvidia/') || value.startsWith('nvidia/')) return 'nvidia';
  if (value.startsWith('integritas-openrouter/')) return 'openrouter';
  if (value.startsWith('integritas-opencode-zen/')) return 'opencode-zen';
  if (value.startsWith('integritas-groq/')) return 'groq';
  return null;
}

function providerModelId(model, providerId) {
  const value = String(model || '');
  if (providerId === 'nvidia') return value.replace(/^integritas-nvidia\//, '').replace(/^nvidia\//, '');
  if (providerId === 'openrouter') return value.replace(/^integritas-openrouter\//, '');
  if (providerId === 'opencode-zen') return value.replace(/^integritas-opencode-zen\//, '');
  if (providerId === 'groq') return value.replace(/^integritas-groq\//, '');
  return value;
}

function safeError(error) {
  return String(error?.message ?? error ?? 'unknown').replace(/\s+/g, ' ').slice(0, 240);
}

async function readPreviousCache() {
  try {
    const value = JSON.parse(await readFile(CACHE_PATH, 'utf8'));
    return value && typeof value === 'object' ? value : { providers: {} };
  } catch {
    return { providers: {} };
  }
}

async function persistCache(cache) {
  const temporary = CACHE_PATH + '.tmp-' + process.pid;
  try {
    await writeFile(temporary, JSON.stringify(cache) + '\n', { mode: 0o600 });
    await rename(temporary, CACHE_PATH);
  } catch {
    // Catalog discovery is advisory. A cache failure must never block a case.
  }
}

async function fetchCatalog(spec, apiKey, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
  try {
    const headers = {
      Authorization: 'Bearer ' + apiKey,
      Accept: 'application/json',
      'User-Agent': 'Integritas-model-discovery/1.0',
    };
    if (spec.id === 'openrouter') {
      headers['HTTP-Referer'] = 'https://integritass.com';
      headers['X-Title'] = 'Integritas';
    }
    const response = await fetchImpl(spec.endpoint, { headers, signal: controller.signal });
    if (!response.ok) throw new Error('catalog HTTP ' + response.status);
    const payload = await response.json();
    const rows = Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : Array.isArray(payload)
          ? payload
          : [];
    const models = [...new Set(rows
      .map((row) => typeof row === 'string' ? row : row?.id)
      .filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 240))]
      .slice(0, MAX_CACHE_MODELS)
      .sort();
    if (!models.length) throw new Error('catalog returned no model identifiers');
    return models;
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverProviderModels({
  jobDir,
  synthetic = false,
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  runtime.catalogs.clear();
  runtime.cooldowns.clear();
  const refreshedAt = new Date().toISOString();
  if (synthetic) {
    runtime.summary = {
      schema_version: 1,
      refreshed_at: refreshedAt,
      status: 'skipped_synthetic',
      providers: [],
    };
    return runtime.summary;
  }

  const previous = await readPreviousCache();
  const providerRows = await Promise.all(PROVIDERS.map(async (spec) => {
    const apiKey = env[spec.env];
    if (!apiKey) {
      return {
        provider: spec.id,
        status: 'not_configured',
        models: [],
        model_count: 0,
        new_count: 0,
        removed_count: 0,
      };
    }
    try {
      const models = await fetchCatalog(spec, apiKey, fetchImpl);
      runtime.catalogs.set(spec.id, new Set(models));
      const prior = Array.isArray(previous?.providers?.[spec.id]?.models)
        ? previous.providers[spec.id].models
        : [];
      const priorSet = new Set(prior);
      const nextSet = new Set(models);
      return {
        provider: spec.id,
        status: 'ready',
        models,
        model_count: models.length,
        new_count: models.filter((id) => !priorSet.has(id)).length,
        removed_count: prior.filter((id) => !nextSet.has(id)).length,
      };
    } catch (error) {
      return {
        provider: spec.id,
        status: 'degraded',
        models: [],
        model_count: 0,
        new_count: 0,
        removed_count: 0,
        error: safeError(error),
      };
    }
  }));

  runtime.summary = {
    schema_version: 1,
    refreshed_at: refreshedAt,
    status: 'complete',
    providers: providerRows.map((row) => ({
      provider: row.provider,
      status: row.status,
      model_count: row.model_count,
      new_count: row.new_count,
      removed_count: row.removed_count,
      ...(row.error ? { error: row.error } : {}),
    })),
  };

  const cache = {
    schema_version: 1,
    refreshed_at: refreshedAt,
    providers: Object.fromEntries(providerRows
      .filter((row) => row.status === 'ready')
      .map((row) => [row.provider, { models: row.models, refreshed_at: refreshedAt }])),
  };
  await persistCache(cache);

  if (jobDir) {
    try {
      await writeFile(
        jobDir + '/model-discovery.json',
        JSON.stringify({ ...runtime.summary, catalogs: cache.providers }, null, 2) + '\n',
        { mode: 0o640 },
      );
    } catch {
      // Continue with the configured allowlist when the optional artifact fails.
    }
  }
  return runtime.summary;
}

export function getModelDiscoverySummary() {
  return runtime.summary;
}

export function modelAllowedByDiscovery(model) {
  const providerId = providerIdForModel(model);
  if (!providerId) return true;
  const catalog = runtime.catalogs.get(providerId);
  if (!catalog || catalog.size === 0) return true;
  const id = providerModelId(model, providerId);
  if (providerId === 'openrouter' && id === 'openrouter/free') return true;
  return catalog.has(id);
}

export function providerCooldownRemainingMs(modelOrProvider) {
  const providerId = PROVIDERS.some((row) => row.id === modelOrProvider)
    ? modelOrProvider
    : providerIdForModel(modelOrProvider);
  if (!providerId) return 0;
  return Math.max(0, Number(runtime.cooldowns.get(providerId) || 0) - Date.now());
}

export function noteProviderFailure(modelOrProvider, error) {
  const providerId = PROVIDERS.some((row) => row.id === modelOrProvider)
    ? modelOrProvider
    : providerIdForModel(modelOrProvider);
  if (!providerId) return 0;
  const message = String(error?.message ?? error ?? '');
  const retryMatch = message.match(/retry-after[=: ]+(\d+)/i);
  const rateLimited = /\b429\b|rate.?limit|quota/i.test(message);
  const capacity = /\b5\d\d\b|capacity|temporarily unavailable|timeout|timed out/i.test(message);
  if (!rateLimited && !capacity) return 0;
  const seconds = retryMatch
    ? Math.max(1, Math.min(Number(retryMatch[1]), MAX_COOLDOWN_MS / 1000))
    : rateLimited ? 60 : 20;
  const until = Date.now() + seconds * 1000;
  runtime.cooldowns.set(providerId, Math.max(Number(runtime.cooldowns.get(providerId) || 0), until));
  return seconds * 1000;
}
