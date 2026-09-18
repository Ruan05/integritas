import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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

function manifestFor(bytes, sha256, state = {}) {
  return {
    manifest: {
      command_id: COMMAND_ID, case_id: CASE_ID, case_job_id: JOB_ID, case_revision: 7, depth: 'deep',
      job_stage: state.job_stage ?? 'queued', job_progress: state.job_progress ?? 0, cancel_requested: state.cancel_requested ?? false,
      case: { title: 'Synthetic DD', purpose: 'Test', authorized_scope: 'Authorised', intended_subjects: 'Counterparty', jurisdictions: ['ZA'] },
      documents: [{ id: DOC_ID, name: 'alpha.pdf', mime_type: 'application/pdf', size_bytes: bytes.length, sha256,
        storage_path: `cases/${CASE_ID}/documents/alpha.pdf`, download_url: 'https://project.supabase.co/storage/v1/object/sign/private/alpha' }],
      expires_in_seconds: 600,
    },
  };
}

test('stages verified evidence and publishes bounded OpenClaw artifacts', async () => {
  const spoolRoot = await mkdtemp(path.join(os.tmpdir(), 'integritas-investigation-'));
  const previousUmask = process.umask(0o077);
  const bytes = Buffer.from('alpha evidence');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const retainedDocumentsDir = path.join(spoolRoot, JOB_ID, 'documents');
  await mkdir(retainedDocumentsDir, { recursive: true, mode: 0o700 });
  const retainedDocument = path.join(retainedDocumentsDir, `${DOC_ID}.pdf`);
  await writeFile(retainedDocument, bytes, { mode: 0o600 });
  await chmod(retainedDocument, 0o600);
  await mkdir(path.join(spoolRoot, JOB_ID, 'skills', 'integritas-dd'), { recursive: true });
  await writeFile(path.join(spoolRoot, JOB_ID, 'skills', 'integritas-dd', 'SKILL.md'), 'legacy');
  await mkdir(path.join(spoolRoot, JOB_ID, 'docs'), { recursive: true });
  await writeFile(path.join(spoolRoot, JOB_ID, 'docs', 'DD_EVIDENCE_CONTRACT.md'), 'legacy');
  await mkdir(path.join(spoolRoot, JOB_ID, 'tools', 'dd'), { recursive: true });
  await writeFile(path.join(spoolRoot, JOB_ID, 'tools', 'dd', 'quality.py'), 'legacy');
  await writeFile(path.join(spoolRoot, JOB_ID, 'report.html'), '<p>legacy</p>');
  await writeFile(path.join(spoolRoot, JOB_ID, 'bundle.json'), '{"report_id":"legacy"}');
  const checkpoints = [];
  const outputs = [];
  const commits = [];
  const qaCalls = [];
  const systemCalls = [];
  const client = {
    baseUrl: 'https://project.supabase.co/functions/v1/integritas-control',
    manifest: async () => manifestFor(bytes, sha256, { job_stage: 'verifying', job_progress: 80 }),
    checkpoint: async (...args) => { checkpoints.push(args); return { ok: true }; },
    publishOutput: async (...args) => { outputs.push(args); return { ok: true }; },
    commitBundle: async (...args) => { commits.push(args); return { commit_summary: { findings: 0, sources: 0 } }; },
  };
  const fetchImpl = async () => new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } });
  let unitState = 'inactive';
  const systemctlRunner = async (file, args) => {
    systemCalls.push([file, args]);
    if (args[0] === 'show') return { stdout: `${unitState}\n`, stderr: '' };
    if (args[0] !== 'start' || args[1] !== '--no-block') throw new Error('unexpected systemctl action');
    const jobDir = path.join(spoolRoot, JOB_ID);
    const expectedGroup = (await stat(spoolRoot)).gid;
    for (const relative of ['manifest.json', 'task.md', 'bundle-template.json', `documents/${DOC_ID}.pdf`, 'skills/integritas-investigation-v1/SKILL.md', 'tools/dd/quality_v1.py', 'contracts/investigation-bundle-v1.schema.json']) {
      const info = await stat(path.join(jobDir, relative));
      assert.equal(info.mode & 0o777, 0o640, `${relative} must remain group-readable under umask 077`);
      assert.equal(info.gid, expectedGroup, `${relative} must use the shared workspace group`);
    }
    for (const relative of ['.', 'documents', 'skills', 'skills/integritas-investigation-v1', 'tools', 'tools/dd', 'contracts']) {
      const info = await stat(path.join(jobDir, relative));
      assert.equal(info.mode & 0o777, 0o770, `${relative} must remain group-accessible without setgid bits`);
      assert.equal(info.gid, expectedGroup, `${relative} must use the shared workspace group`);
    }
    await assert.rejects(access(path.join(jobDir, 'bundle.json')));
    await assert.rejects(access(path.join(jobDir, 'report.html')));
    const report = '# Synthetic DD report\n\nDraft evidence summary.';
    const bundle = {
      schema_version: 1, case_id: CASE_ID, case_job_id: JOB_ID, case_revision: 7, depth: 'deep',
      generated_at: '2026-09-17T12:00:00Z', entities: [], relationships: [], sources: [], findings: [], checks: [],
      contradictions: [], unresolved_checks: [], limitations: [],
      report: { summary: 'Synthetic summary', markdown: report, status: 'draft' },
      execution: { started_at: '2026-09-17T11:50:00Z', completed_at: '2026-09-17T12:00:00Z', stages: [], tool_results: [], warnings: [], terminal_outcome: 'incomplete' },
    };
    await writeFile(path.join(jobDir, 'bundle.json'), JSON.stringify(bundle));
    await writeFile(path.join(jobDir, 'report.md'), report);
    unitState = 'inactive';
    return { stdout: '', stderr: '' };
  };

  try {
    const result = await executeInvestigation(command, {
      client, fetchImpl, systemctlRunner, spoolRoot, repoRoot: REPO_ROOT, retainWorkspace: true,
      statePollMs: 1,
      qaRunner: async (details) => { qaCalls.push(details); return { valid: true, errors: [], summary: { checks: 1 } }; },
    });
    assert.equal(result.ok, true);
    assert.equal(result.terminal_outcome, 'incomplete');
    assert.deepEqual(systemCalls.map((entry) => entry[1][0]), ['show', 'start', 'show']);
    assert.deepEqual(systemCalls[1], [
      '/usr/bin/systemctl', ['start', '--no-block', `integritas-openclaw-investigation@${JOB_ID}.service`],
    ]);
    const safeManifest = await readFile(path.join(spoolRoot, JOB_ID, 'manifest.json'), 'utf8');
    assert.ok(!safeManifest.includes('download_url'));
    assert.ok(!safeManifest.includes('/storage/v1/object/sign/'));
    await access(path.join(spoolRoot, JOB_ID, 'documents', `${DOC_ID}.pdf`));
    await access(path.join(spoolRoot, JOB_ID, 'skills', 'integritas-investigation-v1', 'SKILL.md'));
    await access(path.join(spoolRoot, JOB_ID, 'tools', 'dd', 'quality_v1.py'));
    await access(path.join(spoolRoot, JOB_ID, 'contracts', 'investigation-bundle-v1.schema.json'));
    await assert.rejects(access(path.join(spoolRoot, JOB_ID, 'skills', 'integritas-dd', 'SKILL.md')));
    await assert.rejects(access(path.join(spoolRoot, JOB_ID, 'tools', 'dd', 'quality.py')));
    await assert.rejects(access(path.join(spoolRoot, JOB_ID, 'docs', 'DD_EVIDENCE_CONTRACT.md')));
    await assert.rejects(access(path.join(spoolRoot, JOB_ID, 'report.html')));
    assert.deepEqual(outputs.map((entry) => entry[3]), ['bundle', 'report_markdown']);
    assert.equal(qaCalls.length, 1);
    assert.equal(commits.length, 1);
    assert.equal(commits[0][0], COMMAND_ID);
    assert.equal(commits[0][1], JOB_ID);
    assert.equal(commits[0][2], 7);
    assert.equal(commits[0][5].schema_version, 1);
    const task = await readFile(path.join(spoolRoot, JOB_ID, 'task.md'), 'utf8');
    assert.match(task, /integritas-investigation-v1/);
    assert.match(task, /bundle-template\.json/);
    assert.match(task, /quality_v1\.py/);
    assert.match(task, /report\.md/);
    assert.doesNotMatch(task, /integritas-dd/);
    assert.doesNotMatch(task, /quality\.py(?:\s|$)/);
    assert.match(task, /Do not create report\.html/);
    const template = JSON.parse(await readFile(path.join(spoolRoot, JOB_ID, 'bundle-template.json'), 'utf8'));
    assert.equal(template.schema_version, 1);
    assert.equal(template.case_job_id, JOB_ID);
    assert.deepEqual(Object.keys(template).sort(), ['case_id','case_job_id','case_revision','checks','contradictions','depth','entities','execution','findings','generated_at','limitations','relationships','report','schema_version','sources','unresolved_checks'].sort());
    assert.ok(checkpoints.every((entry) => entry[4] >= 80));
    assert.ok(!checkpoints.some((entry) => entry[3] === 'extracting'));
    const terminalCheckpoint = checkpoints.find((entry) => entry[3] === 'incomplete' && entry[4] === 100);
    assert.ok(terminalCheckpoint);
    assert.deepEqual(terminalCheckpoint[5].qa_summary, { checks: 1 });
    assert.deepEqual(terminalCheckpoint[5].commit_summary, { findings: 0, sources: 0 });
    assert.ok(!checkpoints.some((entry) => entry[3] === 'completed'));
  } finally {
    process.umask(previousUmask);
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
        systemctlRunner: async (file, args) => {
          if (args[0] === 'show') return { stdout: 'inactive\n', stderr: '' };
          started = true;
          return { stdout: '', stderr: '' };
        },
        spoolRoot, repoRoot: REPO_ROOT,
      }),
      /digest mismatch/,
    );
    assert.equal(started, false);
    await access(path.join(spoolRoot, JOB_ID));
  } finally {
    await rm(spoolRoot, { recursive: true, force: true });
  }
});


test('acknowledges a requested cancellation before launching OpenClaw', async () => {
  const spoolRoot = await mkdtemp(path.join(os.tmpdir(), 'integritas-investigation-'));
  const bytes = Buffer.from('alpha evidence');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const checkpoints = [];
  const acknowledgements = [];
  let started = false;
  const client = {
    baseUrl: 'https://project.supabase.co/functions/v1/integritas-control',
    manifest: async () => manifestFor(bytes, sha256, { cancel_requested: true }),
    checkpoint: async (...args) => { checkpoints.push(args); return { ok: true }; },
    acknowledgeCancel: async (...args) => { acknowledgements.push(args); return { ok: true }; },
    jobState: async () => ({ state: { cancel_requested: true, stale_revision: false, job_progress: 0, job_stage: 'queued' } }),
  };
  try {
    const result = await executeInvestigation(command, {
      client,
      fetchImpl: async () => new Response(bytes, { status: 200 }),
      systemctlRunner: async () => { started = true; return { stdout: '', stderr: '' }; },
      spoolRoot,
      repoRoot: REPO_ROOT,
      retainWorkspace: true,
    });
    assert.equal(result.cancelled, true);
    assert.equal(started, false);
    assert.equal(acknowledgements.length, 1);
    assert.ok(!checkpoints.some((entry) => entry[3] === 'completed'));
  } finally {
    await rm(spoolRoot, { recursive: true, force: true });
  }
});

test('stops the scoped OpenClaw unit when cancellation arrives during execution', async () => {
  const spoolRoot = await mkdtemp(path.join(os.tmpdir(), 'integritas-investigation-'));
  const bytes = Buffer.from('alpha evidence');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const systemCalls = [];
  const acknowledgements = [];
  const outputs = [];
  let unitState = 'inactive';
  const client = {
    baseUrl: 'https://project.supabase.co/functions/v1/integritas-control',
    manifest: async () => manifestFor(bytes, sha256),
    checkpoint: async () => ({ ok: true }),
    jobState: async () => ({ state: {
      cancel_requested: true, stale_revision: false, job_progress: 15, job_stage: 'analyzing_documents',
    } }),
    acknowledgeCancel: async (...args) => { acknowledgements.push(args); return { ok: true }; },
    publishOutput: async (...args) => { outputs.push(args); return { ok: true }; },
  };
  const systemctlRunner = async (file, args) => {
    systemCalls.push([file, args]);
    if (args[0] === 'show') return { stdout: `${unitState}\n`, stderr: '' };
    if (args[0] === 'start' && args[1] === '--no-block') {
      unitState = 'activating';
      return { stdout: '', stderr: '' };
    }
    if (args[0] === 'stop') {
      unitState = 'inactive';
      return { stdout: '', stderr: '' };
    }
    throw new Error('unexpected systemctl action');
  };
  try {
    const result = await executeInvestigation(command, {
      client,
      fetchImpl: async () => new Response(bytes, { status: 200 }),
      systemctlRunner,
      spoolRoot,
      repoRoot: REPO_ROOT,
      retainWorkspace: true,
      statePollMs: 1,
    });
    assert.equal(result.cancelled, true);
    assert.deepEqual(systemCalls.map((entry) => entry[1][0]), ['show', 'start', 'stop']);
    assert.match(systemCalls[2][1][1], new RegExp(`^integritas-openclaw-investigation@${JOB_ID}\\.service$`));
    assert.equal(acknowledgements.length, 1);
    assert.equal(outputs.length, 0);
  } finally {
    await rm(spoolRoot, { recursive: true, force: true });
  }
});


test('rejoins an already-running scoped unit after worker restart without starting it twice', async () => {
  const spoolRoot = await mkdtemp(path.join(os.tmpdir(), 'integritas-investigation-'));
  const bytes = Buffer.from('alpha evidence');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const systemCalls = [];
  const outputs = [];
  const commits = [];
  let showCount = 0;
  const jobDir = path.join(spoolRoot, JOB_ID);
  const documentsDir = path.join(jobDir, 'documents');
  await mkdir(documentsDir, { recursive: true });
  await mkdir(path.join(jobDir, 'evidence'), { recursive: true });
  await writeFile(path.join(documentsDir, `${DOC_ID}.pdf`), bytes);
  const retainedManifest = manifestFor(bytes, sha256).manifest;
  retainedManifest.documents[0] = { ...retainedManifest.documents[0], download_url: undefined, local_path: `documents/${DOC_ID}.pdf` };
  delete retainedManifest.expires_in_seconds;
  await writeFile(path.join(jobDir, 'manifest.json'), JSON.stringify(retainedManifest));
  await writeFile(path.join(jobDir, 'report.md'), '# Partial report still being written');
  await writeFile(path.join(jobDir, 'task.md'), 'active runner task');
  await writeFile(path.join(jobDir, 'evidence', 'in-progress.txt'), 'do not delete');
  const report = '# Resumed DD report\n\nRecovered after worker restart.';
  const bundle = {
    schema_version: 1, case_id: CASE_ID, case_job_id: JOB_ID, case_revision: 7, depth: 'deep',
    generated_at: '2026-09-18T07:55:00Z', entities: [], relationships: [], sources: [], findings: [], checks: [],
    contradictions: [], unresolved_checks: [], limitations: [],
    report: { summary: 'Recovered', markdown: report, status: 'draft' },
    execution: { started_at: '2026-09-18T07:50:00Z', completed_at: '2026-09-18T07:55:00Z', stages: [], tool_results: [], warnings: [], terminal_outcome: 'incomplete' },
  };
  const client = {
    baseUrl: 'https://project.supabase.co/functions/v1/integritas-control',
    manifest: async () => manifestFor(bytes, sha256, { job_stage: 'analyzing_documents', job_progress: 15 }),
    checkpoint: async () => ({ ok: true }),
    jobState: async () => ({ state: { cancel_requested: false, stale_revision: false, job_progress: 15, job_stage: 'analyzing_documents' } }),
    publishOutput: async (...args) => { outputs.push(args); return { ok: true }; },
    commitBundle: async (...args) => { commits.push(args); return { commit_summary: {} }; },
  };
  const systemctlRunner = async (file, args) => {
    systemCalls.push([file, args]);
    if (args[0] !== 'show') throw new Error('replacement worker must not restart an already-running unit');
    showCount += 1;
    if (showCount === 1) {
      assert.equal(await readFile(path.join(jobDir, 'report.md'), 'utf8'), '# Partial report still being written');
      assert.equal(await readFile(path.join(jobDir, 'task.md'), 'utf8'), 'active runner task');
      assert.equal(await readFile(path.join(jobDir, 'evidence', 'in-progress.txt'), 'utf8'), 'do not delete');
      return { stdout: 'activating\n', stderr: '' };
    }
    await writeFile(path.join(jobDir, 'bundle.json'), JSON.stringify(bundle));
    await writeFile(path.join(jobDir, 'report.md'), report);
    return { stdout: 'inactive\n', stderr: '' };
  };
  try {
    const result = await executeInvestigation(command, {
      client,
      fetchImpl: async () => { throw new Error('replacement worker must not re-download evidence for an active unit'); },
      systemctlRunner,
      spoolRoot,
      repoRoot: REPO_ROOT,
      retainWorkspace: true,
      statePollMs: 1,
      qaRunner: async () => ({ valid: true, errors: [], summary: {} }),
    });
    assert.equal(result.ok, true);
    assert.equal(showCount, 2);
    assert.ok(systemCalls.every((entry) => entry[1][0] === 'show'));
    assert.equal(outputs.length, 2);
    assert.equal(commits.length, 1);
    assert.equal(await readFile(path.join(jobDir, 'task.md'), 'utf8'), 'active runner task');
    assert.equal(await readFile(path.join(jobDir, 'evidence', 'in-progress.txt'), 'utf8'), 'do not delete');
  } finally {
    await rm(spoolRoot, { recursive: true, force: true });
  }
});
