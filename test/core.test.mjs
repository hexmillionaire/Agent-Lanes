import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rename, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startTask, readTask, checkTask, classify, validateId, validatePattern, updateTask, handoff, listTasks } from '../src/core.mjs';

const cli = fileURLToPath(new URL('../bin/agent-lanes.mjs', import.meta.url));
function git(root, ...args) { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }); }
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-lanes-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'config', 'core.autocrlf', 'false');
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src', 'app.js'), 'export const value = 1;\n');
  await writeFile(path.join(root, '.gitignore'), '.agent-lanes/\nignored/\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'Fixture');
  const task = await startTask(root, { id: 'login', goal: 'Fix login', allow: ['src/**'], deny: ['src/secret*'], agent: 'codex' });
  return { root, task };
}

test('glob semantics, deny precedence, and literal dotfiles', () => {
  const task = { allow: ['src/**', '.github/**'], deny: ['src/private/**'] };
  assert.equal(classify('src/app.js', task).verdict, 'allowed');
  assert.equal(classify('src/deep/app.js', task).verdict, 'allowed');
  assert.equal(classify('src/private/app.js', task).verdict, 'denied');
  assert.equal(classify('.github/workflows/ci.yml', task).verdict, 'allowed');
  assert.equal(classify('docs/app.js', task).verdict, 'outside');
  assert.equal(classify('src/deep/app.js', { allow: ['src/*.js'], deny: [] }).verdict, 'outside');
  assert.equal(classify('.agent-lanes-policy.json', { allow: ['*.json'], deny: [] }).verdict, 'outside');
  assert.equal(classify('.agent-lanes-policy.json', { allow: ['.agent-lanes-policy.json'], deny: [] }).verdict, 'allowed');
});

test('reject path traversal, options as refs, and unsupported patterns', async t => {
  for (const id of ['../secret', 'UPPER', '', '-flag', 'a/b']) assert.throws(() => validateId(id));
  for (const glob of ['../**', '/tmp/**', 'C:/data/**', '**\\x', '!src/**', 'src/{a,b}', 'src/[ab]']) assert.throws(() => validatePattern(glob));
  const { root } = await fixture(t);
  await assert.rejects(startTask(root, { id: 'bad', goal: 'x', allow: ['**'], base: '--help' }));
});

test('clean task has no changes and does not claim verified tests', async t => {
  const { root, task } = await fixture(t);
  const report = await checkTask(root, task);
  assert.equal(report.ok, true);
  assert.deepEqual(report.changes, []);
  assert.match(handoff(report), /tests and code correctness have not been verified/i);
});

test('includes unstaged edits, denied files and untracked files with spaces', async t => {
  const { root, task } = await fixture(t);
  await writeFile(path.join(root, 'src', 'app.js'), 'changed\n');
  await writeFile(path.join(root, 'src', 'secret.env'), 'fixture\n');
  await writeFile(path.join(root, 'outside name.txt'), 'outside\n');
  const report = await checkTask(root, task);
  assert.equal(report.ok, false);
  assert.deepEqual(report.counts, { allowed: 1, outside: 1, denied: 1 });
  assert.equal(report.changes.find(file => file.path === 'outside name.txt').status, '?');
});

test('includes staged changes and later commits since the captured base', async t => {
  const { root, task } = await fixture(t);
  await writeFile(path.join(root, 'src', 'app.js'), 'staged\n');
  git(root, 'add', 'src/app.js');
  assert.equal((await checkTask(root, task)).changes.length, 1);
  git(root, 'commit', '-qm', 'Change');
  assert.equal((await checkTask(root, task)).changes.length, 1);
});

test('rename audits both old and new paths', async t => {
  const { root, task } = await fixture(t);
  await rename(path.join(root, 'src', 'app.js'), path.join(root, 'outside.js'));
  git(root, 'add', '-A');
  const report = await checkTask(root, task);
  assert.equal(report.ok, false);
  assert.equal(report.changes.find(file => file.path === 'src/app.js').status, 'D');
  assert.equal(report.changes.find(file => file.path === 'outside.js').verdict, 'outside');
});

test('ignored files and task storage are excluded', async t => {
  const { root, task } = await fixture(t);
  await mkdir(path.join(root, 'ignored'));
  await writeFile(path.join(root, 'ignored', 'secret'), 'fixture\n');
  assert.deepEqual((await checkTask(root, task)).changes, []);
});

test('duplicate tasks are refused; notes cannot silently widen scope', async t => {
  const { root, task } = await fixture(t);
  await assert.rejects(startTask(root, { id: task.id, goal: 'different', allow: ['**'] }), /EEXIST/);
  await assert.rejects(updateTask(root, task.id, { allow: ['**'] }), /Cannot update allow/);
  await updateTask(root, task.id, { state: 'blocked', next: 'Need credentials' });
  assert.equal((await readTask(root, task.id)).state, 'blocked');
  assert.equal((await listTasks(root)).length, 1);
});

test('trusted repository aliases work, but symlinked task storage is refused', async t => {
  const { root } = await fixture(t);
  const parent = await mkdtemp(path.join(os.tmpdir(), 'agent-lanes-alias-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const alias = path.join(parent, 'repo');
  await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await readTask(alias, 'login')).id, 'login');
  const other = path.join(parent, 'other');
  await mkdir(other);
  await symlink(path.join(root, '.agent-lanes'), path.join(other, '.agent-lanes'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(readTask(other, 'login'), /real directory/);
});

test('submodule repositories fail closed', async t => {
  const { root, task } = await fixture(t);
  const head = git(root, 'rev-parse', 'HEAD').trim();
  git(root, 'update-index', '--add', '--cacheinfo', `160000,${head},nested`);
  const report = await checkTask(root, task);
  assert.equal(report.ok, false);
  assert.deepEqual(report.submodules, ['nested']);
});

test('unresolved merge conflicts fail even when every path is allowed', async t => {
  const { root, task } = await fixture(t);
  const original = git(root, 'branch', '--show-current').trim();
  git(root, 'checkout', '-qb', 'other');
  await writeFile(path.join(root, 'src', 'app.js'), 'other\n');
  git(root, 'commit', '-qam', 'Other');
  git(root, 'checkout', '-q', original);
  await writeFile(path.join(root, 'src', 'app.js'), 'current\n');
  git(root, 'commit', '-qam', 'Current');
  assert.throws(() => git(root, 'merge', 'other'));
  const report = await checkTask(root, task);
  assert.equal(report.ok, false);
  assert.deepEqual(report.conflicts, ['src/app.js']);
});

test('invalid task JSON fails with error rather than a reassuring result', async t => {
  const { root } = await fixture(t);
  await writeFile(path.join(root, '.agent-lanes', 'login.json'), '{}');
  await assert.rejects(readTask(root, 'login'), /Unsupported task format/);
});

test('CLI returns distinct scope and input errors, with clean JSON output', async t => {
  const { root } = await fixture(t);
  let result = spawnSync(process.execPath, [cli, 'check', 'login', '--repo', root, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);
  await writeFile(path.join(root, 'outside.txt'), 'outside\n');
  result = spawnSync(process.execPath, [cli, 'check', 'login', '--repo', root, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, false);
  result = spawnSync(process.execPath, [cli, 'check', 'login', '--repo', root, '--allow', '**'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
});

test('notes advance timestamps and a full task directory rejects a new task', async t => {
  const { root, task } = await fixture(t);
  const first = await updateTask(root, task.id, { state: 'working' });
  const second = await updateTask(root, task.id, { state: 'review' });
  assert.ok(second.updatedAt > first.updatedAt);
  for (let i = 1; i < 200; i++) await writeFile(path.join(root, '.agent-lanes', `task-${i}.json`), JSON.stringify({ ...task, id: `task-${i}` }));
  await assert.rejects(startTask(root, { id: 'overflow', goal: 'x', allow: ['src/**'] }), /At most 200/);
});
