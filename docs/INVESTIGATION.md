# October 2026 engineering investigation

Reviewed 8 October 2026. The resulting v0.3.0 work covers Agent Lanes, Agent Desk, and Agent Lanes MCP. Existing version-1 task files, CLI commands, and four read-only MCP tools remain supported.

## Runtime and language decision

Keep modern JavaScript ES modules for these projects and recommend the latest Node 24 LTS patch. Node's official release page identifies 24.21.0 as the current LTS patch and Node 26 as Current; it recommends LTS for production. Node 24.8 remains the minimum because the engine uses stable native glob matching. CI covers that minimum on Ubuntu and current Node 24 on Ubuntu, Windows, and macOS. Local verification also uses a checksum-verified official Node 24.21.0 binary without replacing the machine's installed runtime. Sources: [Node releases](https://nodejs.org/en/about/previous-releases), [native path matching](https://nodejs.org/api/path.html#pathmatchesglobpath-pattern).

The language choice is an engineering assessment, not a benchmark against implementations in other languages:

| Option | Assessment for these tools |
| --- | --- |
| JavaScript / Node | Shares a language with Desk's browser code, has the filesystem/process primitives needed here, and lets Lanes and Desk ship without runtime packages or a build step. Retain it. |
| TypeScript | Useful future static checking as public APIs expand. It checks JavaScript types before execution; changing file extensions alone does not remove repeated Git subprocess work. Prefer incremental type definitions/checking when it addresses demonstrated maintenance problems. |
| Go or Rust | Worth reconsidering if profiling identifies CPU-heavy work or a requirement for standalone binaries. A rewrite introduces new packaging, platform, and compatibility work; the current multi-task bottleneck was repeated Git commands. |
| Python | Adds another runtime alongside browser JavaScript without addressing the repeated Git work observed here. No demonstrated benefit warrants migration now. |

TypeScript's role is described in its [official handbook](https://www.typescriptlang.org/docs/handbook/intro.html). MCP has [official SDKs in several languages](https://modelcontextprotocol.io/docs/sdk); their availability does not establish which language is fastest for this application.

## Measured performance

Real Git fixture: Windows, 200 tracked files, one modified file, tasks sharing one captured base, three samples per configuration. Timings measure `checkAll`, including task loading, rather than total CLI startup. [Raw results](benchmarks/v0.3.0.json) preserve every sample and declared version.

| Tasks | Published v0.2.0 median, Node 24.15 | Refined median, Node 24.15 |
| --- | ---: | ---: |
| 1 | 99 ms | 91 ms |
| 20 | 1,549 ms | 77 ms |
| 100 | 8,221 ms | 95 ms |

An independent repeat on Node 24.21.0 measured the 20-task median at **1,512 ms → 82 ms**, about **18.4× faster**. These are synthetic workload observations, not promises for every repository or machine. Distinct bases need distinct diffs; the benefit is largest when tasks share a base.

The old collector ran six Git commands per task. The new collector runs four shared reads plus one diff per distinct base in each invocation: 120 commands become five for 20 same-base tasks. It keeps no persistent Git-result cache. Later checks read current Git state again. Six execution slots bound subprocess pressure, and cancellation removes abandoned queued work.

MCP help startup separately measured a median **402.6 ms → 60.3 ms** over seven samples on Windows/Node 24.15 after moving SDK imports into the protocol and doctor paths. This result concerns help/config setup; normal MCP execution still loads the official SDK.

Reproduce an audit with:

```sh
npm run benchmark -- --tasks 20 --files 200 --runs 3
npm run benchmark -- --tasks 20 --files 200 --runs 3 --bases 20
```

Use `--core /absolute/path/to/historical-core.mjs` with the same fixture arguments for a baseline. Do not time unrelated tests concurrently or compare different fixture sizes.

## Reliability and usability findings

| Finding | Resulting behavior |
| --- | --- |
| Every task repeated the same Git reads | Invocation-scoped batch reads and per-base diffs preserve individual scopes and order. |
| Failed batches left unused commands queued | A failing batch cancels sibling work before returning its original failure. |
| Updating JSON in place exposed partial files to readers | Completed temporary JSON is published atomically; transient Windows replacement locks receive bounded retries lasting about 2.4 seconds. Persistent replacement failures preserve the original file; temporary cleanup is retried and cleanup failures are reported. |
| Valid fields could encode to more than the readable 64 KiB limit | Reject encoded oversized JSON before publication. |
| Removing a captured submodule could yield a pass | Raw Git file modes retain the removed submodule warning; ignore-submodule settings cannot suppress it. |
| Multiple dashboard tabs duplicated overview work | Overlapping reads share an active audit; a later request audits again, and writes invalidate in-flight snapshots. Up to two repositories collect concurrently. |
| A delayed save/create/export affected a newer dialog or draft | UI operations track their originating task/dialog and draft revision. Later edits remain available. |
| Refresh errors vanished when filters changed | Failure state stays visible until a successful refresh. Keyboard focus survives unchanged boards; dirty note drafts receive fresh scope details. |
| MCP errors returned raw filesystem/JSON fragments | Fixed actionable errors and an explicit public task-field list reduce accidental disclosure. |
| Doctor validated task JSON but missed unavailable Git bases | Doctor pages tasks, checks every distinct saved base, and exercises a real scope tool over stdio. |
| Large MCP lists exceeded transport budgets | Optional pagination preserves default-all behavior; structured results expose continuation metadata and oversized results report an explicit paging error. |
| Closing MCP stdin left active requests running | Stdin EOF closes the SDK server and aborts outstanding handlers and Git work. A real stdio regression verifies exit without a late tool response. |

## Dependencies and ongoing checks

The registry review found MCP SDK **1.32.1** and Zod **4.6.5** already at their stable latest versions. Inspector advances from **2.10.0 to 2.10.1** as a development-only package; it stays out of production installation. The updated lockfile audit reported zero known vulnerabilities. That is a point-in-time advisory check, not a guarantee of absence of vulnerabilities. Primary package records: [SDK](https://www.npmjs.com/package/@modelcontextprotocol/sdk), [Zod](https://www.npmjs.com/package/zod), [Inspector](https://www.npmjs.com/package/@modelcontextprotocol/inspector).

CI actions use immutable commits from the maintained [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1) and [setup-node v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0) releases. Superseded branch jobs cancel instead of consuming runners unnecessarily. Consumer repos verify the shared engine's declared version and SHA-256 of canonical LF source before integration tests; Windows checkout line endings do not change that source checksum. Package smoke checks use the manifest version rather than a stale hard-coded release number.

## Practical limits and next work

Local release verification on Node 24.21.0 passed 29 Lanes tests, 22 Desk tests, and 18 MCP tests (69 total), the official Inspector tool/schema checks, both vendor checksum checks, and fresh production archive installations for all three packages. Browser verification covered saving notes, retaining a dirty draft through automatic polling, and a narrow mobile viewport without horizontal overflow. The CI matrix provides separate platform and minimum-runtime evidence; check the linked repositories' Actions results for each release commit.

Task creation requires filesystem hard-link support; ordinary NTFS, APFS, and ext4 work. Unsupported storage must fail rather than replace an existing task. Atomic publication prevents partial JSON reads but does not add cross-process compare-and-swap, merged notes, or crash-durability guarantees. The 200-task capacity check is best-effort under independent concurrent creators. Use separate worktrees for simultaneous coding tasks and keep local task files private.

Git reads describe a changing repository, not a transaction that freezes its working tree. MCP pages also use fresh reads; doctor detects changed counts or duplicate IDs during paging. Scope results still do not run project tests, inspect agent sessions, or prove completion.

Prioritize the next work around observed demand:

1. Cross-process note revision checks and creation capacity coordination, with crash recovery tests.
2. Visible saved scope patterns and reusable task templates in Desk.
3. Verified client-specific setup walkthroughs, including VS Code, plus feedback from independent users.
4. Larger-repository and multi-worktree benchmark fixtures before adopting watchers, longer-lived caches, or another runtime.

Contribution-issue drafts exist locally; this investigation does not claim those issues were posted or that external developer feedback was collected.
