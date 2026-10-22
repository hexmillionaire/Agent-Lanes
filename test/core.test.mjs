import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rename, rm, symlink, readdir, unlink } from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import childProcess from 'node:child_process';
import { promisify } from 'node:util';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startTask, readTask, checkTask, checkTasks, checkAll, classify, validateId, validatePattern, updateTask, writerLockStatus, handoff, listTasks, git as executeGit } from '../src/core.mjs';

const cli = fileURLToPath(new URL('../bin/agent-lanes.mjs', import.meta.url));
function git(root, ...args) { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }); }
async function removeFixture(root, prefix) {
  const target = path.resolve(root);
  assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
  assert.ok(path.basename(target).startsWith(prefix) && path.basename(target).length > prefix.length, 'Cleanup must target the created fixture directory.');
  await rm(target, { recursive: true, force: true, maxRetries: process.platform === 'win32' ? 5 : 0, retryDelay: 100 });
}
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-lanes-test-'));
  t.after(() => removeFixture(root, 'agent-lanes-test-'));
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

function writerProcess(root, operation) {
  // Independent Node processes exercise filesystem coordination, rather than an
  // in-process queue. The publication gate gives the second writer a stale-read
  // opportunity in the old implementation while holding a real lock in the new.
  const script = `
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    const input = JSON.parse(process.argv[1]);
    const core = await import(input.core);
    const wait = type => new Promise(resolve => process.on('message', function listener(message) {
      if (message.type === type) { process.off('message', listener); resolve(); }
    }));
    if (input.gate) {
      const original = fs.rename;
      fs.rename = async (...args) => {
        process.send({ type: 'held' });
        await wait('release');
        return original(...args);
      };
      syncBuiltinESMExports();
    }
    const go = wait('go');
    process.send({ type: 'ready' });
    await go;
    let timer;
    const controller = new AbortController();
    if (input.cancelAfter) timer = setTimeout(() => controller.abort(new Error('Cancel waiting writer')), input.cancelAfter);
    let result;
    try {
      const task = input.start
        ? await core.startTask(input.root, input.start, { signal: controller.signal })
        : await core.updateTask(input.root, 'login', input.updates, { expectedUpdatedAt: input.expectedUpdatedAt, signal: controller.signal });
      result = { type: 'result', ok: true, task };
    } catch (error) {
      result = { type: 'result', ok: false, error: { code: error.code, message: error.message, currentTask: error.currentTask } };
    } finally { clearTimeout(timer); }
    process.send(result, () => process.disconnect());
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, JSON.stringify({ core: new URL('../src/core.mjs', import.meta.url).href, root, ...operation })], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const seen = new Map();
  const listeners = new Map();
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('message', message => { seen.set(message.type, message); listeners.get(message.type)?.(message); });
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  const result = closed.then(({ code, signal }) => {
    if (!seen.has('result')) throw new Error(`Writer exited without a result (${code ?? signal}): ${stderr}`);
    return seen.get('result');
  });
  result.catch(() => {});
  return {
    child, result,
    wait: type => seen.has(type) ? Promise.resolve(seen.get(type)) : Promise.race([new Promise(resolve => listeners.set(type, resolve)), closed.then(() => { throw new Error(`Writer exited before ${type}: ${stderr}`); })]),
    send: type => child.send({ type }),
    stop: async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await closed; },
  };
}

test('separate writers retain unrelated fields and advance revisions under publication contention', { timeout: 15000 }, async t => {
  const { root, task } = await fixture(t);
  const first = writerProcess(root, { updates: { summary: 'First process summary' }, gate: true });
  const second = writerProcess(root, { updates: { next: 'Second process next step' } });
  try {
    await Promise.all([first.wait('ready'), second.wait('ready')]);
    first.send('go'); await first.wait('held');
    second.send('go');
    // Give the independent writer time to enter its operation while the first
    // is blocked immediately before publishing. It must wait for that owner.
    await new Promise(resolve => setTimeout(resolve, 100));
    first.send('release');
    const [a, b] = await Promise.all([first.result, second.result]);
    assert.ok(a.ok && b.ok, JSON.stringify([a, b]));
    const current = await readTask(root, task.id);
    assert.equal(current.summary, 'First process summary');
    assert.equal(current.next, 'Second process next step');
    assert.ok(b.task.updatedAt > a.task.updatedAt && a.task.updatedAt > task.updatedAt);
    assert.deepEqual(await writerLockStatus(root), { locked: false, owner: null });
  } finally { await Promise.all([first.stop(), second.stop()]); }
});

test('separate revision-checked writers have one winner and a typed conflict containing the current task', { timeout: 15000 }, async t => {
  const { root, task } = await fixture(t);
  const writers = [writerProcess(root, { updates: { summary: 'Writer A' }, expectedUpdatedAt: task.updatedAt }), writerProcess(root, { updates: { summary: 'Writer B' }, expectedUpdatedAt: task.updatedAt })];
  try {
    await Promise.all(writers.map(writer => writer.wait('ready')));
    writers.forEach(writer => writer.send('go'));
    const results = await Promise.all(writers.map(writer => writer.result));
    assert.equal(results.filter(result => result.ok).length, 1);
    const conflict = results.find(result => !result.ok);
    assert.equal(conflict.error.code, 'TASK_CONFLICT');
    assert.deepEqual(conflict.error.currentTask, await readTask(root, 'login'));
    assert.equal(conflict.error.currentTask.version, 1);
  } finally { await Promise.all(writers.map(writer => writer.stop())); }
});

test('concurrent task creators enforce the shared 200-task capacity', { timeout: 15000 }, async t => {
  const { root, task } = await fixture(t);
  for (let i = 1; i < 199; i++) await writeFile(path.join(root, '.agent-lanes', `task-${i}.json`), JSON.stringify({ ...task, id: `task-${i}` }));
  const writers = Array.from({ length: 4 }, (_, index) => writerProcess(root, { start: { id: `last-${index}`, goal: 'Last available task', allow: ['src/**'] } }));
  try {
    await Promise.all(writers.map(writer => writer.wait('ready')));
    writers.forEach(writer => writer.send('go'));
    const results = await Promise.all(writers.map(writer => writer.result));
    assert.equal(results.filter(result => result.ok).length, 1, JSON.stringify(results));
    assert.ok(results.filter(result => !result.ok).every(result => /At most 200/.test(result.error.message)));
    assert.equal((await listTasks(root)).length, 200);
  } finally { await Promise.all(writers.map(writer => writer.stop())); }
});

test('aborted cross-process writer waits leave the owner intact and allow subsequent updates', { timeout: 15000 }, async t => {
  const { root } = await fixture(t);
  const holder = writerProcess(root, { updates: { summary: 'Held publication' }, gate: true });
  const waiter = writerProcess(root, { updates: { next: 'Must not publish' }, cancelAfter: 100 });
  try {
    await Promise.all([holder.wait('ready'), waiter.wait('ready')]);
    holder.send('go'); await holder.wait('held');
    const owner = await writerLockStatus(root);
    assert.equal(owner.owner.pid, holder.child.pid);
    waiter.send('go');
    const cancelled = await waiter.result;
    assert.equal(cancelled.ok, false);
    assert.equal(cancelled.error.message, 'Cancel waiting writer');
    assert.deepEqual(await writerLockStatus(root), owner);
    holder.send('release'); assert.equal((await holder.result).ok, true);
    const current = await updateTask(root, 'login', { next: 'Saved after cancelled wait' });
    assert.equal(current.summary, 'Held publication');
    assert.equal(current.next, 'Saved after cancelled wait');
    assert.deepEqual((await readdir(path.join(root, '.agent-lanes'))).sort(), ['login.json']);
  } finally { await Promise.all([holder.stop(), waiter.stop()]); }
});

test('killed writer locks fail closed until all writers stop and the exact orphan lock is removed', { timeout: 15000 }, async t => {
  const { root, task } = await fixture(t);
  const holder = writerProcess(root, { updates: { summary: 'Must not publish before crash' }, gate: true });
  try {
    await holder.wait('ready'); holder.send('go'); await holder.wait('held');
    const before = await writerLockStatus(root);
    await holder.stop();
    const status = await writerLockStatus(root);
    assert.deepEqual(status, before);
    await assert.rejects(updateTask(root, 'login', { summary: 'Must not steal orphan lock' }), error => error.code === 'TASK_LOCKED' && error.owner.token === before.owner.token && /stop all/i.test(error.message));
    assert.deepEqual(await readTask(root, 'login'), task);
    assert.deepEqual(await writerLockStatus(root), before);
    // This controlled fixture has no running writers. Recovery removes only the
    // verified lock path inside its own task directory, never the task JSON.
    const lock = path.resolve(root, '.agent-lanes', '.write.lock');
    assert.equal(path.dirname(lock), path.resolve(root, '.agent-lanes'));
    await unlink(lock);
    assert.equal((await updateTask(root, 'login', { summary: 'Saved after explicit recovery' })).summary, 'Saved after explicit recovery');
  } finally { await holder.stop(); }
});

test('CLI exposes revision-checked notes and read-only lock status', async t => {
  const { root, task } = await fixture(t);
  let result = spawnSync(process.execPath, [cli, 'note', 'login', '--repo', root, '--summary', 'Saved once', '--if-updated-at', task.updatedAt, '--json'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const current = JSON.parse(result.stdout);
  result = spawnSync(process.execPath, [cli, 'note', 'login', '--repo', root, '--summary', 'Stale change', '--if-updated-at', task.updatedAt], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Task changed/);
  assert.deepEqual(await readTask(root, 'login'), current);
  result = spawnSync(process.execPath, [cli, 'lock-status', '--repo', root, '--json'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { locked: false, owner: null });
});

test('CLI lists data-only templates and copies their scopes into new tasks', async t => {
  const { root } = await fixture(t);
  await writeFile(path.join(root, '.agent-lanes-templates.json'), JSON.stringify({ version: 1, templates: [{ id: 'frontend', name: 'Frontend changes', allow: ['src/**'], deny: ['src/private/**'] }] }));
  let result = spawnSync(process.execPath, [cli, 'templates', '--repo', root, '--json'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const template = JSON.parse(result.stdout).templates[0];
  assert.equal(template.id, 'frontend');
  result = spawnSync(process.execPath, [cli, 'start', 'ui', '--repo', root, '--goal', 'Fix UI', '--template', 'frontend', '--json'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const task = JSON.parse(result.stdout);
  assert.deepEqual(task.allow, template.allow);
  assert.deepEqual(task.deny, template.deny);
  assert.equal(task.version, 1);
  for (const options of [['--allow', '**'], ['--deny', 'src/**']]) {
    result = spawnSync(process.execPath, [cli, 'start', 'ambiguous', '--repo', root, '--goal', 'x', '--template', 'frontend', ...options], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /without --allow or --deny/);
  }
  result = spawnSync(process.execPath, [cli, 'start', 'unknown', '--repo', root, '--goal', 'x', '--template', 'missing'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown template/);
  assert.equal((await listTasks(root)).length, 2);
});

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

test('deny patterns cover hidden files and directories that an explicit allow names', () => {
  const task = { allow: ['**/.key', '**/.env', 'src/**', 'src/.config/**', '.github/**'], deny: ['secrets/**', 'src/*.env', '.github/**/.*'] };
  assert.equal(classify('secrets/.key', task).verdict, 'denied');
  assert.equal(classify('secrets/deep/.env', task).verdict, 'denied');
  assert.equal(classify('src/.env', task).verdict, 'denied');
  assert.equal(classify('.github/workflows/.hidden', task).verdict, 'denied');
  assert.equal(classify('.github/workflows/ci.yml', task).verdict, 'allowed');
  assert.equal(classify('src/.config/app.json', task).verdict, 'allowed');
  assert.equal(classify('x.env', { allow: ['*'], deny: ['.env'] }).verdict, 'allowed');
  // Allow patterns stay strict: hidden names still need an explicit allow.
  assert.equal(classify('src/.env', { allow: ['src/**'], deny: [] }).verdict, 'outside');
});

test('deny patterns fail closed on case and Unicode normalisation differences', () => {
  // macOS and Windows checkouts open these spellings as the denied path.
  const task = { allow: ['src/**', '*.md'], deny: ['src/secrets/**', 'SECURITY.md', 'src/caf\u00e9/**', 'src/*.PEM'] };
  assert.equal(classify('src/Secrets/key.pem', task).verdict, 'denied');
  assert.equal(classify('SRC/SECRETS/KEY.PEM', task).verdict, 'denied');
  assert.equal(classify('security.md', task).verdict, 'denied');
  assert.equal(classify('src/cafe\u0301/menu.txt', task).verdict, 'denied');
  assert.equal(classify('src/key.pem', task).verdict, 'denied');
  assert.equal(classify('src/Secrets/.hidden', task).verdict, 'denied');
  assert.equal(classify('src/secrets.md', task).verdict, 'allowed');
  // Allow patterns stay byte-exact, so a differently spelled path is outside, never allowed.
  assert.equal(classify('SRC/app.js', { allow: ['src/**'], deny: [] }).verdict, 'outside');
  assert.equal(classify('src/app.js', { allow: ['SRC/**'], deny: [] }).verdict, 'outside');
});

test('handoff keeps carriage-return text inside its quote block', () => {
  const task = { version: 1, id: 'cr', goal: 'Fix\r## Injected heading\r\nnext', allow: ['src/**'], deny: [], agent: 'a', base: 'a'.repeat(40), state: 'working', summary: 'one\rtwo', next: '', createdAt: 'x', updatedAt: 'x' };
  const packet = handoff({ task, branch: 'main', head: 'b'.repeat(40), changes: [], conflicts: [], submodules: [], ok: true });
  assert.ok(!packet.includes('\r'));
  assert.match(packet, /^> ## Injected heading$/m);
  assert.match(packet, /^> two$/m);
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
  const report = await checkTask(root, task);
  assert.deepEqual(report.changes, []);
  assert.equal(report.ok, true);
  // Ignored entries are reported rather than hidden; task storage never is.
  assert.deepEqual(report.ignored, ['ignored/']);
  assert.match(handoff(report), /Ignored by repository rules, not audited: "ignored\/"/);
});

test('repository ignore rules cannot hide new files from the report', async t => {
  const { root, task } = await fixture(t);
  await writeFile(path.join(root, '.gitignore'), '.agent-lanes/\nignored/\n*\n');
  await writeFile(path.join(root, 'src', 'secret.env'), 'fixture\n');
  const report = await checkTask(root, task);
  assert.equal(report.changes.find(file => file.path === '.gitignore').verdict, 'outside');
  assert.deepEqual(report.ignored, ['src/secret.env']);
});

test('a global excludes file does not apply to the audit', async t => {
  const { root, task } = await fixture(t);
  const config = await mkdtemp(path.join(os.tmpdir(), 'agent-lanes-xdg-'));
  t.after(() => removeFixture(config, 'agent-lanes-xdg-'));
  await mkdir(path.join(config, 'git'));
  await writeFile(path.join(config, 'git', 'ignore'), '*.env\n');
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = config;
  t.after(() => { if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous; });
  await writeFile(path.join(root, 'src', 'secret.env'), 'fixture\n');
  const report = await checkTask(root, task);
  assert.equal(report.changes.find(file => file.path === 'src/secret.env').verdict, 'denied');
  assert.deepEqual(report.ignored, []);
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
  t.after(() => removeFixture(parent, 'agent-lanes-alias-'));
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

test('batch audits preserve task order, individual scopes, distinct bases, and freshness', async t => {
  const { root, task: first } = await fixture(t);
  await writeFile(path.join(root, 'src', 'app.js'), 'committed\n');
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'Later base');
  const second = await startTask(root, { id: 'later', goal: 'Later task', allow: ['docs/**'] });
  const third = await startTask(root, { id: 'shared', goal: 'Shared base', allow: ['src/**'], base: first.base });
  const reports = await checkTasks(root, [second, first, third]);
  assert.deepEqual(reports.map(report => report.task.id), ['later', 'login', 'shared']);
  assert.deepEqual(reports.map(report => report.changes.length), [0, 1, 1]);
  assert.ok(reports.every(report => report.ok));
  assert.equal(new Set(reports.map(report => report.checkedAt)).size, 1);
  await writeFile(path.join(root, 'outside.txt'), 'new outside path\n');
  const fresh = await checkAll(root);
  assert.ok(fresh.every(report => !report.ok && report.changes.some(file => file.path === 'outside.txt')));
  await assert.rejects(checkTasks(root, [{ ...first, base: '0'.repeat(40) }]), /Git diff failed/);
  assert.deepEqual(await checkTasks(root, []), []);
});

test('removing a captured submodule still fails closed', async t => {
  const { root } = await fixture(t);
  const head = git(root, 'rev-parse', 'HEAD').trim();
  git(root, 'update-index', '--add', '--cacheinfo', `160000,${head},src/module`);
  git(root, 'commit', '-qm', 'Capture module');
  const task = await startTask(root, { id: 'module', goal: 'Remove module', allow: ['src/**'] });
  git(root, 'update-index', '--force-remove', 'src/module');
  git(root, 'config', 'diff.ignoreSubmodules', 'all');
  const report = await checkTask(root, task);
  assert.equal(report.ok, false);
  assert.deepEqual(report.submodules, ['src/module']);
  assert.equal(report.changes.find(file => file.path === 'src/module').status, 'D');
});

test('notes remain valid JSON during reads and rejected oversized tasks leave no files', async t => {
  const { root } = await fixture(t);
  await Promise.all([
    (async () => { for (let i = 0; i < 40; i++) await updateTask(root, 'login', { summary: `${i} ${'x'.repeat(3900)}` }); })(),
    (async () => { for (let i = 0; i < 100; i++) assert.equal((await readTask(root, 'login')).id, 'login'); })(),
  ]);
  assert.match((await readTask(root, 'login')).summary, /^39 /);
  const oversized = Array.from({ length: 100 }, () => '"'.repeat(256));
  await assert.rejects(startTask(root, { id: 'oversized', goal: 'Too large', allow: oversized, deny: oversized }), /64 KiB/);
  assert.deepEqual((await readdir(path.join(root, '.agent-lanes'))).sort(), ['login.json']);
});

test('Windows task updates survive a temporary replacement lock beyond the initial retry budget', { skip: process.platform !== 'win32' }, async t => {
  const { root } = await fixture(t);
  const original = fsPromises.rename;
  let attempts = 0;
  fsPromises.rename = async (...args) => {
    if (++attempts <= 9) throw Object.assign(new Error('Temporary sharing violation'), { code: 'EPERM' });
    return original(...args);
  };
  syncBuiltinESMExports();
  try {
    const updated = await updateTask(root, 'login', { summary: 'Saved after the reader released its lock.' });
    assert.equal(updated.summary, 'Saved after the reader released its lock.');
    assert.ok(attempts >= 10);
    assert.equal((await readTask(root, 'login')).summary, updated.summary);
  } finally { fsPromises.rename = original; syncBuiltinESMExports(); }
});

test('persistent replacement permission failures preserve the previous task and clean up temporary JSON', async t => {
  const { root } = await fixture(t);
  const previous = await readTask(root, 'login');
  const original = fsPromises.rename;
  let attempts = 0;
  fsPromises.rename = async () => { attempts++; throw Object.assign(new Error('Persistent permission denial'), { code: 'EACCES' }); };
  syncBuiltinESMExports();
  try {
    await assert.rejects(updateTask(root, 'login', { state: 'done', summary: 'Must not replace the previous task.' }), { code: 'EACCES' });
    assert.deepEqual(await readTask(root, 'login'), previous);
    assert.deepEqual(await readdir(path.join(root, '.agent-lanes')), ['login.json']);
    assert.equal(attempts, process.platform === 'win32' ? 23 : 1);
  } finally { fsPromises.rename = original; syncBuiltinESMExports(); }
});

test('cancelled audits and task reads propagate cancellation without reassuring results', async t => {
  const { root, task } = await fixture(t);
  const controller = new AbortController(); const reason = new Error('Client cancelled the audit'); controller.abort(reason);
  for (const operation of [() => readTask(root, task.id, { signal: controller.signal }), () => listTasks(root, { signal: controller.signal }), () => checkTask(root, task, { signal: controller.signal }), () => checkAll(root, { signal: controller.signal }), () => executeGit(root, ['status'], { signal: controller.signal })]) await assert.rejects(operation(), error => error === reason);
});

test('cancellation releases active Git slots and removes queued work promptly', async t => {
  const { root } = await fixture(t);
  const active = new AbortController(); const activeReason = new Error('Stop active Git');
  // hash-object waits for stdin. No aliases, hooks, or timing-sensitive worktree
  // mutations are needed to keep all six subprocess slots occupied.
  const waiting = Array.from({ length: 6 }, () => executeGit(root, ['hash-object', '--stdin'], { signal: active.signal }).catch(error => error));
  await new Promise(resolve => setTimeout(resolve, 50));
  const pending = new AbortController(); const pendingReason = new Error('Stop queued Git');
  const queued = executeGit(root, ['rev-parse', 'HEAD'], { signal: pending.signal });
  pending.abort(pendingReason);
  await assert.rejects(queued, error => error === pendingReason);
  active.abort(activeReason);
  const errors = await Promise.all(waiting);
  assert.ok(errors.every(error => error === activeReason));
  assert.match(await executeGit(root, ['rev-parse', 'HEAD']), /^[a-f0-9]{40}\s*$/);
});

test('a failed batch cancels abandoned Git work and releases unrelated audits', async () => {
  // Control the subprocess boundary so sibling commands can remain blocked until
  // cancelled. This checks resource cleanup without platform-dependent timings.
  const original = childProcess.execFile;
  const pending = new Set();
  const startedDiffs = [];
  const failingBase = '1'.padStart(40, '0');
  const stub = () => { throw new Error('Expected the promisified subprocess API.'); };
  stub[promisify.custom] = (_file, args, options) => new Promise((resolve, reject) => {
    if (!args.includes('diff')) return queueMicrotask(() => resolve({ stdout: args.includes('rev-parse') ? 'a'.repeat(40) : '', stderr: '' }));
    const base = args.at(-2);
    startedDiffs.push(base);
    if (base === failingBase) return queueMicrotask(() => reject(Object.assign(new Error('Fixture failure'), { stderr: 'Saved base is unavailable' })));
    const finish = action => { pending.delete(release); options.signal?.removeEventListener('abort', abort); action(); };
    const release = () => finish(() => resolve({ stdout: '', stderr: '' }));
    const abort = () => finish(() => reject(options.signal.reason));
    pending.add(release);
    options.signal?.addEventListener('abort', abort, { once: true });
  });
  childProcess.execFile = stub;
  syncBuiltinESMExports();
  try {
    const core = await import(`../src/core.mjs?failed-batch-${Date.now()}`);
    const now = new Date().toISOString();
    const tasks = Array.from({ length: 200 }, (_, index) => ({ version: 1, id: `audit-${index}`, goal: 'Check a saved base', base: (index + 1).toString(16).padStart(40, '0'), allow: ['src/**'], deny: [], agent: 'test', state: 'working', summary: '', next: '', createdAt: now, updatedAt: now }));
    await assert.rejects(core.checkTasks('fixture', tasks), /Git diff failed: Saved base is unavailable/);
    let timer;
    try {
      const head = await Promise.race([core.git('fixture', ['rev-parse', 'HEAD']), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('An unrelated audit is blocked by abandoned batch work.')), 1000); })]);
      assert.equal(head, 'a'.repeat(40));
    } finally { clearTimeout(timer); }
    assert.equal(pending.size, 0);
    assert.ok(startedDiffs.length < tasks.length, 'Cancelled queued diffs must not launch.');
  } finally {
    for (const release of [...pending]) release();
    childProcess.execFile = original;
    syncBuiltinESMExports();
  }
});
