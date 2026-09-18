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
  assert.match(source, /fast: 'off'.*standard: 'off'.*deep: 'max'.*maximum: 'max'/s, 'depth mapping must use thinking levels supported by the pinned Kimi K3 runtime');
});
