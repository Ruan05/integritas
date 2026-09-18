import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('OpenClaw runner requires canonical bundle.json and report.md outputs', async () => {
  const source = await readFile(new URL('../../investigation-agent-runner.mjs', import.meta.url), 'utf8');
  assert.match(source, /\['bundle\.json', 'report\.md'\]/);
  assert.doesNotMatch(source, /report\.html/);
  assert.doesNotMatch(source, /'--state-dir'/, 'agent exec must use isolated temporary state while the Gateway is running');
  assert.match(source, /'--config', '\/etc\/openclaw\/integritas-investigation\.json'/);
  assert.match(source, /fast: 'off'.*standard: 'off'.*deep: 'max'.*maximum: 'max'/s, 'depth mapping must use thinking levels supported by the pinned Kimi K3 runtime');
});
