import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkPullRequest, readPolicyAt, validatePolicy, prSummary } from '../src/pr.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lanes-pr-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim();
  git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid'); git('config', 'core.autocrlf', 'false');
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src/app.js'), 'baseline\n');
  const policy = { version: 1, lanes: { fix: { allow: ['src/**'], deny: ['src/private/**'] } } };
  await writeFile(path.join(root, '.agent-lanes-policy.json'), JSON.stringify(policy));
  git('add', '.'); git('commit', '-qm', 'Trusted base');
  const base = git('rev-parse', 'HEAD');
  const save = () => { git('add', '-A'); git('commit', '-qm', 'PR changes'); return git('rev-parse', 'HEAD'); };
  return { root, git, base, save, policy };
}

test('PR audit reads committed changes, ignores dirty checkout, and uses base policy', async t => {
  const { root, base, save } = await fixture(t);
  await writeFile(path.join(root, 'src/app.js'), 'change\n');
  const head = save();
  await writeFile(path.join(root, 'outside.txt'), 'not in PR\n');
  const report = await checkPullRequest(root, { lane: 'fix', base, head });
  assert.equal(report.ok, true);
  assert.deepEqual(report.changes.map(file => file.path), ['src/app.js']);
  assert.equal(report.policyCommit, base);
});

test('PR cannot widen policy or invent a lane for its own audit', async t => {
  const { root, base, save } = await fixture(t);
  await writeFile(path.join(root, '.agent-lanes-policy.json'), JSON.stringify({ version: 1, lanes: { fix: { allow: ['**'], deny: [] }, escape: { allow: ['**'], deny: [] } } }));
  await writeFile(path.join(root, 'outside.txt'), 'outside\n');
  const head = save();
  const report = await checkPullRequest(root, { lane: 'fix', base, head });
  assert.equal(report.ok, false);
  assert.equal(report.policyChanged, true);
  assert.equal(report.changes.find(file => file.path === 'outside.txt').verdict, 'outside');
  await assert.rejects(checkPullRequest(root, { lane: 'escape', base, head }), /trusted base policy/);
});

test('rename checks both paths; denied paths override allowed patterns', async t => {
  const { root, base, save } = await fixture(t);
  await rename(path.join(root, 'src/app.js'), path.join(root, 'outside.js'));
  await mkdir(path.join(root, 'src/private'));
  await writeFile(path.join(root, 'src/private/config'), 'fixture\n');
  const report = await checkPullRequest(root, { lane: 'fix', base, head: save() });
  assert.equal(report.ok, false);
  assert.equal(report.changes.find(file => file.path === 'src/app.js').status, 'D');
  assert.equal(report.changes.find(file => file.path === 'outside.js').verdict, 'outside');
  assert.equal(report.changes.find(file => file.path === 'src/private/config').verdict, 'denied');
});

test('uses PR merge base when target branch has unrelated newer changes', async t => {
  const { root, git, base, save } = await fixture(t);
  git('checkout', '-qb', 'pr');
  await writeFile(path.join(root, 'src/app.js'), 'PR\n');
  const head = save();
  git('checkout', '-q', '--detach', base);
  await writeFile(path.join(root, 'unrelated.txt'), 'target branch\n');
  const target = save();
  const report = await checkPullRequest(root, { lane: 'fix', base: target, head });
  assert.equal(report.mergeBase, base);
  assert.deepEqual(report.changes.map(file => file.path), ['src/app.js']);
});

test('rejects missing policies, bad refs, symlink policies and invalid policy shapes', async t => {
  const { root, git, base, save } = await fixture(t);
  await assert.rejects(checkPullRequest(root, { lane: 'fix', base: 'HEAD', head: base }), /full lowercase/);
  git('rm', '.agent-lanes-policy.json'); git('commit', '-qm', 'Remove');
  await assert.rejects(readPolicyAt(root, git('rev-parse', 'HEAD')), /regular/);
  const blob = git('hash-object', '-w', '--stdin');
  // A Git tree symlink can be tested without OS symlink privileges.
  git('update-index', '--add', '--cacheinfo', `120000,${blob},.agent-lanes-policy.json`);
  git('commit', '-qm', 'Symlink policy');
  await assert.rejects(readPolicyAt(root, git('rev-parse', 'HEAD')), /regular/);
  for (const invalid of [{}, { version: 1, lanes: {} }, { version: 1, lanes: { fix: { allow: ['../**'], deny: [] } } }]) assert.throws(() => validatePolicy(invalid));
});

test('submodules fail closed even when paths are allowed', async t => {
  const { root, git, base } = await fixture(t);
  git('update-index', '--add', '--cacheinfo', `160000,${base},src/module`);
  git('commit', '-qm', 'Gitlink');
  const report = await checkPullRequest(root, { lane: 'fix', base, head: git('rev-parse', 'HEAD') });
  assert.deepEqual(report.submodules, ['src/module']);
  assert.equal(report.ok, false);
});

test('CLI scope failures exit 1, invalid input exits 2, Markdown escapes paths', async t => {
  const { root, base, save } = await fixture(t);
  await writeFile(path.join(root, 'outside.txt'), 'outside\n');
  const head = save();
  const cli = fileURLToPath(new URL('../bin/agent-lanes.mjs', import.meta.url));
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', windowsHide: true });
  const result = run(['check-pr', 'fix', '--repo', root, '--base', base, '--head', head, '--json']);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, false);
  assert.equal(run(['check-pr', 'fix', '--repo', root, '--base', 'HEAD', '--head', head]).status, 2);
  const report = JSON.parse(result.stdout); report.changes[0].path = 'a`\n## injected';
  assert.match(prSummary(report), /a\\u0060\\n## injected/);
});
