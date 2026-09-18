import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('OpenClaw runner requires canonical bundle.json and report.md outputs', async () => {
  const source = await readFile(new URL('../../investigation-agent-runner.mjs', import.meta.url), 'utf8');
  assert.match(source, /\['bundle\.json', 'report\.md'\]/);
  assert.doesNotMatch(source, /report\.html/);
});
