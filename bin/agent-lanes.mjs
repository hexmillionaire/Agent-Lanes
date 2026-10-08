#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { repoRoot, startTask, updateTask, readTask, listTasks, checkTask, handoff, VERSION } from '../src/core.mjs';

const usage = `Agent Lanes ${VERSION} — portable task scope checks\n\nUsage:\n  agent-lanes start <id> --goal "Fix login" --allow "src/**" --allow "test/**"\n  agent-lanes note <id> --state working --agent codex --next "Add regression test"\n  agent-lanes check <id> [--json]\n  agent-lanes handoff <id>\n  agent-lanes list [--json]\n\nOptions: --repo <path>, --base <ref> (start only), --deny <glob> (repeatable)\nExit codes: 0 success; 1 scope violation/conflict/submodule; 2 invalid input/error.\nScope audits read Git metadata; they do not run tests or block edits.\n`;

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: {
    repo: { type: 'string' }, goal: { type: 'string' }, base: { type: 'string' }, agent: { type: 'string' },
    allow: { type: 'string', multiple: true }, deny: { type: 'string', multiple: true }, state: { type: 'string' },
    summary: { type: 'string' }, next: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean' }, version: { type: 'boolean' },
  } });
  if (values.version) console.log(VERSION);
  else if (values.help || !positionals.length) console.log(usage);
  else {
    const [command, id] = positionals;
    if (positionals.length > (command === 'list' ? 1 : 2)) throw new Error('Too many positional arguments.');
    if (!['start', 'note', 'check', 'handoff', 'list'].includes(command)) throw new Error(`Unknown command: ${command}`);
    const accepted = { start: ['repo', 'goal', 'base', 'agent', 'allow', 'deny', 'json'], note: ['repo', 'state', 'agent', 'summary', 'next', 'json'], check: ['repo', 'json'], handoff: ['repo'], list: ['repo', 'json'] }[command];
    for (const key of Object.keys(values)) if (!accepted.includes(key)) throw new Error(`--${key} is not valid for ${command}.`);
    const root = await repoRoot(values.repo);
    if (command === 'start') {
      const task = await startTask(root, { id, goal: values.goal, allow: values.allow, deny: values.deny, agent: values.agent, base: values.base });
      console.log(values.json ? JSON.stringify(task, null, 2) : `Started ${task.id} at ${task.base.slice(0, 12)}. Add .agent-lanes/ to your .gitignore.`);
    } else if (command === 'note') {
      const updates = Object.fromEntries(['state', 'agent', 'summary', 'next'].filter(key => key in values).map(key => [key, values[key]]));
      if (!Object.keys(updates).length) throw new Error('Provide at least one note field.');
      const task = await updateTask(root, id, updates);
      console.log(values.json ? JSON.stringify(task, null, 2) : `Updated ${task.id}: ${task.state}.`);
    } else if (command === 'list') {
      const tasks = await listTasks(root);
      console.log(values.json ? JSON.stringify(tasks, null, 2) : tasks.map(task => `${task.id}\t${task.state}\t${task.goal.replaceAll('\n', ' ')}`).join('\n') || 'No tasks. Use agent-lanes start.');
    } else {
      const report = await checkTask(root, await readTask(root, id));
      if (command === 'handoff') console.log(handoff(report));
      else {
        console.log(values.json ? JSON.stringify(report, null, 2) : `${report.ok ? 'WITHIN SCOPE' : 'REVIEW REQUIRED'}: ${id}\n${report.changes.map(file => `${file.verdict.toUpperCase().padEnd(8)} ${file.status} ${JSON.stringify(file.path)}`).join('\n')}\n${report.conflicts.length} conflict(s), ${report.submodules.length} submodule(s). Tests not verified.`);
        if (!report.ok) process.exitCode = 1;
      }
    }
  }
} catch (error) {
  console.error(`Agent Lanes: ${error.message}`);
  process.exitCode = 2;
}
