# Security Policy for AI-Assisted Development

## Purpose

This document defines security controls for using AI-generated code in this project.
The goal is to reduce risks from incorrect, unsafe, or malicious suggestions while keeping development fast.

## Scope

Applies to:
- All source code, scripts, and configuration in this repository
- All AI-assisted contributions (Copilot, ChatGPT, Claude, or similar tools)
- All dependencies and external code snippets introduced by AI suggestions

## Core Principles

1. AI output is untrusted input until reviewed.
2. Security is a merge gate, not a post-release task.
3. Least privilege by default for code, tools, and runtime permissions.
4. Secrets must never appear in prompts, code, logs, or commits.
5. Every AI-generated change must be explainable by a human reviewer.

## AI-Specific Threat Model

### Primary Risks
- Insecure code patterns (command injection, path traversal, unsafe eval)
- Hallucinated APIs and false security assumptions
- Supply chain risks from unvetted packages
- Prompt injection via docs/comments/code samples copied into prompts
- Secret leakage in prompts, generated code, logs, or telemetry
- Copyright or license contamination from copied snippets

### High-Impact Areas in This Project
- Script execution engine and child process spawning
- File system access for script import and log writing
- IPC boundary between renderer and main process
- Preload bridge API exposure
- Dependency installation decisions from AI recommendations

## Mandatory Secure Coding Rules

### 1) Input Validation and Sanitization
- Validate all IPC payloads in main process handlers.
- Reject unknown fields and invalid types.
- Normalize and validate file paths before use.
- Never concatenate untrusted input into shell commands.

### 2) Safe Process Execution
- Use argument arrays with spawn; avoid shell=true unless strictly required.
- If shell=true is required, apply strict allowlists and escaping.
- Disallow execution from hidden/system folders.
- Enforce one running process at a time via queue policy.

### 3) Filesystem Safety
- Restrict script imports to allowed project directories.
- Block path traversal patterns and symlink escapes.
- Validate file extensions and executable checks before run.
- Write logs only inside the logs directory.

### 4) IPC and Preload Hardening
- Keep context isolation enabled.
- Expose a minimal, explicit preload API surface.
- Do not expose raw ipcRenderer or Node primitives to renderer.
- Gate sensitive actions by tab and request context.

### 5) Secrets and Sensitive Data
- Never paste API keys, tokens, private certs, or credentials into AI prompts.
- Never store secrets in code, docs, examples, or logs.
- Use environment variables for secrets.
- Add secret scanning before merge.

### 6) Dependency and Supply Chain Controls
- AI-suggested packages require explicit human approval.
- Pin versions where practical and track transitive changes.
- Prefer well-maintained packages with active security history.
- Remove unused dependencies quickly.

## AI Contribution Workflow (Required)

For every AI-generated change:

1. Human reads and understands all changed lines.
2. Human verifies behavior against project architecture docs.
3. Human checks for security anti-patterns in changed code.
4. Human confirms dependency additions are justified.
5. Human runs tests and relevant manual security checks.
6. Human records summary in PR description: what AI generated and how validated.

No merge if any step is skipped.

## Prompt Hygiene Rules

- Never include secrets, private keys, production URLs, or customer data in prompts.
- Share only minimal context needed for the task.
- Strip stack traces or logs that may contain sensitive data before prompting.
- Treat AI responses as drafts, not authoritative truth.

## Review Checklist for AI-Generated Code

Use this checklist in PRs:

- [ ] No command injection paths
- [ ] No path traversal or unsafe path joins
- [ ] IPC payloads validated and typed
- [ ] Preload API remains minimal and explicit
- [ ] No unsafe eval or dynamic code execution
- [ ] No hardcoded secrets or credentials
- [ ] Dependencies reviewed and justified
- [ ] Error handling does not leak sensitive internals
- [ ] Logging avoids tokens, secrets, and personal data
- [ ] Tests cover new logic and failure paths

## Security Testing Baseline

Minimum checks before merge:

- Static analysis or linter pass
- Dependency vulnerability scan
- Manual negative tests for:
  - Invalid IPC payloads
  - Invalid folder import paths
  - Malformed metadata files
  - Script stop/queue edge cases

Recommended:

- SAST tool integration in CI
- Secret scanning in CI
- Periodic dependency audit schedule

## Incident Handling

If suspected AI-induced vulnerability is found:

1. Stop release and triage severity.
2. Create hotfix branch and patch immediately.
3. Review recent AI-generated commits for related patterns.
4. Add regression tests to prevent recurrence.
5. Update this policy with lessons learned.

## Ownership

- Security owner: project maintainer(s)
- Review responsibility: all code reviewers
- Policy review cadence: at major milestones or every 30 days

## Appendix: Project-Specific Guardrails

For this AutomataHub project specifically:

- Script folders must pass validation before registration.
- User-selected main executable must be checked for allowed type.
- Queue must isolate output by tab identifier.
- Log files must use sanitized names and fixed output directory.
- Renderer must not have direct filesystem or process execution access.

---

Last Updated: March 13, 2026
Version: 1.0
