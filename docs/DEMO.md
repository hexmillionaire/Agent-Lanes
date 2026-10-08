# Two-minute demo

1. Clone Agent Lanes and run `npm run demo`. It creates only the fixed `.demo/` sandbox, then reports one allowed edit and one outside-scope file.
2. Launch Desk with `agent-desk --repo /absolute/path/to/Agent-Lanes/.demo`. The greeting card shows both paths. Save a next step and an agent label; labels are notes, not connected sessions.
3. Run `agent-lanes-mcp --repo /absolute/path/to/Agent-Lanes/.demo --doctor`. Generate a client snippet with `--print-config claude` or `--print-config codex`.
4. In a connected MCP client, call `check_scope` for repository `repo-1`, task `greeting`, then `get_handoff`. Compare the paths with the CLI and Desk.
5. Create another task in Desk with **New task**, a goal, and allowed paths. Save notes and copy its handoff.

The scripts and dashboard make no model calls. An AI client may transmit returned task notes and paths to its provider. Use sample notes when sharing a recording.
