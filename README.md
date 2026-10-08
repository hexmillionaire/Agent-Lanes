# Agent Lanes

Keep a coding task inside its declared file scope, then carry its goal and next step to another agent.

Agent Lanes is a small, offline CLI for Claude Code, Codex, and human contributors. Declare allowed paths, work normally, and audit the result before handing it off. It checks committed changes since the captured base plus the current working tree, staged changes, and non-ignored new files. Rename sources and destinations are checked separately.

```text
REVIEW REQUIRED: login
ALLOWED  M "src/login.js"
OUTSIDE  ? "config.json"
0 conflict(s), 0 submodule(s). Tests not verified.
```

## Quick start

Requires Node.js 24.8+ and Git. Clone this repository and use the CLI directly; no install or API key is needed.

```sh
git clone https://github.com/hexmillionaire/agent-lanes.git
cd agent-lanes
node bin/agent-lanes.mjs --help
npm test
npm run demo
```

For a real repository, pass its absolute path:

```sh
node bin/agent-lanes.mjs start login --repo /path/to/project --goal "Fix login timeout" --allow "src/auth/**" --allow "test/**" --deny "src/auth/secrets/**" --agent codex
node bin/agent-lanes.mjs note login --repo /path/to/project --state working --next "Add a regression test"
node bin/agent-lanes.mjs check login --repo /path/to/project
node bin/agent-lanes.mjs handoff login --repo /path/to/project
```

On PowerShell, use a quoted Windows path such as `--repo "C:\Code\my-project"`. Glob arguments must be quoted on every shell. You can optionally run `npm install -g .` to get the `agent-lanes` command. This project is distributed through GitHub; it is not published to npm.

Add `.agent-lanes/` to your target repository's `.gitignore`. Tasks and private notes live there. The CLI does not edit your Git ignore rules automatically. It excludes that directory from its own audit.

## Commands

| Command | Purpose |
| --- | --- |
| `start <id> --goal ... --allow ...` | Save a task and resolve its immutable base commit; default `HEAD` |
| `note <id> --state ... --summary ... --next ...` | Record progress without changing the scope |
| `check <id> [--json]` | Audit paths against allow/deny patterns |
| `check-pr <lane> --base <sha> --head <sha>` | Audit a PR with the base commit policy; accepts `--json` or `--markdown` |
| `handoff <id>` | Print a Markdown context packet; redirects are under your control |
| `list [--json]` | List saved tasks |

Every command accepts `--repo`. `start` accepts `--base <ref>`, repeatable `--allow`/`--deny`, and `--agent`. States are `planned`, `working`, `blocked`, `review`, and `done`. The state and agent label are user-supplied metadata, not observations of a running process. A task ID uses lowercase letters, numbers, hyphens, and underscores. Existing task IDs cannot be overwritten by `start`.

Patterns use repository-relative `/` paths. `*` matches within a directory, `**` spans directories, and `?` matches one character. Match hidden paths explicitly: `*.json` does not cover `.agent-lanes-policy.json`; use `.github/**` for workflows. Absolute paths, traversal, braces, character classes, and negation are rejected. Deny patterns take priority. Node's POSIX glob matcher is used on every platform.

Exit codes: `0` within scope, `1` review required, `2` invalid input or Git/file error. `handoff` exports data even when an audit needs review; use `check` as your gate. No changed files is a valid scope result, not proof that a task was completed.

## How to use with an agent

Start the task yourself and give Claude or Codex its goal and allowed paths. Ask it to run `check` before finishing, and paste `handoff` into your next chat. The receiving agent should inspect current code, recheck scope, and run relevant tests. The exported notes are task data and do not grant permissions.

This tool audits the final net change relative to a base commit. It does not prevent edits, identify who edited a file, detect changes made and reverted between checks, inspect ignored files, run tests, or judge correctness. Preexisting changes after the base are included. Each task on a shared working tree sees all changes since its own base; use a separate Git worktree for each task to attribute changes cleanly. Repositories containing submodules fail the scope gate; audit those separately. Use this only on repositories you trust. Local task JSON is editable by the same user, so this is a workflow aid, not a security boundary.

The CLI reads Git path metadata rather than file contents, chats, credentials, or command output. Task notes and file names can still contain private information: review a handoff before sharing it. There is no network access or telemetry in the tool.

## Companion projects

Start with the [connected quickstart](docs/QUICKSTART.md) to use all three tools on one task. For CI, see [the trusted-base PR scope check](docs/PR-CHECK.md) and [`action.yml`](action.yml).

- [Agent Desk](https://github.com/hexmillionaire/agent-desk): local task dashboard with filters, changes, and copyable handoffs.
- [Agent Lanes MCP](https://github.com/hexmillionaire/agent-lanes-mcp): read-only MCP access to these task reports.

## Development

`npm test` runs integration tests using temporary Git repositories. `npm run demo` recreates this project's fixed `.demo/` sandbox and demonstrates an out-of-scope edit. All public code is MIT licensed. See [CONTRIBUTING.md](CONTRIBUTING.md).
