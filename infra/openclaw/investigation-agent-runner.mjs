import { execFile } from 'node:child_process';
import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseAgentBundle } from './agent-result.mjs';

const execFileAsync = promisify(execFile);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODEL_ROUTES = Object.freeze({
  fast: {
    model: 'nvidia/nemotron-3-ultra-550b-a55b',
    fallbacks: [
      'integritas-openrouter/nvidia/nemotron-3-ultra-550b-a55b:free',
      'integritas-openrouter/openrouter/free',
      'opencode-go/glm-5.3-flash',
    ],
    thinking: 'off',
    timeoutSeconds: 600,
  },
  standard: {
    model: 'nvidia/nemotron-3-ultra-550b-a55b',
    fallbacks: [
      'integritas-openrouter/nvidia/nemotron-3-ultra-550b-a55b:free',
      'integritas-openrouter/openrouter/free',
      'opencode-go/glm-5.3-flash',
    ],
    thinking: 'off',
    timeoutSeconds: 900,
  },
  deep: {
    model: 'nvidia/nemotron-3-ultra-550b-a55b',
    fallbacks: [
      'integritas-openrouter/nvidia/nemotron-3-ultra-550b-a55b:free',
      'integritas-openrouter/openrouter/free',
      'opencode-go/glm-5.2',
    ],
    thinking: 'off',
    timeoutSeconds: 1200,
  },
  maximum: {
    model: 'nvidia/nemotron-3-ultra-550b-a55b',
    fallbacks: [
      'integritas-openrouter/nvidia/nemotron-3-ultra-550b-a55b:free',
      'integritas-openrouter/openrouter/free',
      'opencode-go/glm-5.2',
    ],
    thinking: 'off',
    timeoutSeconds: 1500,
  },
});

const jobId = process.argv[2] ?? '';
if (!UUID.test(jobId)) throw new Error('invalid investigation job id');

const jobDir = `/var/lib/integritas-runner/jobs/${jobId}`;
const manifest = JSON.parse(await readFile(path.join(jobDir, 'manifest.json'), 'utf8'));
if (manifest.case_job_id !== jobId) throw new Error('job manifest mismatch');
const route = MODEL_ROUTES[manifest.depth];
if (!route) throw new Error('invalid investigation depth');

const args = [
  'agent', 'exec',
  '--config', '/etc/openclaw/integritas-investigation.json',
  '--cwd', jobDir,
  '--message-file', path.join(jobDir, 'task.md'),
  '--json',
  '--code-mode', 'direct',
  '--model', route.model,
];
for (const fallback of route.fallbacks) args.push('--fallback', fallback);
args.push(
  '--timeout', String(route.timeoutSeconds),
  '--thinking', route.thinking,
);
const env = {
  HOME: '/var/lib/openclaw',
  OPENCLAW_HOME: '/var/lib/openclaw',
  OPENCLAW_STATE_DIR: '/var/lib/openclaw',
  PATH: '/opt/openclaw/bin:/usr/bin:/bin',
  LANG: 'C',
  ...Object.fromEntries(
    ['GROQ_API_KEY', 'OPENROUTER_API_KEY', 'NVIDIA_API_KEY', 'GEMINI_API_KEY', 'CEREBRAS_API_KEY', 'EXA_API_KEY', 'HF_TOKEN']
      .filter((name) => process.env[name])
      .map((name) => [name, process.env[name]]),
  ),
};
const result = await execFileAsync('/opt/openclaw/bin/openclaw', args, {
  cwd: jobDir,
  env,
  timeout: (route.timeoutSeconds + 60) * 1000,
  maxBuffer: 5 * 1024 * 1024,
});
const parsed = parseAgentBundle(result.stdout, manifest);

async function writeSharedAtomic(name, content) {
  const target = path.join(jobDir, name);
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, content, { mode: 0o640 });
  await chmod(temporary, 0o640);
  await rename(temporary, target);
}

await writeSharedAtomic('agent-exec.json', result.stdout);
await writeSharedAtomic('bundle.json', `${JSON.stringify(parsed.bundle, null, 2)}\n`);
await writeSharedAtomic('report.md', parsed.reportMarkdown);
