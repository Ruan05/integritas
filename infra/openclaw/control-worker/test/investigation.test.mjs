import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeInvestigation } from '../src/investigation.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CASE_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';
const COMMAND_ID = '33333333-3333-4333-8333-333333333333';
const DOC_ID = '44444444-4444-4444-8444-444444444444';

const command = {
  id: COMMAND_ID,
  command_type: 'run_case_investigation',
  payload: { case_id: CASE_ID, case_job_id: JOB_ID, case_revision: 7, depth: 'deep' },
};

function manifestFor(bytes, sha256) {
  return {
    manifest: {
      command_id: COMMAND_ID, case_id: CASE_ID, case_job_id: JOB_ID, case_revision: 7, depth: 'deep',
      case: { title: 'Synthetic DD', purpose: 'Test', authorized_scope: 'Authorised', intended_subjects: 'Counterparty', jurisdictions: ['ZA'] },
      documents: [{ id: DOC_ID, name: 'alpha.pdf', mime_type: 'application/pdf', size_bytes: bytes.length, sha256,
        storage_path: `cases/${CASE_ID}/documents/alpha.pdf`, download_url: 'https://project.supabase.co/storage/v1/object/sign/private/alpha' }],
      expires_in_seconds: 600,
    },
  };
}

test('stages verified evidence and publishes bounded OpenClaw artifacts', async () => {
  const spoolRoot = await mkdtemp(path.join(os.tmpdir(), 'integritas-investigation-'));
  const bytes = Buffer.from('alpha evidence');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const checkpoints = [];
  const outputs = [];
  const systemCalls = [];
  const client = {
    baseUrl: 'https://project.supabase.co/functions/v1/integritas-control',
    manifest: async () => manifestFor(bytes, sha256),
    checkpoint: async (...args) => { checkpoints.push(args); return { ok: true }; },
    publishOutput: async (...args) => { outputs.push(args); return { ok: true }; },
  };
  const fetchImpl = async () => new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } });
  const systemctlRunner = async (file, args) => {
    systemCalls.push([file, args]);
    const jobDir = path.join(spoolRoot, JOB_ID);
    await writeFile(path.join(jobDir, 'bundle.json'), JSON.stringify({ status: 'completed', findings: [] }));
    await writeFile(path.join(jobDir, 'report.html'), '<html><body>complete</body></html>');
    return { stdout: '', stderr: '' };
  };

  try {
    const result = await executeInvestigation(command, { client, fetchImpl, systemctlRunner, spoolRoot, repoRoot: REPO_ROOT, retainWorkspace: true });
    assert.equal(result.ok, true);
    assert.deepEqual(systemCalls, [[
      '/usr/bin/systemctl', ['start', '--wait', `integritas-openclaw-investigation@${JOB_ID}.service`],
    ]]);
    const safeManifest = await readFile(path.join(spoolRoot, JOB_ID, 'manifest.json'), 'utf8');
    assert.ok(!safeManifest.includes('download_url'));
    assert.ok(!safeManifest.includes('/storage/v1/object/sign/'));
    await access(path.join(spoolRoot, JOB_ID, 'documents', `${DOC_ID}.pdf`));
    await access(path.join(spoolRoot, JOB_ID, 'skills', 'integritas-dd', 'SKILL.md'));
    await access(path.join(spoolRoot, JOB_ID, 'tools', 'dd', 'quality.py'));
    await access(path.join(spoolRoot, JOB_ID, 'docs', 'DD_EVIDENCE_CONTRACT.md'));
    assert.deepEqual(outputs.map((entry) => entry[3]), ['bundle', 'report_html']);
    assert.ok(checkpoints.some((entry) => entry[3] === 'extracting'));
    assert.ok(checkpoints.some((entry) => entry[3] === 'completed' && entry[4] === 100));
  } finally {
    await rm(spoolRoot, { recursive: true, force: true });
  }
});

test('rejects a document digest mismatch before starting OpenClaw', async () => {
  const spoolRoot = await mkdtemp(path.join(os.tmpdir(), 'integritas-investigation-'));
  const bytes = Buffer.from('tampered');
  let started = false;
  const client = {
    baseUrl: 'https://project.supabase.co/functions/v1/integritas-control',
    manifest: async () => manifestFor(bytes, 'a'.repeat(64)),
    checkpoint: async () => ({ ok: true }),
    publishOutput: async () => ({ ok: true }),
  };
  try {
    await assert.rejects(
      executeInvestigation(command, {
        client, fetchImpl: async () => new Response(bytes, { status: 200 }),
        systemctlRunner: async () => { started = true; return { stdout: '', stderr: '' }; },
        spoolRoot, repoRoot: REPO_ROOT,
      }),
      /digest mismatch/,
    );
    assert.equal(started, false);
  } finally {
    await rm(spoolRoot, { recursive: true, force: true });
  }
});
