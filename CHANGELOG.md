# Changelog

## Unreleased

## 0.4.2 — 2026-10-28

- Bound task-file reads through an identity-checked descriptor, reject malformed UTF-8 and detect observed file changes during a read.
- Escape terminal controls in human CLI output and diagnostics while preserving original authored values in machine-readable JSON.
- Validate current patched Node 24 and Node 26 LTS while retaining the Node 24.8 functional minimum.
- Security: deny patterns are also evaluated against a case-folded, NFC-normalised copy of the path, so `src/Secrets/key.pem` or an NFD spelling can no longer slip past `deny: src/secrets/**` and overwrite the denied file on a case-insensitive checkout. Allow patterns stay byte-exact.
- Security: local audits list untracked files with the user's global Git excludes file disabled, and report entries hidden by repository ignore rules in a new `ignored` field (and a handoff line) instead of silently dropping them. An agent that appends `*` to an allowed `.gitignore` can no longer hide new files from `check`.
- Security: the PR check reads the diff with `--raw` and fails closed on symbolic links (mode `120000`) the way it already did for submodules, reporting them in a new `symlinks` field. A docs-lane PR could previously add `docs/x -> ../.agent-lanes-policy.json` and pass. `parseRawDiff` is now exported from the core.
- Security: the dogfood policy denies `.github/workflows/**` and `action.yml` in every lane. A PR allowed to edit workflow files can rewrite the scope check that gates it, because GitHub runs the workflow definition from the PR head. `docs/PR-CHECK.md` explains the rule for downstream policies.
- The scope workflow and the documented example pin the action to the 0.4.1 release commit instead of a 0.2.0 commit that predates the hidden-file deny fix.

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
