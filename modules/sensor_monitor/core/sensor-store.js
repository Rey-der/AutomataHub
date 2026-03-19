/**
 * SensorStore — in-memory store for sensor data.
 * Holds discovered sensors, live readings, thresholds, and alerts.
 * Optionally backed by SensorPersistence for disk writes.
 */

class SensorStore {
  constructor() {
    this._sensors = new Map();
    this._readings = new Map();
    this._thresholds = new Map();
    this._alerts = [];
    this._persistence = null;
    this._nextId = 1;
    this._nextAlertId = 1;
  }

  setPersistence(p) {
    this._persistence = p;
  }

  // --- Sensors ---

  addSensor(sensor) {
    const id = sensor.id || `sensor-${this._nextId++}`;
    const record = {
      id,
      name: sensor.name || 'Unnamed Sensor',
      type: sensor.type || 'generic',
      host: sensor.host || '127.0.0.1',
      port: sensor.port || null,
      protocol: sensor.protocol || 'snmp',
      unit: sensor.unit || '',
      interval_s: sensor.interval_s || 60,
      enabled: sensor.enabled !== false,
      status: sensor.status || 'unknown',
      last_value: sensor.last_value ?? null,
      last_seen: sensor.last_seen || null,
      added_at: sensor.added_at || new Date().toISOString(),
      metadata: sensor.metadata || {},
    };
    this._sensors.set(id, record);
    if (this._persistence) this._persistence.upsertSensor(record);
    return record;
  }

  updateSensor(id, updates) {
    const sensor = this._sensors.get(id);
    if (!sensor) return null;
    Object.assign(sensor, updates);
    if (this._persistence) this._persistence.upsertSensor(sensor);
    return sensor;
  }

  removeSensor(id) {
    const existed = this._sensors.delete(id);
    this._readings.delete(id);
    if (existed && this._persistence) this._persistence.removeSensor(id);
    return existed;
  }

  getSensor(id) {
    return this._sensors.get(id) || null;
  }

  getAllSensors(enabledOnly = false) {
    const all = [...this._sensors.values()];
    return enabledOnly ? all.filter((s) => s.enabled) : all;
  }

  // --- Readings ---

  pushReading(sensorId, reading) {
    if (!this._readings.has(sensorId)) this._readings.set(sensorId, []);
    const buf = this._readings.get(sensorId);
    const record = {
      sensor_id: sensorId,
      value: reading.value,
      unit: reading.unit || '',
      timestamp: reading.timestamp || new Date().toISOString(),
    };
    buf.push(record);
    if (buf.length > 500) buf.splice(0, buf.length - 500);

    // Update sensor live value
    const sensor = this._sensors.get(sensorId);
    if (sensor) {
      sensor.last_value = record.value;
      sensor.last_seen = record.timestamp;
      sensor.status = 'online';
    }

    if (this._persistence) this._persistence.insertReading(record);
    return record;
  }

  getReadings(sensorId, limit = 100) {
    const buf = this._readings.get(sensorId) || [];
    return buf.slice(-limit);
  }

  // --- Thresholds ---

  setThreshold(threshold) {
    const id = threshold.id || `thresh-${Date.now()}`;
    const record = {
      id,
      sensor_id: threshold.sensor_id,
      metric: threshold.metric || 'value',
      operator: threshold.operator || '>',
      value: threshold.value,
      severity: threshold.severity || 'warning',
      enabled: threshold.enabled !== false,
      created_at: threshold.created_at || new Date().toISOString(),
    };
    this._thresholds.set(id, record);
    if (this._persistence) this._persistence.upsertThreshold(record);
    return record;
  }

  getThresholds(sensorId) {
    return [...this._thresholds.values()].filter(
      (t) => !sensorId || t.sensor_id === sensorId
    );
  }

  removeThreshold(id) {
    const existed = this._thresholds.delete(id);
    if (existed && this._persistence) this._persistence.removeThreshold(id);
    return existed;
  }

  // --- Alerts ---

  addAlert(alert) {
    const id = `alert-${this._nextAlertId++}`;
    const record = {
      id,
      sensor_id: alert.sensor_id,
      threshold_id: alert.threshold_id || null,
      message: alert.message,
      severity: alert.severity || 'warning',
      value: alert.value,
      acknowledged: false,
      created_at: new Date().toISOString(),
    };
    this._alerts.push(record);
    if (this._alerts.length > 1000) this._alerts.splice(0, this._alerts.length - 1000);
    if (this._persistence) this._persistence.insertAlert(record);
    return record;
  }

  acknowledgeAlert(id) {
    const alert = this._alerts.find((a) => a.id === id);
    if (!alert) return null;
    alert.acknowledged = true;
    if (this._persistence) this._persistence.acknowledgeAlert(id);
    return alert;
  }

  getAlerts(opts = {}) {
    let list = [...this._alerts];
    if (opts.sensor_id) list = list.filter((a) => a.sensor_id === opts.sensor_id);
    if (opts.unacknowledged) list = list.filter((a) => !a.acknowledged);
    return list.slice(-( opts.limit || 200));
  }

  getActiveAlertCount() {
    return this._alerts.filter((a) => !a.acknowledged).length;
  }

  // --- Dashboard stats ---

  getStats() {
    const sensors = this.getAllSensors();
    const online = sensors.filter((s) => s.status === 'online').length;
    const offline = sensors.filter((s) => s.status === 'offline').length;
    const warning = sensors.filter((s) => s.status === 'warning').length;
    return {
      total: sensors.length,
      online,
      offline,
      warning,
      unknown: sensors.length - online - offline - warning,
      active_alerts: this.getActiveAlertCount(),
    };
  }
}

module.exports = { SensorStore };
