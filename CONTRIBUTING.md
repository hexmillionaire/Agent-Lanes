# Contributing

Open an issue describing the task and expected behavior before a large change. Small fixes and documentation improvements are welcome directly.

Use Node 24.8+ and Git. Run `npm test`, then `npm run demo`. Tests create and remove their own temporary Git repositories. Changes to Git parsing should include a real Git fixture covering the case. Keep JSON stdout clean, use argv arrays for Git, and keep the core free of network calls and model APIs.

Scope results must never imply that tests passed or that an agent completed a task. Preserve cross-platform paths, fail on malformed task data, and document any new glob semantics. Consumer repositories vendor `src/core.mjs` and `src/templates.mjs`; update both copies and hashes deliberately. All cooperating writers must use the same coordination protocol. Do not add automatic stale-lock deletion.

Run `npm run test:package` for a fresh production installation. Concurrency fixes need real child-process tests rather than function-call simulations. Useful first contributions include minimized Git fixtures, clearer JSON diagnostics, data-only template examples and documentation corrections. See [coordination and templates](docs/COORDINATION.md).

For performance changes, run `npm run benchmark -- --tasks 20 --runs 3` and report the fixture, runtime, and every sample. Compare the same workload using `--core /path/to/historical-core.mjs`. Consumer repos run `npm run test:vendor` before integration tests.
