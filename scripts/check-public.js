import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ignored = new Set(['.git', 'node_modules', 'demo-output']);
const patterns = [
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{16,}/g],
  ['API key', /\b(?:sk-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{25,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})/g],
  ['HubSpot token', /\bpat-[a-z]{2,}\d*-[A-Za-z0-9-]{20,}/g],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['Google resource URL', /https:\/\/(?:docs|script|drive)\.google\.com\/[^\s"'<>]+/g],
  ['Slack workspace URL', /https:\/\/[\w-]+\.slack\.com\/[^\s"'<>]*/g],
  ['Provider resource ID', /\b[A-Za-z0-9_-]{30,}\b/g],
  ['Slack resource ID', /\b[CGUWT][A-Z0-9]{8,}\b/g],
  ['Email address outside example domains', /[\w.+-]+@(?!example\.(?:com|org|net)\b)[\w.-]+\.[a-z]{2,}/gi]
];
const forbiddenNames = /^(?:\.env(?:\..*)?|\.clasp(?:rc)?\.json|project\.json|credentials.*\.json)$/;
const findings = [];
let files = 0;
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(dir, entry.name); const name = relative(root, path);
    if (entry.isSymbolicLink()) { findings.push({ file: name, kind: 'Symlink requires review' }); continue; }
    if (entry.isDirectory()) { await walk(path); continue; }
    files++;
    if (forbiddenNames.test(entry.name)) findings.push({ file: name, kind: 'Private configuration filename' });
    const text = await readFile(path, 'utf8');
    for (const [kind, regex] of patterns) {
      regex.lastIndex = 0;
      for (const match of text.matchAll(regex)) {
        // Ordinary long source identifiers are allowed only if they lack digits or symbol mixing.
        if (kind === 'Provider resource ID' && !(/[a-z]/.test(match[0]) && /[A-Z0-9_-]/.test(match[0]) && /\d/.test(match[0]))) continue;
        findings.push({ file: name, line: text.slice(0, match.index).split('\n').length, kind });
      }
    }
  }
}
await walk(root);
console.log(JSON.stringify({ filesScanned: files, findings }, null, 2));
process.exitCode = findings.length ? 1 : 0;
