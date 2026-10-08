# Public repo opportunities

Research date: October 7, 2026. This is a snapshot, not a claim that no competing tool exists. Recommendations are product judgments from current primary documentation and public repository descriptions, not measured market demand.

## What is already built in

Claude Code already supports repository instructions, skills, hooks, multiple surfaces, scheduled tasks, and MCP. Current documentation also describes direct AGENTS.md support, with version and file-precedence conditions. A project whose only feature is copying AGENTS.md to CLAUDE.md would need a more specific reason to exist. Sources: [Claude Code overview](https://code.claude.com/docs/en/overview), [memory and instruction precedence](https://code.claude.com/docs/en/memory).

OpenAI documents a reusable Codex harness, SDK, app-server, and non-interactive execution. A general wrapper around a coding agent faces substantial native overlap. A focused workflow that supplies repository-specific context and a review interface is a more promising starting point. Sources: [Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform), [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

Both ecosystems can connect to MCP tools. That makes a deterministic local utility usable from either agent without building another model service. Sources: [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp), [Claude MCP](https://code.claude.com/docs/en/mcp), [official MCP server guide](https://modelcontextprotocol.io/docs/develop/build-server).

## Shortlist

| Idea | Concrete developer benefit | Existing work and overlap | Build decision |
| --- | --- | --- | --- |
| Task scope and handoff CLI | Review whether a task changed only its allowed paths; preserve its goal and next step | Scope guards exist in broader harnesses; handoff projects already exist | First MVP: a small portable path audit with clear limitations, rather than a new harness |
| Local task dashboard | See scopes, changed files, blockers, and handoffs across configured repos | Native apps already have their own session interfaces | Second MVP: shared task format, explicit manual progress, local Git metadata |
| Read-only task MCP server | Let either coding agent inspect scopes and current handoffs directly | MCP itself and general filesystem tools already exist | Third MVP: narrow typed tools over explicit repository IDs |
| MCP contract regression kit | Detect tool-schema and response changes before shipping an MCP update | MCP Inspector already offers inspection and CLI testing | Later: consider contributing reusable saved contracts to Inspector instead of cloning it |
| Agent verification receipts | Tie test executions to code versions and detect stale outcomes | ProofRun and BeforeDone closely cover this; Receipts checks whether tests catch a bug | Do not build a basic clone; evaluate contribution or a focused integration |
| Agent instruction/config migration | Reduce repeated setup across tools | Rulesync, AGENT sync tools, and native imports already cover much of this | Prefer compatibility fixes or contributions to existing projects |

## Repositories worth studying or contributing to

- [Rulesync](https://github.com/dyoshikawa/rulesync): unified agent configuration and conversion. A well-bounded compatibility bug would be a useful contribution.
- [MCP Inspector](https://github.com/modelcontextprotocol/inspector): official server inspection tooling. Reusable contract fixtures could fit here after checking existing issues.
- [ProofRun](https://github.com/yebiguo/ProofRun): local checks bound to code state, including stale-result detection.
- [Receipts](https://github.com/syntaxixr/receipts): checks changed tests against code with and without the fix. This addresses test effectiveness, which a path audit cannot establish.
- [Cross-agent handoff](https://github.com/rwineman/cross-agent-handoff): a portable handoff protocol. Basic chat portability is already an established category.
- [MCP Doctor](https://github.com/stephenywilson/MCP-Doctor): MCP diagnostics and configuration help. A generic setup checker would face close overlap.
- [Agent Harness Starter](https://github.com/kim-dongho/agent-harness-starter): broader workflow hooks including scope guards. Agent Lanes instead supplies a standalone net-diff review tool and shared data format; it does not enforce edits.

## Why the first three fit together

Agent Lanes creates task records and a path audit. Agent Desk presents those records without reading private app session formats. Agent Lanes MCP gives agents the same report through a protocol client. Each is independently cloneable and runnable; the dashboard and MCP repo vendor the same small MIT report engine to avoid depending on an unpublished package.

This combination is a product hypothesis, not a claim of invention or proof of adoption. Useful next evidence would be a few developers using it on real tasks and identifying where the scope check or handoff saves review work. The MVP does not verify tests, infer session processes, enforce task completion, or make local task records tamper-proof.

## Next development milestones

1. Validate the three MVPs with real repositories on Windows, macOS, and Linux.
2. Improve the task format from user feedback; keep its producer and consumers compatible.
3. Add an optional committed task policy for CI, with a protected base-branch policy to prevent a patch from silently widening its own scope.
4. Evaluate integration with existing verification receipt tools instead of inventing another receipt format.
5. Pick a reproducible issue in an existing project above and contribute a focused pull request.

No third-party issues, comments, or pull requests were posted during research.
