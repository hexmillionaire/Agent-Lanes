# Contributing

Open an issue describing the task and expected behavior before a large change. Small fixes and documentation improvements are welcome directly.

Use Node 24.8+ and Git. Run `npm test`, then `npm run demo`. Tests create and remove their own temporary Git repositories. Changes to Git parsing should include a real Git fixture covering the case. Keep JSON stdout clean, use argv arrays for Git, and keep the core free of network calls and model APIs.

Scope results must never imply that tests passed or that an agent completed a task. Preserve cross-platform paths, fail on malformed task data, and document any new glob semantics. Consumer repositories vendor `src/core.mjs`; update those copies deliberately when changing the public task format.
