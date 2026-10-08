# Check pull-request scope

Commit `.agent-lanes-policy.json` to the target branch before enabling the check:

```json
{
  "version": 1,
  "lanes": {
    "development": {
      "allow": ["src/**", "test/**", "docs/**"],
      "deny": ["src/secrets/**", ".agent-lanes-policy.json"]
    }
  }
}
```

Run the CLI with full lowercase commit SHAs already present in the local object database:

```sh
agent-lanes check-pr development --repo /path/to/repo --base FULL_BASE_SHA --head FULL_HEAD_SHA --json
```

The policy is read directly from the **base commit's Git blob**. The head's policy and local task notes cannot change the result. The diff covers the merge base through the head, so unrelated target-branch changes are excluded. Renames check both paths. Submodules fail closed. Missing policies/lanes, shallow history without a merge base, and malformed input fail rather than produce a pass. Exit codes are 0 (within scope), 1 (scope failure), and 2 (input/Git error).

The committed policy is a team lane template, separate from private `.agent-lanes/` task notes. Configure a lane in trusted workflow code. Do not take the lane or base SHA from a PR body, label, title, or file. A PR can intentionally change the policy for future PRs; review those changes separately.

## GitHub Actions

See [the example workflow](examples/scope-check.yml). It uses `pull_request`, a read-only token, a base checkout, and the Agent Lanes action. It fetches the PR head as Git objects and executes no scripts from the PR checkout. Install Node 24.8+ before the composite action.

Pin the action to a reviewed full commit SHA. Tags can move. Keep credentials out of this job and do not switch to `pull_request_target` to make fork checks work. GitHub documents why [privileged pull-request workflows need special care](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target).

To make a failing audit prevent merging, configure the job as a required check in branch rules. Review and protect the workflow and policy files (for example with CODEOWNERS and branch rules). The checker cannot stop a maintainer changing a policy or a PR changing its own workflow definition; a successful job alone is not a security boundary.

## Limits

This audits net committed paths. It does not inspect source contents, run tests, infer authorship, inspect ignored working-tree files, or prove completion. Keep tests and code review as separate checks. PR audits include changes to `.agent-lanes/`; only local task audits exclude that storage directory.
