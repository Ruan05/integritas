import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('worker release attests investigation capabilities', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const source = await readFile(new URL('src/index.mjs', root), 'utf8');

  assert.equal(pkg.version, '0.2.0');
  assert.match(source, /INTEGRITAS_CONTROL_WORKER_VERSION \|\| '0\.2\.0'/);
  for (const capability of ['case_investigation', 'signed_manifests', 'durable_checkpoints']) {
    assert.match(source, new RegExp(`${capability}: true`));
  }
  assert.match(source, /arbitrary_shell: false/);
  assert.match(source, /docker_socket: false/);
});
