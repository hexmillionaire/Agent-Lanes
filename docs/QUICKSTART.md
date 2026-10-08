# One task across all three tools

Requires Node 24.8+ and Git. No model API key is needed. Use a trusted Git repository with at least one commit, and a separate worktree for concurrent tasks.

## Install

Install the three published npm packages:

```sh
npm install -g @hexmillionaire/agent-lanes@0.3.0 @hexmillionaire/agent-desk@0.3.0 @hexmillionaire/agent-lanes-mcp@0.3.0
```

Package installation does not configure Claude or Codex automatically. If you prefer GitHub release archives, use:

```sh
npm install -g https://github.com/hexmillionaire/Agent-Lanes/releases/download/v0.3.0/hexmillionaire-agent-lanes-0.3.0.tgz
npm install -g https://github.com/hexmillionaire/agent-desk/releases/download/v0.3.0/hexmillionaire-agent-desk-0.3.0.tgz
npm install -g https://github.com/hexmillionaire/agent-lanes-mcp/releases/download/v0.3.0/hexmillionaire-agent-lanes-mcp-0.3.0.tgz
```

## Create a task

Add `.agent-lanes/` to your project's `.gitignore` so private notes stay local. This does not modify a committed scope policy.

```sh
agent-lanes start login --repo /path/to/project --goal "Fix login timeout" --allow "src/**" --allow "test/**" --agent codex
agent-desk --repo /path/to/project
```

Open `http://127.0.0.1:4317`. You can also create the task with **New task** in Desk. Open a card to change its state, agent label, summary, and next step. Allowed paths and the captured base remain fixed. The board refreshes every 10 seconds while visible; uncheck Auto-refresh to pause. Unsaved notes survive refresh. A stale save returns a conflict instead of overwriting a newer note.

## Connect an MCP client

```sh
agent-lanes-mcp --repo /path/to/project --doctor
agent-lanes-mcp --repo /path/to/project --print-config claude
agent-lanes-mcp --repo /path/to/project --print-config codex
```

Merge the printed snippet into existing MCP configuration: Claude JSON for Claude Code/Desktop, Codex TOML for Codex. It uses absolute paths to the installed Node executable and server. It never writes client configuration. Regenerate it if the package or Node installation moves.

Follow [Claude's setup guide](https://code.claude.com/docs/en/mcp) or [Codex's setup guide](https://learn.chatgpt.com/docs/extend/mcp) for the client-specific location and approval. Doctor verifies the server transport and task data; it does not prove a client app enabled the configuration.

Ask your connected client: “List the Agent Lanes repositories and tasks, check the scope of login, and get its handoff.” The four MCP tools stay read-only. Returned data may go to the client's model provider.

## Work, check, hand off

```sh
agent-lanes note login --repo /path/to/project --state working --next "Add a regression test"
agent-lanes check login --repo /path/to/project
agent-lanes handoff login --repo /path/to/project
```

An edit inside `src/` appears as allowed; a new file outside the allowed paths appears as outside scope. View the same audit in Desk or MCP. **Copy handoff** exports a fresh report. Run project tests separately, then record a review state and next action. Agent labels and progress are authored metadata, not live session observations.

For PRs, add a committed lane policy and the [GitHub scope check](PR-CHECK.md). Local task notes are not CI policy.

## Try the sample first

Clone Agent Lanes and run `npm run demo` to create its `.demo/` Git sandbox. Point Desk and MCP at it, or use Desk's `--demo` for fictional tasks. See [the demo walkthrough](DEMO.md).
