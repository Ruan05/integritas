import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const migration = readFileSync('supabase/migrations/0007_integritas_document_limit.sql', 'utf8');
const rollback = readFileSync('supabase/rollback/0007_integritas_document_limit.rollback.sql', 'utf8');
const privilegeMigration = readFileSync('supabase/migrations/0008_integritas_document_limit_privileges.sql', 'utf8');

assert.match(migration, /pg_advisory_xact_lock/, 'document ceiling must serialize concurrent inserts per case');
assert.match(migration, /count\(\*\).*integritas_documents/s, 'document ceiling must count current case documents');
assert.match(migration, />= 20/, 'document ceiling must reject document 21');
assert.match(migration, /before insert on public\.integritas_documents/, 'document ceiling must be enforced by a database trigger');
assert.match(rollback, /drop trigger/, 'rollback must remove the document limit trigger');
assert.match(rollback, /drop function/, 'rollback must remove the document limit function');
assert.match(privilegeMigration, /revoke execute on function public\.integritas_enforce_document_limit\(\) from anon/i, 'anon must not call trigger-only document-limit function');
assert.match(privilegeMigration, /revoke execute on function public\.integritas_enforce_document_limit\(\) from authenticated/i, 'authenticated users must not call trigger-only document-limit function');
assert.match(privilegeMigration, /revoke execute on function public\.integritas_enforce_document_limit\(\) from service_role/i, 'service role must not call trigger-only document-limit function directly');
console.log('Integritas document-limit contract checks passed');
