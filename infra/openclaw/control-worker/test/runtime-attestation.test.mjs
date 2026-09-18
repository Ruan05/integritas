import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('worker release attests investigation capabilities from the packaged release', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const source = await readFile(new URL('src/index.mjs', root), 'utf8');

  assert.equal(pkg.version, '0.3.6');
  assert.match(source, /readPackagedWorkerVersion/);
  assert.match(source, /new URL\('\.\.\/package\.json', import\.meta\.url\)/);
  assert.doesNotMatch(source, /INTEGRITAS_CONTROL_WORKER_VERSION/);
  for (const capability of ['case_investigation', 'signed_manifests', 'durable_checkpoints', 'deterministic_qa', 'atomic_bundle_commit']) {
    assert.match(source, new RegExp(`${capability}: true`));
  }
  assert.match(source, /arbitrary_shell: false/);
  assert.match(source, /docker_socket: false/);

  const service = await readFile(new URL('../../integritas-control-worker.service', import.meta.url), 'utf8');
  assert.match(service, /^Group=integritas-openclaw$/m);
  assert.match(service, /^RestrictSUIDSGID=true$/m);
  assert.doesNotMatch(service, /^Group=integritas-control$/m);

  const runnerService = await readFile(new URL('../../integritas-openclaw-investigation@.service', import.meta.url), 'utf8');
  assert.match(runnerService, /^Group=integritas-openclaw$/m);
  assert.match(runnerService, /^SupplementaryGroups=openclaw docker$/m);
  assert.match(runnerService, /^RestrictSUIDSGID=true$/m);

  const investigationConfig = await readFile(new URL('../../integritas-investigation.json5', import.meta.url), 'utf8');
  assert.match(investigationConfig, /workspaceAccess:\s*["']ro["']/);
  for (const denied of ['write', 'edit', 'exec', 'apply_patch']) {
    assert.match(investigationConfig, new RegExp(`deny:[\\s\\S]*["']${denied}["']`));
  }
  assert.match(investigationConfig, /alsoAllow:\s*\[[^\]]*["']browser["']/);
});
