import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('OpenClaw runner materializes only validated structured final output', async () => {
  const source = await readFile(new URL('../../investigation-agent-runner.mjs', import.meta.url), 'utf8');
  assert.match(source, /parseAgentBundle\(result\.stdout, manifest\)/);
  assert.match(source, /writeSharedAtomic\('bundle\.json'/);
  assert.match(source, /writeSharedAtomic\('report\.md'/);
  assert.match(source, /'--code-mode', 'direct'/);
  assert.doesNotMatch(source, /report\.html/);
  assert.doesNotMatch(source, /'--state-dir'/, 'agent exec must use OpenClaw isolated temporary state while the Gateway owns the persistent state directory');
  assert.match(source, /'--config', '\/etc\/openclaw\/integritas-investigation\.json'/);
});

test('OpenClaw runner uses independent bounded provider routes by investigation depth', async () => {
  const source = await readFile(new URL('../../investigation-agent-runner.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes("fast: {\n    model: 'nvidia/nemotron-3-ultra-550b-a55b'"));
  assert.ok(source.includes("standard: {\n    model: 'nvidia/nemotron-3-ultra-550b-a55b'"));
  assert.ok(source.includes("deep: {\n    model: 'nvidia/nemotron-3-ultra-550b-a55b'"));
  assert.ok(source.includes("maximum: {\n    model: 'nvidia/nemotron-3-ultra-550b-a55b'"));
  assert.ok(source.includes("timeoutSeconds: 600"));
  assert.ok(source.includes("timeoutSeconds: 900"));
  assert.ok(source.includes("timeoutSeconds: 1200"));
  assert.ok(source.includes("timeoutSeconds: 1500"));
  assert.match(source, /integritas-openrouter\/nvidia\/nemotron-3-ultra-550b-a55b:free/);
  assert.match(source, /opencode-go\/glm-5\.3-flash/);
  assert.match(source, /opencode-go\/glm-5\.2/);
  assert.match(source, /'--model', route\.model/);
  assert.match(source, /args\.push\('--fallback', fallback\)/);
  assert.doesNotMatch(source, /opencode-go\/kimi-k3/);
  assert.doesNotMatch(source, /opencode-go\/deepseek-v4-pro/);
});

test('investigation profile uses only required provider SecretRefs and keeps the evidence workspace read-only', async () => {
  const config = await readFile(new URL('../../integritas-investigation.json5', import.meta.url), 'utf8');
  assert.match(config, /workspaceAccess: "ro"/);
  assert.match(config, /profile: "minimal"/);
  assert.doesNotMatch(config, /integritas-groq/);
  assert.doesNotMatch(config, /GROQ_API_KEY/);
  assert.match(config, /"integritas-openrouter"/);
  assert.match(config, /apiKey: \{ source: "env", provider: "default", id: "OPENROUTER_API_KEY" \}/);
  assert.match(config, /id: "nvidia\/nemotron-3-ultra-550b-a55b:free"/);
  assert.match(config, /id: "openrouter\/free"/);
  for (const model of [
    'integritas-openrouter/nvidia/nemotron-3-ultra-550b-a55b:free',
    'integritas-openrouter/openrouter/free',
    'opencode-go/glm-5.3-flash',
    'opencode-go/glm-5.2',
    'nvidia/nemotron-3-ultra-550b-a55b',
  ]) {
    assert.ok(config.includes(`"${model}"`), `missing routed model allowlist entry: ${model}`);
  }
  assert.doesNotMatch(config, /gsk_[A-Za-z0-9_-]+/);
  assert.doesNotMatch(config, /sk-or-v1-[A-Za-z0-9_-]+/);
  assert.doesNotMatch(config, /nvapi-[A-Za-z0-9_-]+/);
  for (const tool of ['ls', 'read', 'web_search', 'web_fetch', 'browser', 'view_image', 'pdf']) {
    assert.match(config, new RegExp(`"${tool}"`));
  }
  for (const tool of ['write', 'edit', 'exec', 'apply_patch', 'process', 'code_execution', 'terminal', 'sessions_spawn', 'subagents', 'secrets']) {
    assert.match(config, new RegExp(`deny: \\[.*"${tool}"`, 's'));
  }
});

test('runner passes only required provider environment names into OpenClaw', async () => {
  const source = await readFile(new URL('../../investigation-agent-runner.mjs', import.meta.url), 'utf8');
  for (const name of ['OPENROUTER_API_KEY', 'NVIDIA_API_KEY']) {
    assert.match(source, new RegExp(`'${name}'`));
  }
  for (const name of ['GROQ_API_KEY', 'GEMINI_API_KEY', 'CEREBRAS_API_KEY', 'EXA_API_KEY', 'HF_TOKEN']) {
    assert.doesNotMatch(source, new RegExp(`'${name}'`));
  }
  assert.match(source, /filter\(\(name\) => process\.env\[name\]\)/);
  assert.doesNotMatch(source, /process\.env\s*[,}]/);
});

test('investigation skill imposes research and reread budgets', async () => {
  const skill = await readFile(new URL('../../skills/integritas-investigation-v1/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /fast.*6 distinct external sources.*12 web\/browser tool calls/s);
  assert.match(skill, /standard.*10 distinct external sources.*20 web\/browser tool calls/s);
  assert.match(skill, /deep.*18 distinct external sources.*36 web\/browser tool calls/s);
  assert.match(skill, /maximum.*24 distinct external sources.*48 web\/browser tool calls/s);
  assert.match(skill, /Read each submitted evidence file comprehensively once/);
  assert.match(skill, /Do not repeatedly fetch the same URL/);
});

test('investigation prompts use the read-only /agent workspace mount', async () => {
  const runtime = await readFile(new URL('../src/investigation.mjs', import.meta.url), 'utf8');
  const skill = await readFile(new URL('../../skills/integritas-investigation-v1/SKILL.md', import.meta.url), 'utf8');
  assert.match(runtime, /workspaceAccess ro/);
  assert.match(runtime, /\/agent\/bundle-template\.json/);
  assert.match(skill, /mounted read-only at `\/agent`/);
  assert.doesNotMatch(runtime, /\/workspace\//, 'runtime prompt must not use writable /workspace paths');
  assert.doesNotMatch(skill, /\/workspace\//, 'skill must not use writable /workspace paths');
});
