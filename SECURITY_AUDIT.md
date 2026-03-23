# Security Audit

> Last run: 23 March 2026
> Tools: **Gitleaks v8**, **Trivy v0.69**, **npm audit**, **dotnet build**, **Semgrep**

---

## Gitleaks — Secret Scanning

| Finding | File | Verdict |
|---------|------|---------|
| `generic-api-key` — SHA-1 thumbprint `3ABC01543F22DD2239285CDD818674489FBC127E` | `dist/**/*.asar` (3×) | **False positive** — certificate fingerprint in compiled build artifacts; `dist/` is excluded via `.gitignore` and never committed |

**Result: no real secrets detected in source code.**

---

## Trivy — Vulnerability & Secret Scan

Scanned: npm lockfiles (`package-lock.json`, `modules/sql_visualizer/package-lock.json`) and all C# `*.deps.json` manifests.

| Target | Type | CVEs | Secrets |
|--------|------|------|---------|
| `package-lock.json` | npm | 0 | — |
| `modules/sql_visualizer/package-lock.json` | npm | 0 | — |
| 7× C# `Script.deps.json` files | dotnet-core | 0 | — |

**Result: clean.**

---

## npm Audit

| Package | Severity | Advisory | Notes |
|---------|----------|----------|-------|
| `electron < 35.7.5` | **Moderate** | [GHSA-vmqv-hx8q-j7mg](https://github.com/advisories/GHSA-vmqv-hx8q-j7mg) — ASAR Integrity Bypass | Fix requires `electron@41` (breaking change); upgrade when ready |

---

## Semgrep — Static Analysis

**70 findings total — 7 genuine issues fixed, remainder false positives.**

### Fixed Issues

| # | Rule | File | Line | Issue | Fix Applied |
|---|------|------|------|-------|-------------|
| 1 | `bypass-tls-verification` | `modules/netops/monitoring/protocols/http.js` | 44 | `rejectUnauthorized: false` hardcoded — disables TLS certificate validation, enables MITM attacks | Changed to `process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0'` — defaults to `true`; opt-out via env var for dev/self-signed only |
| 2 | `csharp-sqli` | `modules/script_runner/automation_scripts/dashboard-summary/csharp/Program.cs` | 111 | `cmd.CommandText = sql` — string param assigned to CommandText; could carry tainted SQL if callers were changed | All callers pass static SQL literals with `@d` parameter placeholders — added `// nosemgrep` annotation documenting the constraint |
| 3 | `insecure-document-method` | `modules/netops/renderer/net-app.js` | 268 | `this.activeView` echoed unescaped into HTML placeholder | Replaced with `safeView` — strips `<>&"'` characters before insertion |
| 4 | `insecure-document-method` | `modules/netops/renderer/net-host-list.js` | 630 | `${status}` inserted unescaped into `statusCell.innerHTML` | Wrapped with `_hlEsc(status)` (the existing escape helper) |
| 5 | `insecure-document-method` | `modules/sql_visualizer/renderer/sql-timeline.js` | 185 | `${err.message}` unescaped in error banner | Wrapped with `escHtml(err.message)` |
| 6 | `insecure-document-method` | `modules/sql_visualizer/renderer/sql-timeline.js` | 360 | `${err.message}` unescaped in detail panel error banner | Wrapped with `escHtml(err.message)` |
| 7 | `insecure-document-method` | `modules/sql_visualizer/renderer/sql-home.js` | 145, 193, 202, 236 | `s.streakType`, `s.lastRun`, table names (`t.table`), script names (`g.script`), and health label/values unescaped | Added `escHtml()` helper to the module IIFE; all values now escaped before insertion |

### False Positives

The remaining 63 findings are **pattern-based false positives** — Semgrep's `insecure-document-method` rule flags every `.innerHTML =` assignment regardless of whether dynamic values are sanitized. All flagged sites either:

- Use an existing escape helper (`_esc`, `_escapeHtml`, `escHtml`, `_hdEsc`, `_hlEsc`, `_histEsc`) for **every** dynamic value in the template, or
- Insert only static strings, numbers, or boolean-derived labels with no user-controlled data

Affected files with properly sanitized innerHTML (no changes required):

| File | Escape helper |
|------|---------------|
| `modules/netops/renderer/net-alerts.js` | `this._esc()` |
| `modules/netops/renderer/net-app.js` | (static/numeric only) |
| `modules/netops/renderer/net-discovery.js` | (static/numeric only) |
| `modules/netops/renderer/net-history.js` | `_histEsc()` |
| `modules/netops/renderer/net-host-detail.js` | `_hdEsc()` |
| `modules/netops/renderer/net-host-list.js` | `_hlEsc()` |
| `modules/netops/renderer/net-overview.js` | `_escHtml()` / `_escAttr()` |
| `modules/script_runner/renderer/script-app.js` | `this._escapeHtml()` |
| `modules/script_runner/renderer/script-browser.js` | `this._escapeHtml()` |
| `modules/script_runner/renderer/script-chains.js` | `this._escapeHtml()` |
| `modules/script_runner/renderer/script-dashboard.js` | `_esc()` |
| `modules/script_runner/renderer/script-schedules.js` | `this._esc()` |
| `modules/script_runner/renderer/script-topics.js` | `this._escapeHtml()` |
| `modules/sql_visualizer/renderer/sql-analytics.js` | `escHtml()` |
| `modules/sql_visualizer/renderer/sql-table-view.js` | `escHtml()` |
| `modules/sql_visualizer/renderer/sql-timeline.js` | `escHtml()` |

---

## Tests

| Suite | Tests | Pass | Fail |
|-------|-------|------|------|
| Root (`tests/`) | db-credentials, db-scanner | 2 / 2 | 0 |
| script_runner (`tests/`) | discovery, execution, persistence, store, workflow-chaining | 5 / 5 | 0 |

---

## .NET Script Builds

All 10 C# automation script projects build successfully. One compile error was found and fixed:

| Script | Issue | Fix |
|--------|-------|-----|
| `api-health-check` | `CS0246` — `TaskCanceledException` unresolved (missing `using`) | Added `using System.Threading.Tasks;` to `Program.cs` |

---

## JS Syntax

All source JS files parse cleanly. Top-level `await` in `renderer/module-bootstrap.js` is valid — the file is loaded as `type="module"`.
