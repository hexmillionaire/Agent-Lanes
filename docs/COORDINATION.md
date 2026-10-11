# Coordinated task writes and reusable scopes

Agent Lanes 0.4.0 keeps the version 1 task format. All participating writers must use 0.4.0: upgrade Agent Desk too. Older writers and manual JSON edits do not participate in the lock protocol. The read-only MCP server can inspect these files without taking a writer lock.

## Revision-checked notes

`updateTask(root, id, updates, {expectedUpdatedAt, signal} = {})` rereads the task under a repository-wide writer lock, compares the supplied revision, and publishes complete JSON atomically. Only `state`, `agent`, `summary` and `next` are mutable. A stale revision throws `TaskConflictError` with `code: 'TASK_CONFLICT'` and `currentTask`. This is a review prompt, not a force-save instruction. Unknown task extensions can remain in core records; consumer clients project their supported public fields.

```sh
agent-lanes list --repo /path/to/project --json
agent-lanes note login --repo /path/to/project --summary "Reviewed the timeout path" --if-updated-at "2026-10-11T12:00:00.000Z"
```

Use the actual `updatedAt` value from a fresh read. Without a supplied revision, independent field updates merge into the latest record under the same lock. Two writers changing the same field still need an explicit revision to detect their semantic conflict. Agent Desk always sends the revision and lets you compare the original, current and draft values before saving again.

`startTask(root, options, {signal} = {})` checks the 200-task capacity inside the same lock. Timestamps increase monotonically for each task. Creation and replacement still require hard-link/atomic-rename support on the local filesystem. These are coordinated metadata writes, not an isolation boundary against same-user processes or a crash-durable database.

## Crash recovery

The writer publishes complete owner metadata at `.agent-lanes/.write.lock`, waits up to five seconds for a held lock, and releases only its own token. It never steals a lock because it looks old or its PID seems absent. PID reuse and racing reclaimers make those shortcuts unsafe.

```sh
agent-lanes lock-status --repo /path/to/project --json
```

If a writer crashed, **stop every Agent Lanes and Agent Desk writer for that repository first**, inspect the lock, and remove only `.agent-lanes/.write.lock`. Then restart the updated tools. Do not remove a lock while a writer is live. Hidden orphan `.tmp` files are ignored by task discovery; they are not saved tasks. Keep `.agent-lanes/` ignored by Git. A `TASK_LOCKED` error is actionable; it does not imply that notes were lost.

## Scope templates

Commit a `.agent-lanes-templates.json` file in the project root:

```json
{
  "version": 1,
  "templates": [
    {
      "id": "docs",
      "name": "Documentation change",
      "description": "Review public examples and prose",
      "allow": ["docs/**", "*.md"],
      "deny": ["SECURITY.md"]
    }
  ]
}
```

```sh
agent-lanes templates --repo /path/to/project --json
agent-lanes start clarify-docs --repo /path/to/project --goal "Clarify the quickstart" --template docs
```

`--template` cannot be combined with `--allow` or `--deny`. The task copies the scope at creation; later template edits do not alter saved scopes or their captured base commit. The task ID and goal remain authored for the specific task. Agent Desk previews a selected template and applies its paths only after an explicit click.

`readTemplates(root, {signal} = {})` returns `{version:1, templates:[{id,name,description,allow,deny}]}`. A missing file returns an empty list. The reader requires regular JSON, valid UTF-8, version 1, at most 64 KiB and 50 templates, unique valid IDs, 1–100 allow patterns and up to 100 deny patterns. Unknown properties, command fields, traversal patterns and symlinks are rejected. Optional names default to IDs; descriptions default to empty strings. Supplied names/descriptions are non-empty bounded single-line text. Templates are data only and confer no permissions.

See [the dated engineering investigation](COMMUNITY-TOOLS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md) for evidence and reproducible checks.
