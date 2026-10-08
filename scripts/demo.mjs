import { mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { repoRoot, startTask, updateTask, checkTask, handoff } from '../src/core.mjs';

const directory = fileURLToPath(new URL('../.demo/', import.meta.url));
// This script recreates only its own fixed .demo directory.
await rm(directory, { recursive: true, force: true });
await mkdir(`${directory}/src`, { recursive: true });
const git = (...args) => execFileSync('git', ['-C', directory, ...args], { windowsHide: true });
git('init', '-q');
git('config', 'user.name', 'Agent Lanes Demo');
git('config', 'user.email', 'demo@example.invalid');
await writeFile(`${directory}/.gitignore`, '.agent-lanes/\n');
await writeFile(`${directory}/src/app.js`, 'export const greeting = "Hello";\n');
git('add', '.');
git('commit', '-qm', 'Demo baseline');
const root = await repoRoot(directory);
await startTask(root, { id: 'greeting', goal: 'Improve the greeting without changing configuration.', allow: ['src/**'], agent: 'codex' });
const task = await updateTask(root, 'greeting', { state: 'review', summary: 'Updated the greeting. Found an unrelated configuration edit.', next: 'Review the out-of-scope file before proceeding.' });
await writeFile(`${directory}/src/app.js`, 'export const greeting = "Welcome";\n');
await writeFile(`${directory}/config.json`, '{"unrelated":true}\n');
console.log(handoff(await checkTask(root, task)));
console.log(`Demo repository: ${root}`);
