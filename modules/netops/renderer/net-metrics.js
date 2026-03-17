/**
 * NetOps Metrics Dashboard — Real-time metrics visualization with charts and KPIs.
 * Displays status pills, aggregate metrics, and 6 interactive charts.
 */

const API = globalThis.api;

class NetMetricsDashboard {
  constructor() {
    this.hosts = [];
    this.statusMap = new Map(); // { host_id -> { status, latency_ms, timestamp } }
    this.metricsCache = new Map(); // { host_id -> { network: [], system: [], buffer: [] } }
    this.charts = new Map(); // { chartId -> Chart.js instance }
    this.timeRange = '24h'; // Default: last 24 hours
    this.unsubscribeStatus = null;
    this.unsubscribeMetrics = null;
    this.autoRefreshInterval = null;
    this.chartRefreshInterval = null;
    this.singleHostId = null; // If set, show only this host's metrics
  }

  /**
   * Initialize the metrics dashboard.
   */
  async init(el) {
    this.container = el;
    this.renderSkeleton();
    await this.loadHosts();
    await this.loadMetrics();
    this.setupRealtimeUpdates();
    this.startAutoRefresh();
  }

  /**
   * Initialize for a specific host (single-host detail view).
   */
  async initForHost(hostId, hostData, el) {
    console.log('[net-metrics] 🚀 Initializing detail view for host:', {
      hostId,
      hostData: hostData?.hostname,
      elementExists: !!el
    });
    
    this.container = el;
    this.singleHostId = hostId; // Filter to single host
    this.hosts = [hostData]; // Only this host
    
    try {
      this.renderSkeleton();
      console.log('[net-metrics] Loading metrics...');
      await this.loadMetrics();
      console.log('[net-metrics] Rendering detail view...');
      this.render();
      console.log('[net-metrics] Setting up real-time updates...');
      this.setupRealtimeUpdates();
      this.startAutoRefresh();
      console.log('[net-metrics] ✅ Detail view initialized successfully');
    } catch (err) {
      console.error('[net-metrics] ❌ Failed to initialize for host:', err);
      // Show error message in container
      this.container.innerHTML = `
        <div style="padding: 20px; color: var(--error); background: var(--surface); border-radius: 6px; border: 1px solid var(--border);">
          <strong>Error Loading Metrics:</strong> ${err.message}<br>
          <small style="color: var(--text-dim); margin-top: 8px; display: block;">Check browser console for more details.</small>
        </div>
      `;
    }
  }

  /**
   * Render skeleton/loading state.
   */
  renderSkeleton() {
    this.container.innerHTML = `
      <div class="net-metrics-dashboard">
        <div class="skeleton-header" style="height: 60px; background: var(--surface); margin-bottom: 16px; border-radius: 6px;"></div>
        <div class="skeleton-pills" style="height: 120px; background: var(--surface); margin-bottom: 16px; border-radius: 6px;"></div>
        <div class="skeleton-kpi" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 20px;">
          ${Array(6).fill().map(() => '<div style="height: 100px; background: var(--surface); border-radius: 6px;"></div>').join('')}
        </div>
        <div class="skeleton-charts" style="display: grid; gap: 20px;">
          ${Array(3).fill().map(() => '<div style="height: 300px; background: var(--surface); border-radius: 6px;"></div>').join('')}
        </div>
      </div>
    `;
  }

  /**
   * Check if we have any data to display.
   */
  hasData() {
    for (const cache of this.metricsCache.values()) {
      if (cache.network?.length > 0 || cache.system?.length > 0) {
        return true;
      }
    }
    return false;
  }

  /**
   * Load monitored hosts from main process.
   */
  async loadHosts() {
    try {
      const result = await API.invoke('netops:get-monitored-hosts', { enabled_only: true });
      this.hosts = result.hosts || [];
    } catch (err) {
      console.error('[net-metrics] Failed to load hosts:', err);
      this.showError('Failed to load hosts: ' + err.message);
    }
  }

  /**
   * Load metrics for all hosts.
   */
  async loadMetrics() {
    try {
      // Load metrics for each host in parallel
      const metricsPromises = this.hosts.map(async (host) => {
        try {
          // At 30-second intervals: 2880 = 24 hours, 576 = 4.8 hours, 288 = 2.4 hours
          const limit = 2880; // 24 hours at 30-second intervals
          
          const networkMetrics = await API.invoke('netops:get-network-metrics', {
            host_id: host.id,
            timeRange: this.timeRange,
            limit
          });
          const systemMetrics = await API.invoke('netops:get-system-metrics', {
            host_id: host.id,
            timeRange: this.timeRange,
            limit
          });
          const bufferMetrics = await API.invoke('netops:get-buffer-metrics', {
            host_id: host.id,
            timeRange: this.timeRange,
            limit
          });
          const aggregates = await API.invoke('netops:get-aggregate-metrics', {
            host_id: host.id,
            timeRange: this.timeRange
          });

          const netCount = networkMetrics.metrics?.length || 0;
          const sysCount = systemMetrics.metrics?.length || 0;
          const bufCount = bufferMetrics.metrics?.length || 0;
          
          console.log(`[net-metrics] Loaded metrics for host ${host.id}:`, {
            networkCount: netCount,
            systemCount: sysCount,
            bufferCount: bufCount,
            aggregates
          });
          
          if (netCount > 0 && networkMetrics.metrics) {
            console.log('[net-metrics] Latest network metric:', networkMetrics.metrics[networkMetrics.metrics.length - 1]);
          }

          this.metricsCache.set(host.id, {
            network: networkMetrics.metrics || [],
            system: systemMetrics.metrics || [],
            buffer: bufferMetrics.metrics || [],
            aggregates: {
              ...aggregates.network,
              ...aggregates.system,
              ...aggregates.buffer,
              avg_latency_ms: aggregates.avg_latency_ms || 0
            }
          });
        } catch (err) {
          console.error(`[net-metrics] Failed to load metrics for host ${host.id}:`, err);
          // Don't clear cache on error - preserve existing data
          // Only add empty data if this is a new host without cached data
          if (!this.metricsCache.has(host.id)) {
            this.metricsCache.set(host.id, {
              network: [],
              system: [],
              buffer: [],
              aggregates: {}
            });
          }
        }
      });

      await Promise.all(metricsPromises);
    } catch (err) {
      console.error('[net-metrics] Failed to load metrics:', err);
      this.showError('Failed to load metrics: ' + err.message);
    }
  }

  /**
   * Subscribe to real-time updates.
   */
  setupRealtimeUpdates() {
    // Status updates
    this.unsubscribeStatus = API.on('netops:status-update', (data) => {
      const { host_id, status, latency_ms, timestamp } = data;
      
      // Only update if this is for the current host (or all hosts in full mode)
      if (!this.singleHostId || this.singleHostId === host_id) {
        this.statusMap.set(host_id, { status, latency_ms, timestamp });
        if (!this.singleHostId) {
          this.updateStatusPill(host_id);
        }
        this.updateKPICards();
      }
    });

    // Metrics updates — THIS IS WHERE LIVE DATA COMES IN
    this.unsubscribeMetrics = API.on('netops:metrics-updated', async (data) => {
      console.log('[net-metrics] 🔄 METRICS UPDATED EVENT RECEIVED:', {
        hostId: data.host_id,
        timestamp: new Date().toISOString()
      });
      await this.loadMetrics();
      
      // Only refresh charts if we're still visible (container still exists)
      if (this.container && this.container.parentElement) {
        console.log('[net-metrics] ✅ Refreshing charts for updated metrics');
        this.refreshAllCharts();
        this.updateKPICards();
      } else {
        console.log('[net-metrics] ℹ️ Container not visible, skipping chart refresh');
      }
    });

    // In single-host mode, also listen for any host status changes
    if (this.singleHostId) {
      console.log(`[net-metrics] Subscribed to live updates for host ${this.singleHostId}`);
    }
  }

  /**
   * Auto-refresh metrics every 30 seconds to sync with collection cycle.
   */
  startAutoRefresh() {
    this.autoRefreshInterval = setInterval(async () => {
      await this.loadMetrics();
      // Update display with newly loaded metrics
      if (this.container && this.container.parentElement) {
        this.refreshAllCharts();
        this.updateKPICards();
      }
    }, 30 * 1000);
  }

  /**
   * Main render function.
   */
  render() {
    // In single-host mode, show simplified layout (no status pills, simpler header)
    if (this.singleHostId) {
      // Check if we have any data
      if (!this.hasData()) {
        console.log('[net-metrics] No data yet in cache, showing waiting message');
        const html = `
          <div class="net-metrics-dashboard" style="padding: 20px; text-align: center;">
            <p style="color: var(--text-dim);">
              ⏳ <strong>Metrics not yet available</strong><br>
              <small>Metrics are collected every 30 seconds. Please wait for the first collection cycle to complete, or check back shortly.</small>
            </p>
            <p style="color: var(--text-dim); font-size: 12px; margin-top: 12px;">
              The backend may not be collecting data yet. Check the browser console for errors.
            </p>
          </div>
        `;
        this.container.innerHTML = html;
        return;
      }
      
      console.log('[net-metrics] ✅ Data available, rendering detail view');
      const html = `
        <div class="net-metrics-dashboard">
          <!-- Time range selector only -->
          <div class="time-range-selector" style="margin-bottom: 16px;">
            <button class="time-btn ${this.timeRange === '6h' ? 'active' : ''}" data-range="6h">Last 6h</button>
            <button class="time-btn ${this.timeRange === '24h' ? 'active' : ''}" data-range="24h">Last 24h</button>
            <button class="time-btn ${this.timeRange === '7d' ? 'active' : ''}" data-range="7d">Last 7d</button>
            <button class="time-btn ${this.timeRange === '30d' ? 'active' : ''}" data-range="30d">Last 30d</button>
          </div>

          <!-- KPI Cards -->
          ${this.renderKPICards()}

          <!-- Charts Section -->
          <div class="metrics-section">
            ${this.renderCharts()}
          </div>
        </div>
      `;

      this.container.innerHTML = html;
      this.setupEventListeners();
      this.initializeCharts();
      return;
    }

    // Full metrics dashboard (all hosts)
    console.log('[net-metrics] Rendering full dashboard for all hosts');
    const html = `
      <div class="net-metrics-dashboard">
        <!-- Header with time range selector -->
        <div class="metrics-header">
          <h2>Metrics Dashboard</h2>
          <div class="time-range-selector">
            <button class="time-btn ${this.timeRange === '6h' ? 'active' : ''}" data-range="6h">Last 6h</button>
            <button class="time-btn ${this.timeRange === '24h' ? 'active' : ''}" data-range="24h">Last 24h</button>
            <button class="time-btn ${this.timeRange === '7d' ? 'active' : ''}" data-range="7d">Last 7d</button>
            <button class="time-btn ${this.timeRange === '30d' ? 'active' : ''}" data-range="30d">Last 30d</button>
          </div>
        </div>

        <!-- Status Pills -->
        ${this.renderStatusPills()}

        <!-- KPI Cards -->
        ${this.renderKPICards()}

        <!-- Charts Section -->
        <div class="metrics-section">
          ${this.renderCharts()}
        </div>
      </div>
    `;

    this.container.innerHTML = html;
    this.setupEventListeners();
    this.initializeCharts();
  }

  /**
   * Render status pills (horizontal scrollable).
   */
  renderStatusPills() {
    const pills = this.hosts.map((host) => {
      const status = this.statusMap.get(host.id)?.status || host.last_status || 'unknown';
      const latency = this.statusMap.get(host.id)?.latency_ms;
      const timestamp = this.statusMap.get(host.id)?.timestamp;
      const lastUpdated = timestamp ? this.formatTime(timestamp) : 'Never';

      const statusClass = `status-${status}`;
      return `
        <div class="status-pill ${statusClass}" data-host-id="${host.id}">
          <div class="pill-indicator pulse"></div>
          <div class="pill-content">
            <div class="pill-name">${escapeHtml(host.alias || host.hostname)}</div>
            <div class="pill-status">${status}</div>
            ${latency !== null && latency !== undefined ? `<div class="pill-latency">${latency}ms</div>` : ''}
          </div>
          <div class="pill-time">${lastUpdated}</div>
        </div>
      `;
    }).join('');

    return `
      <div class="status-pills-container">
        ${pills || '<p style="color: var(--text-dim);">No monitored hosts</p>'}
      </div>
    `;
  }

  /**
   * Render KPI cards with aggregated metrics.
   */
  renderKPICards() {
    const overallStats = this.calculateOverallStats();

    return `
      <div class="kpi-cards">
        <div class="kpi-card">
          <div class="kpi-label">Avg Latency</div>
          <div class="kpi-value">${overallStats.avgLatency.toFixed(0)}<span class="kpi-unit">ms</span></div>
          <div class="kpi-trend ${overallStats.latencyTrend > 0 ? 'trend-up' : 'trend-down'}">
            ${overallStats.latencyTrend > 0 ? '↑' : '↓'} ${Math.abs(overallStats.latencyTrend).toFixed(1)}%
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Avg CPU</div>
          <div class="kpi-value">${overallStats.avgCpu.toFixed(1)}<span class="kpi-unit">%</span></div>
          <div class="kpi-trend ${overallStats.cpuTrend > 0 ? 'trend-up' : 'trend-down'}">
            ${overallStats.cpuTrend > 0 ? '↑' : '↓'} ${Math.abs(overallStats.cpuTrend).toFixed(1)}%
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Avg Memory</div>
          <div class="kpi-value">${overallStats.avgMemory.toFixed(1)}<span class="kpi-unit">%</span></div>
          <div class="kpi-trend ${overallStats.memoryTrend > 0 ? 'trend-up' : 'trend-down'}">
            ${overallStats.memoryTrend > 0 ? '↑' : '↓'} ${Math.abs(overallStats.memoryTrend).toFixed(1)}%
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Total Traffic In</div>
          <div class="kpi-value">${overallStats.totalTrafficIn.toFixed(1)}<span class="kpi-unit">MB</span></div>
          <div class="kpi-trend" style="color: var(--info);">↓ Sum</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Total Traffic Out</div>
          <div class="kpi-value">${overallStats.totalTrafficOut.toFixed(1)}<span class="kpi-unit">MB</span></div>
          <div class="kpi-trend" style="color: var(--info);">↑ Sum</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Uptime</div>
          <div class="kpi-value">${overallStats.uptime.toFixed(1)}<span class="kpi-unit">%</span></div>
          <div class="kpi-trend ${overallStats.uptime >= 99 ? '' : 'trend-down'}" style="color: var(--success);">
            ${overallStats.onlineCount}/${this.hosts.length} online
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render chart containers.
   */
  renderCharts() {
    return `
      <!-- Traffic Chart -->
      <div class="chart-container">
        <h3 class="chart-title">Network Traffic (In/Out)</h3>
        <div class="chart-canvas">
          <canvas id="chart-traffic"></canvas>
        </div>
        <div class="chart-legend"></div>
      </div>

      <!-- Packets Chart -->
      <div class="chart-container">
        <h3 class="chart-title">Packets (Received/Transmitted)</h3>
        <div class="chart-canvas">
          <canvas id="chart-packets"></canvas>
        </div>
        <div class="chart-legend"></div>
      </div>

      <!-- CPU Chart -->
      <div class="chart-container">
        <h3 class="chart-title">CPU Usage (%)</h3>
        <div class="chart-canvas">
          <canvas id="chart-cpu"></canvas>
        </div>
        <div class="chart-legend"></div>
      </div>

      <!-- Memory Chart -->
      <div class="chart-container">
        <h3 class="chart-title">Memory Usage (% & MB)</h3>
        <div class="chart-canvas">
          <canvas id="chart-memory"></canvas>
        </div>
        <div class="chart-legend"></div>
      </div>

      <!-- Buffer Misses Chart -->
      <div class="chart-container">
        <h3 class="chart-title">Buffer Misses (MB)</h3>
        <div class="chart-canvas">
          <canvas id="chart-buffer-misses"></canvas>
        </div>
        <div class="chart-legend"></div>
      </div>

      <!-- Buffer Hit Rate Chart -->
      <div class="chart-container">
        <h3 class="chart-title">Buffer Hit Rate (%)</h3>
        <div class="chart-canvas">
          <canvas id="chart-buffer-rate"></canvas>
        </div>
        <div class="chart-legend"></div>
      </div>
    `;
  }

  /**
   * Initialize all charts.
   */
  initializeCharts() {
    // Import chart builders from chart-config.js
    if (typeof globalThis.createTrafficChart === 'undefined') {
      console.warn('[net-metrics] Chart builders not loaded. Ensure chart-config.js is included.');
      return;
    }

    const { createTrafficChart, createPacketsChart, createCpuChart, createMemoryChart, createBufferMissChart, generateTimeLabels } = globalThis;

    // Aggregate data from all hosts
    const aggregatedData = this.aggregateMetricsForCharts();
    
    console.log('[net-metrics] 📊 Creating charts with aggregated data:', {
      trafficLabels: aggregatedData.traffic.labels.length,
      trafficInPoints: aggregatedData.traffic.trafficIn.length,
      trafficOutPoints: aggregatedData.traffic.trafficOut.length
    });

    // Create charts
    try {
      const trafficCanvas = document.getElementById('chart-traffic');
      if (trafficCanvas) {
        this.charts.set('traffic', createTrafficChart(trafficCanvas, aggregatedData.traffic));
        console.log('[net-metrics] ✅ Traffic chart created');
      }

      const packetsCanvas = document.getElementById('chart-packets');
      if (packetsCanvas) {
        this.charts.set('packets', createPacketsChart(packetsCanvas, aggregatedData.packets));
      }

      const cpuCanvas = document.getElementById('chart-cpu');
      if (cpuCanvas) {
        this.charts.set('cpu', createCpuChart(cpuCanvas, aggregatedData.cpu));
      }

      const memoryCanvas = document.getElementById('chart-memory');
      if (memoryCanvas) {
        this.charts.set('memory', createMemoryChart(memoryCanvas, aggregatedData.memory));
      }

      const bufferMissCanvas = document.getElementById('chart-buffer-misses');
      if (bufferMissCanvas) {
        this.charts.set('bufferMiss', createBufferMissChart(bufferMissCanvas, aggregatedData.bufferMiss));
      }

      // Buffer hit rate (simple line chart)
      const bufferRateCanvas = document.getElementById('chart-buffer-rate');
      if (bufferRateCanvas && typeof globalThis.Chart !== 'undefined') {
        const Chart = globalThis.Chart;
        const ctx = bufferRateCanvas.getContext('2d');
        this.charts.set('bufferRate', new Chart(ctx, {
          type: 'line',
          data: aggregatedData.bufferRate,
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                display: true,
                labels: { color: getComputedStyle(document.documentElement).getPropertyValue('--text') }
              }
            },
            scales: {
              y: {
                max: 100,
                ticks: { callback: (v) => v + '%' }
              }
            }
          }
        }));
      }
    } catch (err) {
      console.error('[net-metrics] Failed to initialize charts:', err);
    }
  }

  /**
   * Aggregate metrics from all hosts for chart display.
   */
  aggregateMetricsForCharts() {
    const { createTrafficChart, generateTimeLabels } = globalThis;
    const allNetworkMetrics = [];
    const allSystemMetrics = [];
    const allBufferMetrics = [];

    // Collect metrics: only from current host in single-host mode, or all hosts in full dashboard
    if (this.singleHostId) {
      const cache = this.metricsCache.get(this.singleHostId);
      if (cache) {
        allNetworkMetrics.push(...(cache.network || []));
        allSystemMetrics.push(...(cache.system || []));
        allBufferMetrics.push(...(cache.buffer || []));
      }
    } else {
      this.metricsCache.forEach((cache) => {
        allNetworkMetrics.push(...(cache.network || []));
        allSystemMetrics.push(...(cache.system || []));
        allBufferMetrics.push(...(cache.buffer || []));
      });
    }

    // Sort by timestamp
    allNetworkMetrics.sort((a, b) => a.timestamp - b.timestamp);
    allSystemMetrics.sort((a, b) => a.timestamp - b.timestamp);
    allBufferMetrics.sort((a, b) => a.timestamp - b.timestamp);

    console.log('[net-metrics] Aggregating metrics for charts:', {
      networkCount: allNetworkMetrics.length,
      systemCount: allSystemMetrics.length,
      bufferCount: allBufferMetrics.length
    });

    // Aggregate by time bucket - using 30-second intervals (0.5 minutes)
    const timeLabels = generateTimeLabels(allNetworkMetrics.length, 0.5);

    // Traffic data
    const trafficIn = allNetworkMetrics.map(m => m.traffic_in_mb || 0);
    const trafficOut = allNetworkMetrics.map(m => m.traffic_out_mb || 0);

    // Packets data
    const packetsIn = allNetworkMetrics.map(m => m.packets_in || 0);
    const packetsOut = allNetworkMetrics.map(m => m.packets_out || 0);

    // CPU data
    const cpuPercent = allSystemMetrics.map(m => m.cpu_percent || 0);

    // Memory data
    const memoryPercent = allSystemMetrics.map(m => m.memory_percent || 0);
    const memoryMb = allSystemMetrics.map(m => m.memory_used_mb || 0);

    // Buffer data
    const bufferSmall = allBufferMetrics.map(m => m.small_miss_mb || 0);
    const bufferMedium = allBufferMetrics.map(m => m.medium_miss_mb || 0);
    const bufferLarge = allBufferMetrics.map(m => m.large_miss_mb || 0);
    const bufferHitRate = allBufferMetrics.map(m => m.hit_rate || 0);

    return {
      traffic: {
        labels: timeLabels,
        trafficIn,
        trafficOut
      },
      packets: {
        labels: timeLabels,
        packetsIn,
        packetsOut
      },
      cpu: {
        labels: timeLabels,
        cpu: cpuPercent
      },
      memory: {
        labels: timeLabels,
        memory: memoryPercent,
        memoryMb
      },
      bufferMiss: {
        misses: [
          bufferSmall.reduce((a, b) => a + b, 0),
          bufferMedium.reduce((a, b) => a + b, 0),
          bufferLarge.reduce((a, b) => a + b, 0)
        ]
      },
      bufferRate: {
        labels: timeLabels,
        datasets: [{
          label: 'Hit Rate %',
          data: bufferHitRate,
          borderColor: 'var(--success)',
          backgroundColor: 'rgba(74, 222, 128, 0.1)',
          tension: 0.4
        }]
      }
    };
  }

  /**
   * Calculate overall statistics for KPI cards.
   */
  calculateOverallStats() {
    let totalLatency = 0;
    let latencyCount = 0;
    let totalCpu = 0;
    let cpuCount = 0;
    let totalMemory = 0;
    let memoryCount = 0;
    let totalTrafficIn = 0;
    let totalTrafficOut = 0;
    let onlineCount = 0;

    // In single-host mode, only process that host's data
    if (this.singleHostId) {
      const cache = this.metricsCache.get(this.singleHostId);
      if (cache) {
        const agg = cache.aggregates || {};

        if (agg.avg_latency_ms !== undefined) {
          totalLatency = agg.avg_latency_ms;
          latencyCount = 1;
        }
        if (agg.avg_cpu_percent !== undefined) {
          totalCpu = agg.avg_cpu_percent;
          cpuCount = 1;
        }
        if (agg.avg_memory_percent !== undefined) {
          totalMemory = agg.avg_memory_percent;
          memoryCount = 1;
        }
        if (cache.network && cache.network.length > 0) {
          totalTrafficIn = cache.network.reduce((sum, m) => sum + (m.traffic_in_mb || 0), 0);
          totalTrafficOut = cache.network.reduce((sum, m) => sum + (m.traffic_out_mb || 0), 0);
        }

        const status = this.statusMap.get(this.singleHostId)?.status;
        if (status === 'online') onlineCount = 1;
      }
    } else {
      // Full dashboard mode: aggregate all hosts
      this.metricsCache.forEach((cache, hostId) => {
        const agg = cache.aggregates || {};

        if (agg.avg_latency_ms !== undefined) {
          totalLatency += agg.avg_latency_ms;
          latencyCount++;
        }
        if (agg.avg_cpu_percent !== undefined) {
          totalCpu += agg.avg_cpu_percent;
          cpuCount++;
        }
        if (agg.avg_memory_percent !== undefined) {
          totalMemory += agg.avg_memory_percent;
          memoryCount++;
        }
        if (cache.network && cache.network.length > 0) {
          totalTrafficIn += cache.network.reduce((sum, m) => sum + (m.traffic_in_mb || 0), 0);
          totalTrafficOut += cache.network.reduce((sum, m) => sum + (m.traffic_out_mb || 0), 0);
        }

        const status = this.statusMap.get(hostId)?.status;
        if (status === 'online') onlineCount++;
      });
    }

    const avgLatency = latencyCount > 0 ? totalLatency / latencyCount : 0;
    const avgCpu = cpuCount > 0 ? totalCpu / cpuCount : 0;
    const avgMemory = memoryCount > 0 ? totalMemory / memoryCount : 0;
    const uptime = this.hosts.length > 0 ? (onlineCount / this.hosts.length) * 100 : 0;

    // Trend calculation (simplified: compare first half to second half)
    const latencyTrend = this.calculateTrend('latency');
    const cpuTrend = this.calculateTrend('cpu');
    const memoryTrend = this.calculateTrend('memory');

    return {
      avgLatency,
      latencyTrend,
      avgCpu,
      cpuTrend,
      avgMemory,
      memoryTrend,
      totalTrafficIn,
      totalTrafficOut,
      uptime,
      onlineCount
    };
  }

  /**
   * Calculate trend by comparing first vs second half of metrics.
   */
  calculateTrend(metric) {
    let firstHalf = 0;
    let secondHalf = 0;
    let count = 0;

    this.metricsCache.forEach((cache) => {
      if (metric === 'latency') {
        const agg = cache.aggregates || {};
        if (agg.avg_latency_ms !== undefined) {
          firstHalf += agg.avg_latency_ms;
          secondHalf += agg.avg_latency_ms;
          count++;
        }
      } else if (metric === 'cpu' && cache.system && cache.system.length > 0) {
        const mid = Math.floor(cache.system.length / 2);
        const first = cache.system.slice(0, mid).reduce((sum, m) => sum + (m.cpu_percent || 0), 0) / mid || 0;
        const second = cache.system.slice(mid).reduce((sum, m) => sum + (m.cpu_percent || 0), 0) / (cache.system.length - mid) || 0;
        firstHalf += first;
        secondHalf += second;
        count++;
      } else if (metric === 'memory' && cache.system && cache.system.length > 0) {
        const mid = Math.floor(cache.system.length / 2);
        const first = cache.system.slice(0, mid).reduce((sum, m) => sum + (m.memory_percent || 0), 0) / mid || 0;
        const second = cache.system.slice(mid).reduce((sum, m) => sum + (m.memory_percent || 0), 0) / (cache.system.length - mid) || 0;
        firstHalf += first;
        secondHalf += second;
        count++;
      }
    });

    if (count === 0) return 0;
    firstHalf /= count;
    secondHalf /= count;
    return firstHalf !== 0 ? ((secondHalf - firstHalf) / firstHalf) * 100 : 0;
  }

  /**
   * Setup event listeners.
   */
  setupEventListeners() {
    // Time range selector
    document.querySelectorAll('.time-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const range = e.target.dataset.range;
        document.querySelectorAll('.time-btn').forEach((b) => b.classList.remove('active'));
        e.target.classList.add('active');

        this.timeRange = range;
        await this.loadMetrics();
        // Update display with newly loaded metrics for selected time range
        if (this.container && this.container.parentElement) {
          this.refreshAllCharts();
          this.updateKPICards();
        }
      });
    });
  }

  /**
   * Update a single status pill.
   */
  updateStatusPill(hostId) {
    const pill = document.querySelector(`[data-host-id="${hostId}"]`);
    if (!pill) return;

    const statusData = this.statusMap.get(hostId);
    const status = statusData?.status || 'unknown';
    const latency = statusData?.latency_ms;

    pill.className = `status-pill status-${status}`;
    if (latency !== null && latency !== undefined) {
      const latencyEl = pill.querySelector('.pill-latency');
      if (latencyEl) {
        latencyEl.textContent = `${latency}ms`;
      } else {
        const content = pill.querySelector('.pill-content');
        content.innerHTML += `<div class="pill-latency">${latency}ms</div>`;
      }
    }
  }

  /**
   * Update KPI cards.
   */
  updateKPICards() {
    const overallStats = this.calculateOverallStats();
    const kpiCards = document.querySelectorAll('.kpi-card');

    const updates = [
      { value: overallStats.avgLatency.toFixed(0), trend: overallStats.latencyTrend },
      { value: overallStats.avgCpu.toFixed(1), trend: overallStats.cpuTrend },
      { value: overallStats.avgMemory.toFixed(1), trend: overallStats.memoryTrend },
      { value: overallStats.totalTrafficIn.toFixed(1), trend: 0 },
      { value: overallStats.totalTrafficOut.toFixed(1), trend: 0 },
      { value: overallStats.uptime.toFixed(1), trend: 0 }
    ];

    kpiCards.forEach((card, idx) => {
      if (updates[idx]) {
        const valueEl = card.querySelector('.kpi-value');
        const trendEl = card.querySelector('.kpi-trend');
        if (valueEl) {
          const [val, unit] = valueEl.innerHTML.split('<span');
          valueEl.innerHTML = updates[idx].value + '<span' + unit;
        }
        if (trendEl && idx < 3) {
          const trend = updates[idx].trend;
          const icon = trend > 0 ? '↑' : '↓';
          const className = trend > 0 ? 'trend-up' : 'trend-down';
          trendEl.className = `kpi-trend ${className}`;
          trendEl.textContent = `${icon} ${Math.abs(trend).toFixed(1)}%`;
        }
      }
    });
  }

  /**
   * Refresh all charts.
   */
  refreshAllCharts() {
    const aggregatedData = this.aggregateMetricsForCharts();

    // Update traffic chart
    const trafficChart = this.charts.get('traffic');
    if (trafficChart) {
      trafficChart.data.labels = aggregatedData.traffic.labels;
      trafficChart.data.datasets[0].data = aggregatedData.traffic.trafficIn;
      trafficChart.data.datasets[1].data = aggregatedData.traffic.trafficOut;
      trafficChart.update();
    }

    // Update packets chart
    const packetsChart = this.charts.get('packets');
    if (packetsChart) {
      packetsChart.data.labels = aggregatedData.packets.labels;
      packetsChart.data.datasets[0].data = aggregatedData.packets.packetsIn;
      packetsChart.data.datasets[1].data = aggregatedData.packets.packetsOut;
      packetsChart.update();
    }

    // Update CPU chart
    const cpuChart = this.charts.get('cpu');
    if (cpuChart) {
      cpuChart.data.labels = aggregatedData.cpu.labels;
      cpuChart.data.datasets[0].data = aggregatedData.cpu.cpu;
      cpuChart.update();
    }

    // Update memory chart
    const memoryChart = this.charts.get('memory');
    if (memoryChart) {
      memoryChart.data.labels = aggregatedData.memory.labels;
      memoryChart.data.datasets[0].data = aggregatedData.memory.memory;
      memoryChart.data.datasets[1].data = aggregatedData.memory.memoryMb;
      memoryChart.update();
    }

    // Update buffer rate chart
    const bufferRateChart = this.charts.get('bufferRate');
    if (bufferRateChart) {
      bufferRateChart.data.labels = aggregatedData.bufferRate.labels;
      bufferRateChart.data.datasets[0].data = aggregatedData.bufferRate.datasets[0].data;
      bufferRateChart.update();
    }

    this.updateKPICards();
  }

  /**
   * Show error message.
   */
  showError(message) {
    console.error('[net-metrics]', message);
    const errorEl = document.createElement('div');
    errorEl.className = 'error-message';
    errorEl.textContent = message;
    this.container.prepend(errorEl);
    setTimeout(() => errorEl.remove(), 5000);
  }

  /**
   * Format timestamp to display time.
   */
  formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return date.toLocaleDateString();
  }

  /**
   * Cleanup on destroy.
   */
  destroy() {
    if (this.unsubscribeStatus) this.unsubscribeStatus();
    if (this.unsubscribeMetrics) this.unsubscribeMetrics();
    if (this.autoRefreshInterval) clearInterval(this.autoRefreshInterval);
    if (this.chartRefreshInterval) clearInterval(this.chartRefreshInterval);

    // Destroy Chart.js instances
    this.charts.forEach((chart) => {
      if (chart.destroy) chart.destroy();
    });
  }
}

/**
 * HTML escape utility.
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Export for module system
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NetMetricsDashboard;
}

// Note: This class is integrated into the main NetOps Monitor tab
// via net-dashboard.js. No separate tab registration needed.
