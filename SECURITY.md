# Security

Report vulnerabilities privately through GitHub's private vulnerability reporting when available; otherwise open a minimal issue asking for a private contact without including exploit details or secrets.

Agent Lanes is a path audit and handoff helper, not a sandbox, tamper-proof record, or completion verifier. Same-user processes can change task data or race filesystem checks. Run it only on trusted local repositories. Task directories and files must not be symlinks. Git subprocesses receive fixed argv arrays, disable fsmonitor and optional index locks, and do not run external diff or text conversion commands. Submodules require separate audits, and the PR check fails closed on symbolic links. Deny patterns are also matched case-insensitively and after Unicode NFC normalisation, so a spelling that a case-insensitive checkout resolves to a denied path is denied. Local audits ignore the user's global Git excludes file and list entries that repository ignore rules hide.

Review user-authored notes and file names before sharing reports. The tool makes no network calls and does not read session transcripts or environment files.
