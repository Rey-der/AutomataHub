# AutomataHub — Cleanup TODO

> Make the project honest and portfolio-ready.  
> Every item either replaces fake data with real data, or removes the fake feature entirely.  
> No half-measures: if it can't be real, it doesn't ship.

---

## Critical: Fake Metrics (NetOps)

The entire metrics layer generates random numbers and displays them as if they're real.  
**Every chart, KPI card, and aggregate stat in the host detail view is lying.**

### Option A: Replace with Real Local-Machine Metrics (Recommended)

Use Node.js `os` module to collect real metrics from the machine running AutomataHub.  
This makes the feature genuine — it monitors the local host for real.

- [x] **Rewrite `modules/netops/monitoring/metrics-collector.js`**  
  Replace all `randomInt()` calls with real OS data:
  ```
  CPU:     os.cpus() → calculate usage from idle/total deltas between samples
  Memory:  os.totalmem(), os.freemem() → real usage percentage
  Network: parse /proc/net/dev (Linux) or os.networkInterfaces() for interface list
  Uptime:  os.uptime()
  ```
  Remove `const { randomInt } = require('node:crypto')` entirely.  
  Remove all comments containing "simulated", "Phase 2", "will be replaced".

- [x] **Remove buffer metrics entirely**  
  Buffer hit/miss/rate metrics have no real data source on a local machine without SNMP.  
  Delete `collectBufferMetrics()` from the collector.  
  Remove buffer chart from `modules/netops/renderer/net-host-detail.js`.  
  Remove `netops:get-buffer-metrics` IPC handler from `modules/netops/handlers/metrics.js`.  
  Remove buffer metric storage from `modules/netops/core/data-store.js`.  
  Clean up buffer references in `modules/netops/core/persistence.js` schema.

- [x] **Remove network traffic metrics**  
  Packets and traffic MB/s require `/proc/net/dev` parsing (Linux-only) or platform-specific code.  
  If you can implement it cross-platform: keep it with real data.  
  If not: remove `collectNetworkMetrics()` and the associated chart/handler/store code.  
  Better to have 2 real charts (CPU + memory) than 4 fake ones.

- [x] **Update the host detail renderer**  
  `modules/netops/renderer/net-host-detail.js`:  
  - Remove any chart that no longer has a real data source
  - Update KPI cards to only show real aggregate values
  - Add "Local Machine Only" label if metrics only cover the AutomataHub host

- [x] **Update the overview dashboard**  
  `modules/netops/renderer/net-overview.js`:  
  ✅ Verified clean — all KPIs (uptime, online/offline, avg latency, alerts) are derived from real status checks. No dependency on fake collector.

### Option B: Remove Metrics Entirely

~~Skipped — Option A implemented. Metrics now use real OS data.~~

---

## Critical: Default Password

- [x] **Remove `initDefaultCredentials()` from `app/main.js`** (lines 245-260)  
  This sets `'0000'` as the password for every discovered database on first startup.  
  A reviewer will see this in 5 seconds and question your security awareness.  
  
  **Fix:** Remove the function entirely. Remove the call on line ~274. Let databases start with no credential — the DB Manager UI already handles the "no password set" state.

- [x] **Remove `logCredentialStatus()` call** (line ~275) if it depends on default creds being set.  
  Check if it still works correctly when some DBs have no credential.
  ✅ Kept — it works independently. Only logs status, doesn't require defaults.

---

## Medium: Phase/TODO Comments in Source Code

These comments advertise incomplete work. Remove them or do the work.

- [x] **`modules/netops/renderer/styles.css` line 269**  
  ✅ Stale TODO removed.

- [x] **`modules/netops/renderer/styles.css` line 337**  
  ✅ Stale TODO removed.

- [x] **`modules/netops/renderer/styles.css` lines 554, 641, 699, 717, 1120**  
  ✅ All "Phase 2" labels removed from section headers.

- [x] **`modules/netops/renderer/net-app.js` lines 4-5**  
  ✅ Comment updated to list actual implemented views.

- [x] **`modules/netops/renderer/net-history.js` line 2**  
  ✅ "Phase 6" label removed.

- [x] **`modules/netops/monitoring/metrics-collector.js` lines 4-9, 20, 41, 61**  
  ✅ Entire file rewritten — all Phase/stub comments gone.

- [x] **`modules/netops/core/data-store.js` line 4**  
  `Future: swap arrays/maps for sql.js persistence.`  
  ✅ Stale comment replaced.

- [x] **`modules/netops/README.md` line 181**  
  ✅ Dead TODO.md reference and roadmap section removed.

---

## Medium: Stale "Phase 2" Labels in SQL Visualizer

- [x] **`modules/sql_visualizer/main-handlers.js` line 282**  
  ✅ "Phase 2" label removed.

- [x] **`modules/sql_visualizer/renderer/styles.css` line 809**  
  ✅ "Phase 2" label removed.

---

## Low: Test Quality

These are acceptable for a portfolio project but worth noting:

- [x] **`tests/db-credentials.test.js`** — mocks Electron's safeStorage with XOR.  
  ✅ Acceptable — can't run Electron APIs in plain Node.js tests. No change needed.

- [x] **`modules/script_runner/tests/script-discovery.test.js` line 16** — "minimal stubs".  
  ✅ Renamed to "test fixtures for IPC infrastructure".

- [x] **Missing test coverage for NetOps and SQL Visualizer**  
  ✅ Added 3 NetOps test files (data-store: 30 tests, network-scanner: 9 tests, alert-engine: 12 tests) and 1 SQL Visualizer test file (db-bridge: 13 tests). Total suite: 84 tests, 0 failures.

---

## Low: Cosmetic/Comment Cleanup

- [x] **`modules/script_runner/renderer/execution-tab.js` line 676**  
  ✅ Removed — "Reserved for future" comment replaced.

- [x] **`modules/netops/README.md` line 246**  
  ✅ Fixed: timeout is configurable via HostMonitor constructor.

- [x] **`modules/netops/README.md` line 245**  
  ✅ Removed — "future versions" promise deleted.

---

## Verification Checklist

After all fixes, run these checks:

```bash
# No fake data generators in production code
grep -rn "randomInt\|Math\.random" modules/ --include="*.js" | grep -v test | grep -v node_modules

# No TODO/FIXME in source (excluding docs)
grep -rn "TODO\|FIXME\|HACK\|XXX" modules/ app/ renderer/ --include="*.js" --include="*.css"

# No "Phase 2" / "will be replaced" / "simulated" / "stub" / "placeholder" in code comments
grep -rn "Phase [0-9]\|will be replaced\|simulated\|stub\|placeholder" modules/ app/ --include="*.js" | grep -v node_modules | grep -v test

# No default password
grep -rn "0000\|DEFAULT_PASSWORD" app/ --include="*.js"

# App starts and runs without errors
npm start
```
