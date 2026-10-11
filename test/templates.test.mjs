import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readTemplates } from '../src/templates.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lanes-templates-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return { root, file: path.join(root, '.agent-lanes-templates.json') };
}
test('missing templates and normalized data-only records', async t => {
  const { root, file } = await fixture(t);
  assert.deepEqual(await readTemplates(root), { version: 1, templates: [] });
  await writeFile(file, JSON.stringify({ version: 1, templates: [{ id: 'fix', allow: ['src/**'] }] }));
  assert.deepEqual((await readTemplates(root)).templates[0], { id: 'fix', name: 'fix', description: '', allow: ['src/**'], deny: [] });
});
test('templates reject commands, traversal, duplicate ids, unsupported versions and excess entries', async t => {
  const { root, file } = await fixture(t);
  const good = { id: 'fix', allow: ['src/**'] };
  for (const document of [
    { version: 2, templates: [] }, { version: 1, templates: [], command: 'echo unsafe' },
    { version: 1, templates: [{ ...good, command: 'echo unsafe' }] },
    { version: 1, templates: [{ ...good, allow: ['../outside'] }] },
    { version: 1, templates: [good, good] }, { version: 1, templates: Array(51).fill(good) },
    { version: 1, templates: [{ ...good, deny: null }] },
  ]) { await writeFile(file, JSON.stringify(document)); await assert.rejects(readTemplates(root)); }
});
test('templates reject oversized bytes, invalid UTF-8 and cancelled reads', async t => {
  const { root, file } = await fixture(t);
  await writeFile(file, Buffer.alloc(65537)); await assert.rejects(readTemplates(root), /64 KiB/);
  await writeFile(file, Buffer.from([0xff])); await assert.rejects(readTemplates(root));
  await assert.rejects(readTemplates(root, { signal: AbortSignal.abort() }));
});
test('templates refuse symbolic links', async t => {
  const { root, file } = await fixture(t);
  const source = path.join(root, 'source.json'); await writeFile(source, '{"version":1,"templates":[]}');
  try { await symlink(source, file); } catch (error) { if (process.platform === 'win32' && error.code === 'EPERM') return t.skip('Windows symlink privilege unavailable'); throw error; }
  await assert.rejects(readTemplates(root), /regular JSON/);
});
