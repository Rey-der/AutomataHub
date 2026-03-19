/**
 * Sensor Monitor — main-process entry point.
 *
 * Orchestrator: creates shared dependencies, wires handler modules,
 * and manages the polling lifecycle.
 *
 * Handler domains:
 *   handlers/sensors.js   — sensor CRUD, readings, dashboard stats
 *   handlers/discovery.js — network sensor discovery
 *   handlers/alerts.js    — thresholds and alert management
 */

const { SensorStore } = require('./core/sensor-store');
const { SensorPersistence } = require('./core/sensor-persistence');
const { SensorPoller } = require('./monitoring/sensor-poller');

const sensorsHandler = require('./handlers/sensors');
const discoveryHandler = require('./handlers/discovery');
const alertsHandler = require('./handlers/alerts');

let persistence = null;
let poller = null;

function setup(config) {
  const { ipcBridge, send } = config;

  const store = new SensorStore();

  function emit(channel, data) {
    if (send) send(channel, data);
  }

  poller = new SensorPoller(store, emit);

  // --- SQLite persistence (async init) ---
  persistence = new SensorPersistence();
  persistence.init().then(() => {
    // Load stored data into the in-memory store
    const sensors = persistence.loadAllSensors();
    for (const s of sensors) store.addSensor(s);

    const thresholds = persistence.loadAllThresholds();
    for (const t of thresholds) store.setThreshold(t);

    const alerts = persistence.loadAllAlerts();
    for (const a of alerts) store._alerts.push(a);

    store.setPersistence(persistence);

    // Start polling all enabled sensors
    for (const s of store.getAllSensors(true)) {
      poller.start(s.id);
    }

    console.log(`[sensor-monitor] Persistence ready — ${sensors.length} sensors loaded`);
  }).catch((err) => {
    console.error('[sensor-monitor] Persistence init failed — running in-memory only:', err.message);
    persistence = null;
  });

  // --- Register IPC handlers ---
  const deps = { store, poller, emit };
  sensorsHandler.register(ipcBridge, deps);
  discoveryHandler.register(ipcBridge, deps);
  alertsHandler.register(ipcBridge, deps);

  // Seed demo sensors if store is empty after a short delay
  // (gives persistence time to load; skips if data already exists)
  setTimeout(() => {
    if (store.getAllSensors().length === 0) {
      seedDemoSensors(store, poller);
    }
  }, 2000);

  console.log('[sensor-monitor] Module setup complete');
}

function teardown() {
  if (poller) {
    poller.stopAll();
    poller = null;
  }
  if (persistence) {
    persistence.close();
    persistence = null;
  }
  console.log('[sensor-monitor] Module teardown complete');
}

/**
 * Seed a handful of demo sensors so the UI has data on first run.
 */
function seedDemoSensors(store, poller) {
  const demos = [
    { name: 'Server Room Temp', type: 'temperature', host: '192.168.1.10', protocol: 'snmp', unit: 'C', interval_s: 10 },
    { name: 'Server Room Humidity', type: 'humidity', host: '192.168.1.10', protocol: 'snmp', unit: '%', interval_s: 10 },
    { name: 'Office CO2 Level', type: 'co2', host: '192.168.1.20', protocol: 'mqtt', unit: 'ppm', interval_s: 15 },
    { name: 'UPS Voltage', type: 'power', host: '192.168.1.5', protocol: 'snmp', unit: 'V', interval_s: 10 },
    { name: 'UPS Current Draw', type: 'current', host: '192.168.1.5', protocol: 'snmp', unit: 'A', interval_s: 10 },
    { name: 'WAN Throughput', type: 'network', host: '192.168.1.1', protocol: 'snmp', unit: 'Mbps', interval_s: 5 },
    { name: 'Office Light Level', type: 'light', host: '192.168.1.25', protocol: 'mqtt', unit: 'lux', interval_s: 30 },
    { name: 'Atmospheric Pressure', type: 'pressure', host: '192.168.1.20', protocol: 'http', unit: 'hPa', interval_s: 60 },
  ];

  for (const d of demos) {
    const sensor = store.addSensor(d);
    poller.start(sensor.id);
  }
  console.log(`[sensor-monitor] Seeded ${demos.length} demo sensors`);
}

module.exports = { setup, teardown };
