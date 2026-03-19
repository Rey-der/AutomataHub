/**
 * SensorPoller — polls sensors at their configured intervals.
 *
 * In a real deployment this would speak SNMP, Modbus, MQTT, etc.
 * For now it simulates realistic sensor readings so the UI can be
 * developed and tested without real hardware.
 *
 * Each sensor type produces values in a plausible range:
 *   - temperature: 18-35 C with slow drift
 *   - humidity: 30-80 %
 *   - pressure: 990-1030 hPa
 *   - network: 0-1000 Mbps throughput
 *   - power: 100-250 V, 0-20 A
 *   - generic: 0-100 arbitrary units
 */

class SensorPoller {
  constructor(store, emit) {
    this._store = store;
    this._emit = emit;
    this._timers = new Map();
    this._driftState = new Map();
  }

  /**
   * Start polling a sensor at its configured interval.
   */
  start(sensorId) {
    this.stop(sensorId);
    const sensor = this._store.getSensor(sensorId);
    if (!sensor || !sensor.enabled) return;

    const intervalMs = (sensor.interval_s || 60) * 1000;
    this._poll(sensorId);
    const timer = setInterval(() => this._poll(sensorId), intervalMs);
    this._timers.set(sensorId, timer);
  }

  /**
   * Stop polling a sensor.
   */
  stop(sensorId) {
    const timer = this._timers.get(sensorId);
    if (timer) {
      clearInterval(timer);
      this._timers.delete(sensorId);
    }
  }

  /**
   * Stop all polling.
   */
  stopAll() {
    for (const [id] of this._timers) this.stop(id);
  }

  /**
   * Poll a single sensor once and push the reading.
   */
  _poll(sensorId) {
    const sensor = this._store.getSensor(sensorId);
    if (!sensor) {
      this.stop(sensorId);
      return;
    }

    const reading = this._generateReading(sensor);
    this._store.pushReading(sensorId, reading);
    this._checkThresholds(sensor, reading);

    this._emit('sensor-monitor:sensor-updated', {
      sensor_id: sensorId,
      value: reading.value,
      unit: reading.unit,
      status: sensor.status,
      timestamp: reading.timestamp,
    });
  }

  /**
   * Generate a simulated reading based on sensor type.
   */
  _generateReading(sensor) {
    const type = (sensor.type || 'generic').toLowerCase();
    const now = new Date().toISOString();

    let drift = this._driftState.get(sensor.id) || 0;
    drift += (Math.random() - 0.5) * 0.4;
    drift = Math.max(-5, Math.min(5, drift));
    this._driftState.set(sensor.id, drift);

    const noise = () => (Math.random() - 0.5) * 2;
    let value, unit;

    switch (type) {
      case 'temperature':
        value = 22 + drift + noise() * 1.5;
        unit = sensor.unit || 'C';
        break;
      case 'humidity':
        value = 55 + drift * 3 + noise() * 2;
        unit = sensor.unit || '%';
        break;
      case 'pressure':
        value = 1013 + drift * 2 + noise();
        unit = sensor.unit || 'hPa';
        break;
      case 'network':
        value = Math.max(0, 450 + drift * 30 + noise() * 50);
        unit = sensor.unit || 'Mbps';
        break;
      case 'power':
        value = Math.max(0, 230 + drift * 2 + noise() * 3);
        unit = sensor.unit || 'V';
        break;
      case 'current':
        value = Math.max(0, 8 + drift + noise() * 1.5);
        unit = sensor.unit || 'A';
        break;
      case 'light':
        value = Math.max(0, 500 + drift * 30 + noise() * 20);
        unit = sensor.unit || 'lux';
        break;
      case 'co2':
        value = Math.max(0, 400 + drift * 10 + noise() * 15);
        unit = sensor.unit || 'ppm';
        break;
      default:
        value = 50 + drift * 5 + noise() * 5;
        unit = sensor.unit || '';
        break;
    }

    return { value: Math.round(value * 100) / 100, unit, timestamp: now };
  }

  /**
   * Check if a reading crosses any thresholds and raise alerts.
   */
  _checkThresholds(sensor, reading) {
    const thresholds = this._store.getThresholds(sensor.id);
    for (const t of thresholds) {
      if (!t.enabled) continue;
      const triggered = this._evaluateThreshold(reading.value, t.operator, t.value);
      if (triggered) {
        const alert = this._store.addAlert({
          sensor_id: sensor.id,
          threshold_id: t.id,
          message: `${sensor.name}: ${reading.value} ${reading.unit} ${t.operator} ${t.value} (${t.severity})`,
          severity: t.severity,
          value: reading.value,
        });

        this._store.updateSensor(sensor.id, { status: 'warning' });
        this._emit('sensor-monitor:sensor-alert', {
          alert,
          sensor_id: sensor.id,
          sensor_name: sensor.name,
        });
      }
    }
  }

  _evaluateThreshold(actual, operator, target) {
    switch (operator) {
      case '>': return actual > target;
      case '>=': return actual >= target;
      case '<': return actual < target;
      case '<=': return actual <= target;
      case '==': return Math.abs(actual - target) < 0.01;
      case '!=': return Math.abs(actual - target) >= 0.01;
      default: return false;
    }
  }

  /**
   * Poll a sensor on demand (outside normal interval).
   */
  pollNow(sensorId) {
    this._poll(sensorId);
    return this._store.getSensor(sensorId);
  }
}

module.exports = { SensorPoller };
