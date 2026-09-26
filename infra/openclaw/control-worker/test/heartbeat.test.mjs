import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

test('runtime heartbeat is scheduled independently of the blocking investigation loop', async () => {
  const sourcePath = fileURLToPath(new URL('../src/index.mjs', import.meta.url));
  const source = await readFile(sourcePath, 'utf8');

  assert.match(source, /let heartbeatInFlight = null/);
  assert.match(source, /if \(heartbeatInFlight\) return heartbeatInFlight/);
  assert.match(source, /const heartbeatInterval = setInterval\(\(\) =>/);
  assert.match(source, /heartbeatInterval\.unref\(\)/);
  assert.match(source, /clearInterval\(heartbeatInterval\)/);

  const heartbeatPosition = source.indexOf('const heartbeatInterval = setInterval');
  const investigationPosition = source.indexOf('await executeInvestigation');
  assert.ok(heartbeatPosition >= 0);
  assert.ok(investigationPosition > heartbeatPosition);
});
