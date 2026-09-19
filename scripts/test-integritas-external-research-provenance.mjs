import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/0014_integritas_external_research_provenance.sql', 'utf8');
const control = readFileSync('supabase/functions/integritas-control/index.ts', 'utf8');
const worker = readFileSync('infra/openclaw/control-worker/src/investigation.mjs', 'utf8');

assert.match(migration, /openclaw_external_research/, 'migration must link only trusted OpenClaw research provenance');
assert.match(migration, /safe_metadata->>'source_key'/, 'source key must bind provenance');
assert.match(migration, /safe_metadata->>'url'/, 'URL must bind provenance');
assert.match(control, /worker_register_research_source/, 'bounded worker provenance action required');
assert.match(control, /integritas_tool_invocations/, 'control plane must persist provenance');
assert.match(worker, /readObservedResearchSummary/, 'worker must inspect OpenClaw observed tool summary');
assert.match(worker, /web_search.*web_fetch.*browser/s, 'worker must accept only research-capable tools');
console.log('Integritas external research provenance contract checks passed');
