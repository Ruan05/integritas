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
  assert.match(source, /fast:[\s\S]*model: 'integritas-groq\/openai\/gpt-oss-20b'[\s\S]*timeoutSeconds: 600/);
  assert.match(source, /standard:[\s\S]*model: 'integritas-groq\/openai\/gpt-oss-120b'[\s\S]*timeoutSeconds: 900/);
  assert.match(source, /deep:[\s\S]*model: 'nvidia\/nemotron-3-ultra-550b-a55b'[\s\S]*timeoutSeconds: 1200/);
  assert.match(source, /maximum:[\s\S]*model: 'nvidia\/nemotron-3-ultra-550b-a55b'[\s\S]*timeoutSeconds: 1500/);
  assert.match(source, /integritas-openrouter\/nvidia\/nemotron-3-ultra-550b-a55b:free/);
  assert.match(source, /opencode-go\/glm-5\.3-flash/);
  assert.match(source, /opencode-go\/glm-5\.2/);
  assert.match(source, /'--model', route\.model/);
  assert.match(source, /args\.push\('--fallback', fallback\)/);
  assert.doesNotMatch(source, /opencode-go\/kimi-k3/);
  assert.doesNotMatch(source, /opencode-go\/deepseek-v4-pro/);
});

test('investigation profile uses SecretRef-backed Groq and keeps the evidence workspace read-only', async () => {
  const config = await readFile(new URL('../../integritas-investigation.json5', import.meta.url), 'utf8');
  assert.match(config, /workspaceAccess: "ro"/);
  assert.match(config, /profile: "minimal"/);
  assert.match(config, /"integritas-groq"/);
  assert.match(config, /baseUrl: "https:\/\/api\.groq\.com\/openai\/v1"/);
  assert.match(config, /apiKey: \{ source: "env", provider: "default", id: "GROQ_API_KEY" \}/);
  assert.match(config, /id: "openai\/gpt-oss-20b"/);
  assert.match(config, /id: "openai\/gpt-oss-120b"/);
  assert.match(config, /"integritas-openrouter"/);
  assert.match(config, /id: "nvidia\/nemotron-3-ultra-550b-a55b:free"/);
  assert.match(config, /id: "openrouter\/free"/);
  assert.match(config, /"integritas-openrouter"/);
  assert.match(config, /baseUrl: "https:\/\/openrouter\.ai\/api\/v1"/);
  assert.match(config, /apiKey: \{ source: "env", provider: "default", id: "OPENROUTER_API_KEY" \}/);
  assert.match(config, /id: "nvidia\/nemotron-3-ultra-550b-a55b:free"/);
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

test('runner passes only approved provider environment names into OpenClaw', async () => {
  const source = await readFile(new URL('../../investigation-agent-runner.mjs', import.meta.url), 'utf8');
  for (const name of ['GROQ_API_KEY', 'OPENROUTER_API_KEY', 'NVIDIA_API_KEY']) {
    assert.match(source, new RegExp(`'${name}'`));
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
