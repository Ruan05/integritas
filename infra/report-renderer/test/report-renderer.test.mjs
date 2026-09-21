import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderReport } from '../render-report.mjs';
import { buildIndexHtml, buildRenderSpec, sanitizeMarkdown } from '../template.mjs';

function bundle(markdown) {
  return {
    schema_version: 1,
    case_id: '11111111-1111-4111-8111-111111111111',
    case_job_id: '22222222-2222-4222-8222-222222222222',
    case_revision: 2,
    depth: 'maximum',
    generated_at: '2026-09-21T18:00:00.000Z',
    entities: [{ entity_type: 'company' }, { entity_type: 'person' }],
    findings: [
      { evidence_status: 'verified' },
      { evidence_status: 'conflicting' },
    ],
    checks: [{ status: 'complete' }, { status: 'blocked' }],
    sources: [
      { evidence_origin: 'submitted_document' },
      { evidence_origin: 'external_research' },
    ],
    contradictions: [{}],
    unresolved_checks: [{}],
    report: { status: 'draft', markdown },
    execution: { terminal_outcome: 'incomplete' },
  };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

test('markdown sanitizer neutralizes raw HTML, unsafe links and remote images', () => {
  const raw = '# Report\n<script>alert(1)</script>\n![x](https://evil.example/x.png)\n[click](javascript:alert(1))';
  const clean = sanitizeMarkdown(raw);
  assert.doesNotMatch(clean, /<script>/i);
  assert.doesNotMatch(clean, /!\[x\]/);
  assert.doesNotMatch(clean, /javascript:/i);
  assert.match(clean, /Image omitted: x/);
});

test('template derives visual metrics from structured evidence', () => {
  const markdown = '# MASTER SUMMARY — READ THIS FIRST\n';
  const value = bundle(markdown);
  const spec = buildRenderSpec(value);
  assert.equal(spec.counts.entities, 2);
  assert.equal(spec.counts.findings, 2);
  assert.equal(spec.counts.external_sources, 1);
  assert.equal(spec.counts.unresolved, 1);
  assert.equal(spec.check_completion_percent, 50);
  const html = buildIndexHtml(value);
  assert.match(html, /Evidence dashboard/);
  assert.match(html, /\{\{ toHTML "report\.md" \}\}/);
  assert.match(html, /integritas-report-v1/);
});

test('renderer health-checks Gotenberg and writes PDF plus audit sidecars atomically', async () => {
  let renderCalls = 0;
  let observedTrace = '';
  const server = createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'up', details: { chromium: { status: 'up' } } }));
      return;
    }
    if (req.url === '/forms/chromium/convert/markdown' && req.method === 'POST') {
      renderCalls += 1;
      observedTrace = String(req.headers['gotenberg-trace'] ?? '');
      req.resume();
      req.on('end', () => {
        const pdf = Buffer.from('%PDF-1.4\n% Integritas renderer test\n%%EOF\n');
        res.writeHead(200, { 'content-type': 'application/pdf' });
        res.end(pdf);
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const baseUrl = await listen(server);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'integritas-renderer-'));
  const markdown = '# MASTER SUMMARY — READ THIS FIRST\n\nSynthetic renderer fixture.\n';
  const bundlePath = path.join(dir, 'bundle.json');
  const markdownPath = path.join(dir, 'report.md');
  const outputPath = path.join(dir, 'report.pdf');
  await writeFile(bundlePath, JSON.stringify(bundle(markdown)));
  await writeFile(markdownPath, markdown);

  try {
    const result = await renderReport({
      bundlePath,
      markdownPath,
      outputPath,
      gotenbergUrl: baseUrl,
      trace: 'test-render-trace',
    });
    assert.equal(renderCalls, 1);
    assert.equal(observedTrace, 'test-render-trace');
    assert.equal(result.pdf_sha256.length, 64);
    const pdf = await readFile(outputPath);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    const metadata = JSON.parse(await readFile(`${outputPath}.json`, 'utf8'));
    assert.equal(metadata.template_version, 'integritas-report-v1');
    const renderSpec = JSON.parse(await readFile(`${outputPath}.render.json`, 'utf8'));
    assert.equal(renderSpec.counts.contradictions, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('renderer refuses markdown that does not match the canonical bundle report', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'integritas-renderer-mismatch-'));
  const bundlePath = path.join(dir, 'bundle.json');
  const markdownPath = path.join(dir, 'report.md');
  await writeFile(bundlePath, JSON.stringify(bundle('# Canonical\n')));
  await writeFile(markdownPath, '# Different\n');
  await assert.rejects(
    renderReport({
      bundlePath,
      markdownPath,
      outputPath: path.join(dir, 'report.pdf'),
      gotenbergUrl: 'http://127.0.0.1:9',
    }),
    /bundle\/report markdown mismatch/,
  );
});
