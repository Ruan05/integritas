import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildFooterHtml,
  buildHeaderHtml,
  buildIndexHtml,
  buildRenderSpec,
  sanitizeMarkdown,
  TEMPLATE_VERSION,
} from './template.mjs';

const DEFAULT_GOTENBERG_URL = 'http://127.0.0.1:3000';
const MAX_BUNDLE_BYTES = 12 * 1024 * 1024;
const MAX_MARKDOWN_BYTES = 5 * 1024 * 1024;
const MAX_ERROR_BODY = 4000;

function normalizeBaseUrl(value) {
  const url = new URL(value || DEFAULT_GOTENBERG_URL);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Gotenberg URL protocol is invalid');
  return url.toString().replace(/\/$/, '');
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function atomicWrite(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o750 });
  const temporary = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporary, data, { mode: 0o640 });
  await rename(temporary, filePath);
}

function assertBundle(bundle, markdown) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) throw new Error('bundle must be an object');
  if (bundle.schema_version !== 1) throw new Error('unsupported bundle schema version');
  if (!bundle.case_id || !bundle.case_job_id) throw new Error('bundle identity is incomplete');
  if (!bundle.report || bundle.report.status !== 'draft') throw new Error('renderer only accepts draft canonical reports');
  if (typeof bundle.report.markdown !== 'string') throw new Error('bundle report markdown is missing');
  if (bundle.report.markdown !== markdown) throw new Error('bundle/report markdown mismatch');
}

function safeTrace(bundle, trace) {
  if (trace) return String(trace).replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 128);
  return `integritas-${String(bundle.case_job_id).slice(0, 8)}-${Date.now()}`;
}

async function checkHealth(baseUrl, trace) {
  const response = await fetch(`${baseUrl}/health`, {
    method: 'GET',
    headers: { 'Gotenberg-Trace': trace },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Gotenberg health check failed with HTTP ${response.status}`);
  const body = await response.json().catch(() => null);
  if (body?.status && body.status !== 'up') throw new Error('Gotenberg reported unhealthy status');
}

function appendFile(form, name, content, type) {
  form.append('files', new Blob([content], { type }), name);
}

async function convertMarkdown({ baseUrl, trace, indexHtml, markdown, headerHtml, footerHtml }) {
  const form = new FormData();
  appendFile(form, 'index.html', indexHtml, 'text/html');
  appendFile(form, 'report.md', markdown, 'text/markdown');
  appendFile(form, 'header.html', headerHtml, 'text/html');
  appendFile(form, 'footer.html', footerHtml, 'text/html');
  form.append('printBackground', 'true');
  form.append('generateDocumentOutline', 'true');
  form.append('generateTaggedPdf', 'true');
  form.append('failOnConsoleExceptions', 'true');
  form.append('failOnResourceLoadingFailed', 'true');
  form.append('skipNetworkAlmostIdleEvent', 'false');
  form.append('preferCssPageSize', 'true');
  form.append('emulatedMediaType', 'print');

  const response = await fetch(`${baseUrl}/forms/chromium/convert/markdown`, {
    method: 'POST',
    headers: {
      'Gotenberg-Trace': trace,
      'Gotenberg-Output-Filename': 'integritas-report',
    },
    body: form,
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) {
    const body = (await response.text().catch(() => '')).slice(0, MAX_ERROR_BODY);
    throw new Error(`Gotenberg render failed with HTTP ${response.status}: ${body}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 8 || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new Error('Gotenberg response is not a PDF');
  }
  return bytes;
}

export async function renderReport({
  bundlePath,
  markdownPath,
  outputPath,
  gotenbergUrl = process.env.GOTENBERG_URL || DEFAULT_GOTENBERG_URL,
  trace,
}) {
  const started = Date.now();
  const [bundleBytes, markdownBytes] = await Promise.all([
    readFile(bundlePath),
    readFile(markdownPath),
  ]);
  if (bundleBytes.length > MAX_BUNDLE_BYTES) throw new Error('bundle exceeds renderer size limit');
  if (markdownBytes.length > MAX_MARKDOWN_BYTES) throw new Error('markdown exceeds renderer size limit');

  const bundle = JSON.parse(bundleBytes.toString('utf8'));
  const markdown = markdownBytes.toString('utf8');
  assertBundle(bundle, markdown);
  const safeMarkdown = sanitizeMarkdown(markdown);
  const renderSpec = buildRenderSpec(bundle);
  const baseUrl = normalizeBaseUrl(gotenbergUrl);
  const requestTrace = safeTrace(bundle, trace);

  await checkHealth(baseUrl, requestTrace);
  const pdf = await convertMarkdown({
    baseUrl,
    trace: requestTrace,
    indexHtml: buildIndexHtml(bundle),
    markdown: safeMarkdown,
    headerHtml: buildHeaderHtml(bundle),
    footerHtml: buildFooterHtml(),
  });
  const digest = sha256(pdf);
  const finishedAt = new Date().toISOString();
  await atomicWrite(outputPath, pdf);

  const metadata = {
    schema_version: 1,
    case_id: bundle.case_id,
    case_job_id: bundle.case_job_id,
    case_revision: bundle.case_revision,
    source_bundle_sha256: sha256(bundleBytes),
    source_markdown_sha256: sha256(markdownBytes),
    pdf_sha256: digest,
    pdf_bytes: pdf.length,
    renderer: 'integritas-report-renderer',
    template_version: TEMPLATE_VERSION,
    gotenberg_url: baseUrl,
    gotenberg_trace: requestTrace,
    rendered_at: finishedAt,
    elapsed_ms: Date.now() - started,
  };
  const metadataPath = `${outputPath}.json`;
  const specPath = `${outputPath}.render.json`;
  await atomicWrite(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  await atomicWrite(specPath, `${JSON.stringify(renderSpec, null, 2)}\n`);
  return { ...metadata, output_path: outputPath, metadata_path: metadataPath, render_spec_path: specPath };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${key}`);
    args[key.slice(2)] = value;
    i += 1;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.bundle || !args.markdown || !args.output) {
    throw new Error('usage: render-report.mjs --bundle bundle.json --markdown report.md --output report.pdf [--gotenberg http://127.0.0.1:3000] [--trace id]');
  }
  const result = await renderReport({
    bundlePath: path.resolve(args.bundle),
    markdownPath: path.resolve(args.markdown),
    outputPath: path.resolve(args.output),
    gotenbergUrl: args.gotenberg,
    trace: args.trace,
  });
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack ?? error)}\n`);
    process.exitCode = 1;
  });
}
