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

test('OpenClaw runner uses bounded cost-efficient Go routing by investigation depth', async () => {
  const source = await readFile(new URL('../../investigation-agent-runner.mjs', import.meta.url), 'utf8');
  assert.match(source, /fast:[\s\S]*model: 'opencode-go\/glm-5\.3-flash'[\s\S]*timeoutSeconds: 600/);
  assert.match(source, /standard:[\s\S]*model: 'opencode-go\/glm-5\.3-flash'[\s\S]*timeoutSeconds: 900/);
  assert.match(source, /deep:[\s\S]*model: 'opencode-go\/glm-5\.2'[\s\S]*thinking: 'max'[\s\S]*timeoutSeconds: 1200/);
  assert.match(source, /maximum:[\s\S]*model: 'opencode-go\/glm-5\.2'[\s\S]*thinking: 'max'[\s\S]*timeoutSeconds: 1500/);
  assert.match(source, /opencode-go\/deepseek-v4\.1-flash/);
  assert.match(source, /opencode-go\/mimo-v2\.5/);
  assert.match(source, /opencode-go\/deepseek-v4-flash/);
  assert.match(source, /'--model', route\.model/);
  assert.match(source, /args\.push\('--fallback', fallback\)/);
  assert.doesNotMatch(source, /opencode-go\/kimi-k3/);
  assert.doesNotMatch(source, /opencode-go\/deepseek-v4-pro/);
});

test('investigation profile stays read-only and exposes only bounded evidence/research tools', async () => {
  const config = await readFile(new URL('../../integritas-investigation.json5', import.meta.url), 'utf8');
  assert.match(config, /workspaceAccess: "ro"/);
  assert.match(config, /profile: "minimal"/);
  for (const tool of ['ls', 'read', 'web_search', 'web_fetch', 'browser', 'view_image', 'pdf']) {
    assert.match(config, new RegExp(`"${tool}"`));
  }
  for (const tool of ['write', 'edit', 'exec', 'apply_patch', 'process', 'code_execution', 'terminal', 'sessions_spawn', 'subagents', 'secrets']) {
    assert.match(config, new RegExp(`deny: \\[.*"${tool}"`, 's'));
  }
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
