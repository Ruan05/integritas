import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /ghp_[A-Za-z0-9]{36,}/,
  /github_pat_[A-Za-z0-9_]{30,}/,
  /sk-[A-Za-z0-9_-]{20,}/,
  /sb_secret_[A-Za-z0-9_-]{20,}/,
];

function filesUnder(path) {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(path, entry.name)) : [join(path, entry.name)],
  );
}

const requested = process.argv.slice(2);
const files = requested.length
  ? requested.flatMap(filesUnder)
  : execFileSync('git', ['ls-files'], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);

const failures = [];
for (const file of files) {
  if (/(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example')) {
    failures.push(`tracked environment file: ${file}`);
    continue;
  }

  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  if (secretPatterns.some((pattern) => pattern.test(text))) {
    failures.push(`credential-shaped value: ${file}`);
  }
}

if (failures.length) {
  console.error('Secret verification failed:\n' + failures.join('\n'));
  process.exit(1);
}

console.log(`Secret verification passed for ${files.length} file(s).`);
