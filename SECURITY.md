# Security

Report vulnerabilities privately through GitHub's private vulnerability reporting when available; otherwise open a minimal issue asking for a private contact without including exploit details or secrets.

Agent Lanes is a path audit and handoff helper, not a sandbox, tamper-proof record, or completion verifier. Same-user processes can change task data or race filesystem checks. Run it only on trusted local repositories. Task directories and files must not be symlinks. Git subprocesses receive fixed argv arrays, disable fsmonitor and optional index locks, and do not run external diff or text conversion commands. Submodules require separate audits.

Review user-authored notes and file names before sharing reports. The tool makes no network calls and does not read session transcripts or environment files.
