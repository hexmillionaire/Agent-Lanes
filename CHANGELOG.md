# Changelog

## 0.4.1

- Deny patterns now also match hidden files and directories (`secrets/**` denies `secrets/.key`). Previously a hidden file could pass the gate when an allow pattern named it. Allow patterns are unchanged. Companion tools pick this up when they re-vendor the core.
- Handoffs keep task text containing a lone carriage return inside its quote block.
- Add `llms.txt`, Action branding, and npm `homepage`/`bugs` metadata.

## 0.4.0

- Coordinate CLI/server mutations across processes and enforce revision checks inside the writer lock.
- Preserve independent note fields, enforce the 200-task cap and provide lock-status diagnostics with explicit crash recovery.
- Read strictly data-only scope templates and create tasks with --template.
- Retain batched Git audits and the v1 task format.


## 0.3.0

- Share fresh Git reads and one diff per distinct task base across a batch; bound Git concurrency and support cancellation.
- Publish complete task JSON atomically and reject oversized data before writing. Task creation requires filesystem hard-link support.
- Fail closed when a captured submodule is removed, even with ignore-submodule Git settings.
- Add reproducible benchmarks and test the minimum Node 24.8 runtime as well as current Node 24 LTS on three OSes.

## 0.2.0

- Committed lane policies and PR audits read from the trusted base Git blob.
- Composite GitHub Action and example workflow with read-only permissions.
- Policy-bypass, rename, merge-base, malformed-policy, and submodule tests.
- Task-count limit and monotonic note timestamps for dashboard conflict checks.
- Connected quickstart, demo walkthrough, and feedback templates.

## 0.1.0

- Portable task records with allowed and denied path patterns.
- Audits of committed, staged, unstaged, and non-ignored new files since a fixed base.
- Notes, JSON reports, and Markdown handoffs.
- Integration tests and CI for Windows, Linux, and macOS.
