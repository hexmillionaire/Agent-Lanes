# Development use of v0.2

We used Agent Lanes tasks to scope the actual v0.2 changes in all three repositories, and the updated Desk board to inspect their paths. A browser-created task in Agent Desk exercised creation, review state, notes, draft preservation, and handoff export. SDK and official Inspector tests exercised the same task format through stdio.

The initial release scope used `*.json`, which correctly flagged the hidden `.agent-lanes-policy.json` bootstrap file as outside scope. We explicitly authored that one path in our local release tasks and documented the glob behavior. We did not change a trusted PR policy to make an audit pass. The committed development policies deny policy edits in later PRs.

Local task JSON is editable by its owner; the CLI and Desk preserve scope during note updates. PR audits instead read policy from a chosen trusted commit. These are distinct trust assumptions, now explained in the quickstart.

This is developer testing, not feedback from independent users. Use the workflow feedback template to report setup friction and reproducible failures. CI, archive-install checks, and PR validation results are linked from the release notes.
