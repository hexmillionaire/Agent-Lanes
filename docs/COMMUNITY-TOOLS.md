# Developer workflow investigation — October 11, 2026

The useful opportunities are portable workflow checks that agents and humans can inspect. This review examined our own source, upstream documentation, open issue reports and existing public tools. It is not a survey of the AI community, and an issue report does not prove a defect affects every installed client.

## Findings delivered in 0.4.0

| Problem | Evidence | Result |
| --- | --- | --- |
| Separate CLI/server writers can overwrite notes or exceed the task cap | Our pre-0.4 read/check/write operations were separate; real child-process regression tests exercise both races | One cooperative writer lock, revision checks inside it, bounded waits and explicit crash recovery |
| A stale dashboard draft needs a useful next step | Our API detected some conflicts but required reopening the task | Original/current/draft field comparison, independent-edit merge and explicit choices followed by an explicit save |
| Task scopes are repetitive and hard to inspect | Existing creation forms repeat allow/deny paths; task details omitted saved boundaries | Strict data-only templates; literal allow/deny rules and the complete base commit in details |
| MCP discovery advertises draft-07 | Captured real `tools/list` output and open SDK [issue 2721](https://github.com/modelcontextprotocol/typescript-sdk/issues/2721) / [2084](https://github.com/modelcontextprotocol/typescript-sdk/issues/2084) | Generate actual 2020-12 schemas from the same Zod definitions, retain SDK tool validation and compile/validate actual outputs with a strict 2020-12 validator |

The core's writer coordination follows the same exclusive-owner/atomic-publication principles described by [Git's lockfile API](https://git-scm.com/docs/api-lockfile), adapted to portable JavaScript filesystem operations. It does not automatically steal crashed locks or claim isolation from manual file changes.

## Two focused new utilities

[Repo Fixtures](https://github.com/hexmillionaire/repo-fixtures) creates seven fictional, real Git scenarios in a new directory. A JSON manifest separates expected facts from observed status, conflicts and gitlinks. It helps developers share a minimal case for a Git-aware CLI, dashboard or agent tool without exposing their working repository. [git-scenarios](https://git-scenarios.griffen.codes/) already offers a much richer fixture DSL, CLI and adapters; use it for custom histories. Our utility deliberately keeps a small dependency-free bundle format and does not launch tools or remove directories.

[MCP Surface](https://github.com/hexmillionaire/mcp-surface) checks saved discovery artifacts offline. Inputs need to keep accepting old inputs; outputs need to stay inside the old expected output contract. Conservative recursive comparison reports unsupported reasoning as unknown. It never starts a server or invokes a tool, and cannot verify behavior or a read-only annotation. [GitHub's MCP testing guide](https://github.com/github/github-mcp-server/blob/main/docs/testing.md) separates snapshots from behavioral and annotation tests for this reason.

Existing [mcp-contracts](https://github.com/mcp-contracts/mcp-contracts), [Cisco mcptoolkit-contract](https://github.com/cisco-open/mcptoolkit-contract), [mcp-pact](https://github.com/hhagenbuch/mcp-pact), and [official MCP Inspector](https://github.com/modelcontextprotocol/inspector) cover broader snapshots, live testing, consumer interactions and protocol inspection. MCP Surface complements those workflows with bounded file-based analysis and an explicit supported schema fragment. It is not a general JSON Schema theorem prover or client certification.

## Choices and next contributions

Keep JavaScript ESM on Node 24 LTS. Our previous [0.3 investigation](INVESTIGATION.md) measured substantial gains from sharing Git reads; a language rewrite has no demonstrated benefit for these small I/O-oriented tools. Keep zero runtime dependencies for core, Desk and the new offline utilities. MCP retains pinned official SDK/Zod runtime dependencies. The strict Ajv2020 test oracle and Inspector are development tools; the SDK also includes Ajv transitively at runtime.

Codex already supports durable project context and verification workflows, described in its [long-running task guide](https://developers.openai.com/blog/run-long-horizon-tasks-with-codex). Claude Code also has [native worktrees](https://code.claude.com/docs/en/worktrees). Projects such as [Claude Squad](https://github.com/smtg-ai/claude-squad) and [Forklane](https://github.com/pointvis/forklane) cover orchestration and broader sessions. We chose authored metadata and inspectable interfaces rather than another agent launcher.

Generic verification receipts also exist: [agent-done-or-not](https://github.com/mohamedzhioua/agent-done-or-not) and [Backcheck](https://github.com/VectorInstitute/backcheck). Integrations with maintained tools are a better starting point than claiming a new generic receipt format. Useful later contributions include exact dirty-content freshness checks, additional minimized Git scenarios, real client compatibility reports, schema counterexamples and accessibility improvements. Do not treat a successful command, schema comparison or path audit as proof that tests are adequate or an agent completed a task.

## How to contribute evidence

Open a focused issue or pull request in the relevant repository. Include the tool/Node/Git/client versions, operating system, a fictional reproduction and expected versus observed output. Contribution guides and issue forms provide starting points. Clear limitations, versioned releases and reproducible checks help other developers decide whether a tool is useful; these are more valuable than unsupported popularity claims.
