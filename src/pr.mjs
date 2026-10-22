import { git, classify, parseRawDiff, validateId, validatePattern } from './core.mjs';

export const POLICY_PATH = '.agent-lanes-policy.json';
const SHA = /^[a-f0-9]{40}([a-f0-9]{24})?$/;
const record = value => value && typeof value === 'object' && !Array.isArray(value);

export function validatePolicy(policy) {
  if (!record(policy) || policy.version !== 1 || !record(policy.lanes)) throw new Error('Policy needs version 1 and a lanes object.');
  const entries = Object.entries(policy.lanes);
  if (!entries.length || entries.length > 200) throw new Error('Policy needs 1-200 lanes.');
  for (const [id, scope] of entries) {
    validateId(id);
    if (!record(scope) || !Array.isArray(scope.allow) || !scope.allow.length || scope.allow.length > 100 || !Array.isArray(scope.deny) || scope.deny.length > 100) throw new Error(`Lane ${id} needs 1-100 allow patterns and up to 100 deny patterns.`);
    scope.allow.forEach(validatePattern);
    scope.deny.forEach(validatePattern);
  }
  return policy;
}

async function commit(root, value, label) {
  if (typeof value !== 'string' || !SHA.test(value)) throw new Error(`${label} must be a full lowercase Git commit SHA.`);
  const resolved = (await git(root, ['rev-parse', '--verify', '--end-of-options', `${value}^{commit}`])).trim();
  if (resolved !== value) throw new Error(`${label} must identify a commit, not a tag.`);
  return value;
}

export async function readPolicyAt(root, base) {
  await commit(root, base, 'Base');
  const entry = (await git(root, ['ls-tree', '-z', base, '--', POLICY_PATH])).split('\0')[0];
  const match = /^(100644|100755) blob ([a-f0-9]+)\t/.exec(entry);
  if (!match) throw new Error(`Trusted base commit needs a regular ${POLICY_PATH} file. Commit the policy before using the PR check.`);
  const size = Number((await git(root, ['cat-file', '-s', match[2]])).trim());
  if (!Number.isFinite(size) || size > 65536) throw new Error('Policy must be under 64 KiB.');
  return validatePolicy(JSON.parse(await git(root, ['cat-file', 'blob', match[2]])));
}

export async function checkPullRequest(root, { lane, base, head }) {
  validateId(lane);
  await commit(root, head, 'Head');
  const policy = await readPolicyAt(root, base);
  if (!Object.hasOwn(policy.lanes, lane)) throw new Error(`Lane ${lane} is not in the trusted base policy.`);
  const mergeBases = (await git(root, ['merge-base', '--all', base, head])).trim().split('\n');
  if (mergeBases.length !== 1 || !SHA.test(mergeBases[0])) throw new Error('PR needs one unambiguous merge base; fetch full history.');
  const mergeBase = mergeBases[0];
  const [diff, baseTree, headTree] = await Promise.all([
    git(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--ignore-submodules=none', '--raw', '--no-abbrev', '-z', mergeBase, head, '--']),
    git(root, ['ls-tree', '-r', '-z', base]),
    git(root, ['ls-tree', '-r', '-z', head]),
  ]);
  const raw = parseRawDiff(diff);
  const changes = raw.map(file => ({ status: file.status, path: file.path, ...classify(file.path, policy.lanes[lane]) })).sort((a, b) => a.path.localeCompare(b.path));
  const treeSubmodules = [baseTree, headTree].flatMap(tree => tree.split('\0').filter(line => line.startsWith('160000 ')).map(line => line.slice(line.indexOf('\t') + 1)));
  const submodules = [...new Set([...treeSubmodules, ...raw.filter(file => file.submodule).map(file => file.path)])].sort();
  // A symbolic link is a path audit's blind spot: its target can be anywhere.
  const symlinks = raw.filter(file => file.symlink).map(file => file.path).sort();
  const counts = Object.fromEntries(['allowed', 'outside', 'denied'].map(verdict => [verdict, changes.filter(file => file.verdict === verdict).length]));
  return { version: 1, lane, base, head, mergeBase, policyCommit: base, policyChanged: changes.some(file => file.path === POLICY_PATH), changes, counts, submodules, symlinks, ok: !changes.some(file => file.verdict !== 'allowed') && !submodules.length && !symlinks.length };
}

export function prSummary(report) {
  const code = value => '`' + JSON.stringify(value).replaceAll('`', '\\u0060') + '`';
  return [
    `## Agent Lanes: ${report.ok ? 'within scope' : 'review required'}`, '',
    `Lane: ${code(report.lane)}`, `Policy from base commit: ${code(report.policyCommit)}`, `PR head: ${code(report.head)}`, '',
    `${report.counts.allowed} allowed; ${report.counts.outside} outside; ${report.counts.denied} denied.`, '',
    ...report.changes.map(file => `- **${file.verdict.toUpperCase()}** ${file.status} ${code(file.path)}`),
    ...(report.policyChanged ? ['', 'Policy changed in this PR. The check used the base policy; review policy changes for future PRs.'] : []),
    ...(report.submodules.length ? ['', 'Submodules require a separate audit; the check fails closed.'] : []),
    ...(report.symlinks?.length ? ['', `Symbolic links changed (${report.symlinks.map(code).join(', ')}); their targets are not path-audited, so the check fails closed.`] : []), '',
    'This checks net committed paths from the merge base to the PR head. It does not run tests or verify correctness.', '',
  ].join('\n');
}
