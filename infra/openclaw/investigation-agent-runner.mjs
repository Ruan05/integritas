import { execFile } from 'node:child_process';
import { access, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const jobId = process.argv[2] ?? '';
if (!UUID.test(jobId)) throw new Error('invalid investigation job id');

const jobDir = `/var/lib/integritas-runner/jobs/${jobId}`;
const manifest = JSON.parse(await readFile(path.join(jobDir, 'manifest.json'), 'utf8'));
if (manifest.case_job_id !== jobId) throw new Error('job manifest mismatch');
const thinking = { fast: 'low', standard: 'medium', deep: 'high', maximum: 'ultra' }[manifest.depth];
if (!thinking) throw new Error('invalid investigation depth');

const args = [
  'agent', 'exec',
  '--config', '/etc/openclaw/integritas-investigation.json',
  '--state-dir', '/var/lib/openclaw',
  '--cwd', jobDir,
  '--message-file', path.join(jobDir, 'task.md'),
  '--json',
  '--timeout', '1500',
  '--thinking', thinking,
];
const env = {
  HOME: '/var/lib/openclaw',
  OPENCLAW_HOME: '/var/lib/openclaw',
  OPENCLAW_STATE_DIR: '/var/lib/openclaw',
  PATH: '/opt/openclaw/bin:/usr/bin:/bin',
  LANG: 'C',
};
const result = await execFileAsync('/opt/openclaw/bin/openclaw', args, {
  cwd: jobDir,
  env,
  timeout: 26 * 60 * 1000,
  maxBuffer: 5 * 1024 * 1024,
});
await writeFile(path.join(jobDir, 'agent-exec.json'), result.stdout, { mode: 0o640 });
for (const name of ['bundle.json', 'report.html']) {
  const file = path.join(jobDir, name);
  await access(file);
  const info = await stat(file);
  if (!info.isFile() || info.size < 1 || info.size > 5 * 1024 * 1024) throw new Error(`invalid ${name}`);
}
