import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { runPipeline, renderReview } from './pipeline.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const input = JSON.parse(await readFile(join(root, 'examples/event.json'), 'utf8'));
const result = runPipeline(input, { now: '2026-10-30T16:00:00Z' });
const output = join(root, 'demo-output');
await mkdir(output, { recursive: true });
await writeFile(join(output, 'manifest.json'), JSON.stringify(result, null, 2) + '\n');
await writeFile(join(output, 'review.md'), renderReview(result));
console.log(`${result.status.toUpperCase()}: ${result.decisions.length} contacts, ${result.drafts.length} draft previews, ${result.workOrders.length} CRM work orders.`);
console.log(`Review: ${join(output, 'review.md')}`);
console.log('No API calls, messages, or CRM writes were made.');
