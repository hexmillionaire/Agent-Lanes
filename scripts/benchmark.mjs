// Measure real Git audits, including many tasks sharing the same captured base.
import { parseArgs } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { values } = parseArgs({ options: { tasks: { type: 'string', default: '20' }, files: { type: 'string', default: '200' }, runs: { type: 'string', default: '3' }, bases: { type: 'string', default: '1' }, core: { type: 'string' } } });
const { checkAll, VERSION } = await import(values.core ? pathToFileURL(path.resolve(values.core)).href : '../src/core.mjs');
const counts = Object.fromEntries(['tasks', 'files', 'runs', 'bases'].map(key => [key, Number(values[key])]));
if (!Number.isInteger(counts.tasks) || counts.tasks < 1 || counts.tasks > 200 || !Number.isInteger(counts.files) || counts.files < 1 || counts.files > 10000 || !Number.isInteger(counts.runs) || counts.runs < 1 || counts.runs > 10 || !Number.isInteger(counts.bases) || counts.bases < 1 || counts.bases > counts.tasks) throw new Error('Use 1-200 tasks, 1-10000 files, 1-10 runs, and 1 base per task at most.');
const temporaryBase = await realpath(os.tmpdir());
const root = await mkdtemp(path.join(temporaryBase, 'agent-lanes-benchmark-'));
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim();
try {
  git('init', '-q'); git('config', 'user.name', 'Benchmark'); git('config', 'user.email', 'benchmark@example.invalid'); git('config', 'core.autocrlf', 'false');
  await mkdir(path.join(root, 'src')); await mkdir(path.join(root, '.agent-lanes'));
  await writeFile(path.join(root, '.gitignore'), '.agent-lanes/\n');
  await Promise.all(Array.from({ length: counts.files }, (_, i) => writeFile(path.join(root, 'src', `file-${i}.txt`), 'before\n')));
  git('add', '.'); git('commit', '-qm', 'Fixture');
  const bases = [git('rev-parse', 'HEAD')]; const now = new Date().toISOString();
  for (let i = 1; i < counts.bases; i++) {
    await writeFile(path.join(root, 'src', 'file-0.txt'), `base ${i}\n`);
    git('add', '.'); git('commit', '-qm', `Base ${i}`); bases.push(git('rev-parse', 'HEAD'));
  }
  await Promise.all(Array.from({ length: counts.tasks }, (_, i) => {
    const task = { version: 1, id: `task-${i}`, goal: 'Measure audit performance', allow: ['src/**'], deny: [], agent: 'benchmark', base: bases[i % bases.length], state: 'working', summary: '', next: '', createdAt: now, updatedAt: now };
    return writeFile(path.join(root, '.agent-lanes', `${task.id}.json`), JSON.stringify(task));
  }));
  await writeFile(path.join(root, 'src', 'file-0.txt'), 'after\n');
  const elapsedMs = [];
  for (let i = 0; i < counts.runs; i++) {
    const start = performance.now(); const reports = await checkAll(root); elapsedMs.push(Math.round(performance.now() - start));
    if (reports.length !== counts.tasks || reports.some(report => !report.ok || report.changes.length !== 1)) throw new Error('Benchmark fixture audit failed.');
  }
  console.log(JSON.stringify({ version: VERSION, platform: process.platform, node: process.version, ...counts, elapsedMs, medianMs: [...elapsedMs].sort((a, b) => a - b)[Math.floor(elapsedMs.length / 2)] }, null, 2));
} finally {
  if (path.dirname(root) !== temporaryBase || !path.basename(root).startsWith('agent-lanes-benchmark-')) throw new Error('Unexpected benchmark cleanup path.');
  await rm(root, { recursive: true, force: true });
}
