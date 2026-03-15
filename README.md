# AutomataHub

A modular Electron desktop hub for automation tools. Each capability — script execution, database visualization, network monitoring — is a self-contained module that plugs into the hub.

## Architecture

AutomataHub is a **hub + plugin** system:

- **Hub** (this repo) — provides the shell: window management, tab system, module discovery, IPC bridge, shared utilities, and a CSS theming contract.
- **Modules** (separate repos) — provide features. Each module declares its IPC channels, tab types, and renderer scripts/styles in a `manifest.json`. The hub loads them automatically.

```
AutomataHub (hub)
├── app/                    # Main process — window, IPC, module loader
│   ├── main.js             # App entry, module bootstrap
│   ├── preload.js          # Secure IPC bridge (dynamic channel allowlist)
│   └── core/               # Shared infrastructure
│       ├── module-loader.js    # Discovers modules from modules/ and node_modules/
│       ├── module-registry.js  # In-memory module metadata store
│       ├── ipc-bridge.js       # Safe IPC handler registration with cleanup
│       ├── path-utils.js       # Safe path resolution (resolveInside, ensureDir)
│       ├── config-utils.js     # JSON config reading with fallback
│       ├── event-bus.js        # Inter-module EventEmitter singleton
│       └── errors.js           # Centralized error messages
│
├── renderer/               # Renderer process — UI shell
│   ├── index.html          # Single-page app shell
│   ├── core.css            # Hub theme (CSS variables, layout, tabs)
│   ├── ui.js               # Notifications & utilities
│   ├── tab-manager.js      # Dynamic tab types, creation, switching
│   ├── module-bootstrap.js # Loads module scripts & styles at startup
│   └── pages/
│       └── home-tab.js     # Hub dashboard — shows installed modules
│
├── modules/                # Local module overrides (development)
│   └── script-runner/      # Example: Script Runner module
│
├── scripts/                # User script folders (used by script-runner)
├── logs/                   # Saved execution logs
├── resources/              # App icons & images
└── docs/                   # Design documentation
```

## Available Modules

| Module | Repo | Description |
|--------|------|-------------|
| **Script Runner** | [automatahub-script-runner](https://github.com/Rey-der/automatahub-script-runner) | Execute local scripts with live terminal output, queue management, and log saving |

## Quick Start

### Prerequisites

- **Node.js** 18+
- **npm** (comes with Node.js)

### Install & Run

```bash
git clone https://github.com/Rey-der/AutomataHub
cd AutomataHub
npm install
npm start
```

The hub opens with a dashboard showing installed modules. Click a module card to open it.

## Module Loading

The hub discovers modules from two sources:

1. **`modules/` directory** (local development) — any subfolder containing a `manifest.json`
2. **`node_modules/automatahub-*`** (npm packages) — any installed package matching the `automatahub-` prefix with a `manifest.json`

Local modules take priority. If a module exists in both locations, the local version is used.

### Installing a module

**Option 1: Clone into `modules/` for automatic discovery**

```bash
cd modules && git clone <module-repo-url>
```

The hub will discover it on next startup with no `package.json` changes needed.

**Option 2: Install as an npm package (when published)**

```bash
npm install automatahub-script-runner
```

Modules matching the `automatahub-*` pattern in `node_modules/` are automatically discovered.

### Creating a module

A minimal module needs:

```
my-module/
├── manifest.json       # Required: id, name, ipcChannels, tabTypes
├── main-handlers.js    # Optional: setup(context) and teardown() functions
├── renderer/
│   ├── my-tab.js       # Renderer scripts (registered via manifest)
│   └── styles.css      # Module styles (uses --hub-* CSS variables)
└── package.json        # For npm distribution
```

See the [Script Runner module](https://github.com/Rey-der/automatahub-script-runner) for a complete example.

## Security

- Context isolation and sandbox enabled (no `nodeIntegration`)
- CSP headers: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'`
- Dynamic IPC channel allowlisting — modules can only use channels declared in their manifest
- Path containment validation via `resolveInside()` — blocks path traversal
- All child processes spawned with `shell: false`
- Input validation at preload boundary

See [SECURITY.md](SECURITY.md) for the full policy.

## Development

```bash
npm start     # Start the app
npm run dev   # Same as start (development mode)
npm run build # Build distributable (requires electron-builder)
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — Module system design and data flow
- [DOCUMENTATION.md](DOCUMENTATION.md) — Comprehensive technical reference

## License

ISC
