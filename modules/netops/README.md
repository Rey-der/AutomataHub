# NetOps Module — Network Operations Monitoring

Real-time network monitoring, host status tracking, and network scanning for infrastructure automation.

<p align="center">
  <img src="../../resources/screenshots/netops/netops.gif" alt="NetOps Monitor" width="800" />
</p>

## Features

### Live Dashboard
- Grid view of monitored hosts with current status
- Real-time status updates (online/offline/unknown)
- Latency measurement and display
- Quick ping/port check buttons
- Status change animations

### Network Scanner
- CIDR range scanning (e.g., 192.168.1.0/24)
- Ping sweep discovery
- Optional port checking
- Batch host discovery
- Add discovered hosts to monitoring

### Status History & Analytics
- 30-day status timeline
- Uptime percentage calculation
- Status change log
- Last check timestamps
- CSV export for analysis

### Real-Time Updates
- Live status push notifications
- Status change alerts
- Performance metrics (latency)
- Error tracking and logging

## Architecture

### Main Process (`main-handlers.js`)
- **HostMonitor class**: Continuous polling engine with configurable intervals
- **IPC handlers**: 12 channels for dashboard/scanner/history operations
- **Database integration**: SQLite3 persistence with 3 table schema
- **Concurrent checks**: Up to 5 simultaneous host checks per poll

### Renderer Process
- **net-dashboard.js**: Live status grid with real-time updates
- **net-scanner.js**: CIDR-based host discovery and bulk adding
- **net-history.js**: Status timeline and uptime analytics
- **styles.css**: Dashboard, card, timeline, and responsive layouts

## Database Schema

### monitored_hosts
```sql
CREATE TABLE monitored_hosts (
  id INTEGER PRIMARY KEY,
  hostname TEXT NOT NULL,
  ip_address TEXT,
  port INTEGER,
  protocol TEXT DEFAULT 'ping',
  alias TEXT,
  enabled INTEGER DEFAULT 1,
  last_status TEXT,
  last_check TEXT
);
```

### host_status_history
```sql
CREATE TABLE host_status_history (
  id INTEGER PRIMARY KEY,
  host_id INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER,
  error_message TEXT,
  port_open INTEGER,
  FOREIGN KEY (host_id) REFERENCES monitored_hosts(id)
);
```

### status_change_log
```sql
CREATE TABLE status_change_log (
  id INTEGER PRIMARY KEY,
  host_id INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  old_status TEXT,
  new_status TEXT,
  automation_triggered INTEGER,
  FOREIGN KEY (host_id) REFERENCES monitored_hosts(id)
);
```

## IPC Channels

### Invoke (Request/Response)
- `netops:add-host` — Register a new monitored host
- `netops:remove-host` — Unregister a host
- `netops:get-monitored-hosts` — Fetch all hosts with current status
- `netops:ping-host` — Single on-demand ping check
- `netops:check-port` — On-demand port connectivity check
- `netops:get-status-history` — Historical status data (paginated)
- `netops:get-host-detail` — Host detail with recent status
- `netops:update-host-config` — Modify host settings
- `netops:get-uptime-stats` — Uptime aggregates
- `netops:scan-network` — CIDR range scanning
- `netops:get-scan-results` — Fetch scan results
- `netops:trigger-automation` — Execute script on status change

### Push (One-way events)
- `netops:status-update` — Real-time host status change
- `netops:status-change` — Host went online/offline notification
- `netops:scan-progress` — CIDR scan progress updates

## Configuration

### Polling Interval
Edit `MONITORED_HOSTS_POLL_INTERVAL` in `main-handlers.js`:
```javascript
const MONITORED_HOSTS_POLL_INTERVAL = 30000; // 30 seconds
```

### Check Timeout
```javascript
const CHECK_TIMEOUT = 5000; // 5 second timeout per check
```

### Concurrent Checks
```javascript
const CONCURRENT_CHECKS = 5; // Max 5 simultaneous checks
```

## Usage Example

### Adding a Host
```javascript
const result = await API.invoke('netops:add-host', {
  hostname: 'example.com',
  ip: '93.184.216.34',
  port: 80,
  protocol: 'ping',
  alias: 'Example Website'
});
```

### Getting Current Status
```javascript
const data = await API.invoke('netops:get-monitored-hosts');
data.hosts.forEach(host => {
  console.log(`${host.alias}: ${host.last_status}`);
});
```

### Listening to Real-Time Updates
```javascript
API.onEvent('netops:status-update', (data) => {
  console.log(`${data.hostname}: ${data.status} (${data.latency_ms}ms)`);
});
```

## Integration with Script Runner

Trigger automation scripts on host status changes:

1. User configures host with automation rule (e.g., "run repair-db.sh if offline")
2. HostMonitor detects status change
3. Status change logged with `automation_triggered = 1`
4. Main process emits `netops:automation-trigger` event
5. Script runner module picks up event and executes configured script
6. Result logged back to status_change_log

## Development Roadmap

See [TODO.md](./TODO.md) for 7-week implementation phases:
- **Week 1-2**: Core infrastructure (polling, database, basic IPC)
- **Week 3-4**: Live dashboard and scanner UI
- **Week 5**: History view and analytics
- **Week 6-7**: Automation integration and production polish

## Dashboard Sketches

### Main Dashboard
```
┌─────────────────────────────────────┐
│ Network Monitor    3 Online 1 Offline│
├─────────────────────────────────────┤
│ ┌──────────────┐ ┌──────────────┐   │
│ │ example.com  │ │ api.test.io  │   │
│ │ 93.184.216.34│ │ 10.0.1.50    │   │
│ │ Status: online│ │ Status: offline│  │
│ │ Latency: 32ms│ │ Last: 2h ago │   │
│ │ [Ping] [Rem] │ │ [Ping] [Rem] │   │
│ └──────────────┘ └──────────────┘   │
└─────────────────────────────────────┘
```

### Scanner
```
┌─────────────────────────────────────┐
│ 192.168.1.0/24         [Scan]       │
├─────────────────────────────────────┤
│ 192.168.1.5  online   [Add]         │
│ 192.168.1.10 online   [Add]         │
│ 192.168.1.15 offline  [Add]         │
└─────────────────────────────────────┘
```

### History Timeline
```
┌─────────────────────────────────────┐
│ Host: example.com    Uptime: 99.8%  │
├─────────────────────────────────────┤
│ 2m ago     ● Status: online          │
│ 5h ago     ● Status: offline         │
│ 1d ago     ● Status: online          │
│            └─ Latency: 48ms          │
└─────────────────────────────────────┘
```

## Files

- `manifest.json` — Module registration
- `main-handlers.js` — IPC handlers and polling engine
- `package.json` — Module dependencies
- `renderer/net-dashboard.js` — Live status UI
- `renderer/net-scanner.js` — Network discovery UI
- `renderer/net-history.js` — Timeline and analytics UI
- `renderer/styles.css` — Module styling

## Notes

- Polling happens automatically on module load
- Each host can have custom check intervals in future versions
- Port checking uses TCP socket timeout (currently hardcoded to 5s)
- CIDR expansion limited to 254 IPs to prevent excessive scanning
- Status is cached in memory for real-time responsiveness
- All timestamps stored in SQLite as local time (`datetime('now', 'localtime')`)
