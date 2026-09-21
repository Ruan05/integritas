import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../supabase/migrations/0020_integritas_upload_capacity.sql', import.meta.url), 'utf8');
const contract = fs.readFileSync(new URL('../supabase/functions/integritas-admin-api/contract.ts', import.meta.url), 'utf8');
const browser = fs.readFileSync(new URL('../src/lib/integritas-browser.ts', import.meta.url), 'utf8');
const selftest = fs.readFileSync(new URL('../supabase/functions/integritas-upload-selftest/index.ts', import.meta.url), 'utf8');

for (const [name, source] of [['migration', migration], ['contract', contract], ['browser', browser]]) {
  if (!source.includes('52428800') && !source.includes('50 * 1024 * 1024')) {
    throw new Error(`${name} does not enforce the 50 MiB evidence limit`);
  }
}
if (!migration.includes("public = false")) throw new Error('upload-capacity migration must assert the evidence bucket remains private');
if (!selftest.includes('8 * 1024 * 1024')) throw new Error('upload selftest must exceed the historical 5 MiB ceiling');
if (!selftest.includes('integritas_control_worker_credentials')) throw new Error('upload selftest must remain worker-authenticated');
if (!selftest.includes('.remove([path])')) throw new Error('upload selftest must clean up its synthetic object');
console.log('Integritas upload-capacity contract verified');
