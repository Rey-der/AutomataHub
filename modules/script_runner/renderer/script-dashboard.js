/**
 * Script Runner — Execution Dashboard
 * Renders execution statistics: total runs, success rate, avg duration per script.
 * Uses Chart.js (same pattern as NetOps chart-config.js) for bar/line charts.
 * Filters by date range and script name.
 */

(function () {
  'use strict';

  // --- Theme-aware colors (mirrors NetOps getThemeColors) ---

  function _getColors() {
    const s = getComputedStyle(document.documentElement);
    return {
      text:    s.getPropertyValue('--text').trim()    || '#d4d4d4',
      textDim: s.getPropertyValue('--muted').trim()   || '#858585',
      border:  s.getPropertyValue('--border').trim()   || '#3e3e42',
      surface: s.getPropertyValue('--surface').trim()  || '#252526',
      success: s.getPropertyValue('--success').trim()  || '#4ec9b0',
      error:   s.getPropertyValue('--error').trim()    || '#f48771',
      warning: s.getPropertyValue('--warning').trim()  || '#dcdcaa',
      accent:  s.getPropertyValue('--accent').trim()   || '#007acc',
      info:    s.getPropertyValue('--info').trim()     || '#9cdcfe',
    };
  }

  function _hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m
      ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}`
      : '200, 200, 200';
  }

  // --- Helpers ---

  function _esc(text) {
    const d = document.createElement('div');
    d.textContent = String(text ?? '');
    return d.innerHTML;
  }

  function _fmtDuration(ms) {
    if (ms == null || Number.isNaN(ms)) return '—';
    const sec = ms / 1000;
    if (sec < 60) return `${sec.toFixed(1)}s`;
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(0);
    return `${m}m ${s}s`;
  }

  function _fmtDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  }

  function _dayKey(iso) {
    return iso.slice(0, 10); // YYYY-MM-DD
  }

  // --- Data aggregation ---

  function _aggregate(history, filterName, dateFrom, dateTo) {
    let entries = history;

    if (filterName) {
      const q = filterName.toLowerCase();
      entries = entries.filter((e) => (e.scriptName || '').toLowerCase().includes(q));
    }
    if (dateFrom) {
      entries = entries.filter((e) => e.timestamp >= dateFrom);
    }
    if (dateTo) {
      // dateTo is a date string like "2025-01-15", include the full day
      entries = entries.filter((e) => e.timestamp.slice(0, 10) <= dateTo);
    }

    const totalRuns = entries.length;
    const successes = entries.filter((e) => e.status === 'success').length;
    const failures  = entries.filter((e) => e.status === 'error').length;
    const successRate = totalRuns > 0 ? ((successes / totalRuns) * 100).toFixed(1) : '—';

    const durations = entries.filter((e) => e.runtime != null).map((e) => e.runtime);
    const avgDuration = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : null;

    // Per-script breakdown
    const byScript = new Map();
    for (const e of entries) {
      const name = e.scriptName || 'Unknown';
      if (!byScript.has(name)) {
        byScript.set(name, { runs: 0, successes: 0, failures: 0, totalDuration: 0, durCount: 0 });
      }
      const s = byScript.get(name);
      s.runs++;
      if (e.status === 'success') s.successes++;
      if (e.status === 'error') s.failures++;
      if (e.runtime != null) { s.totalDuration += e.runtime; s.durCount++; }
    }

    // Daily timeline
    const byDay = new Map();
    for (const e of entries) {
      const day = _dayKey(e.timestamp);
      if (!byDay.has(day)) byDay.set(day, { successes: 0, failures: 0 });
      const d = byDay.get(day);
      if (e.status === 'success') d.successes++;
      if (e.status === 'error') d.failures++;
    }

    // Sort days chronologically
    const sortedDays = [...byDay.keys()].sort();

    return {
      totalRuns,
      successes,
      failures,
      successRate,
      avgDuration,
      byScript,
      timeline: { days: sortedDays, data: byDay },
      filtered: entries,
    };
  }

  // --- Dashboard class ---

  class ScriptDashboard {
    constructor(app) {
      this.app = app;
      this.container = null;
      this.filterName = '';
      this.dateFrom = '';
      this.dateTo = '';
      this._chart = null;
    }

    init(container) {
      this.container = container;
      this.render();
    }

    render() {
      if (!this.container) return;
      this._destroyChart();

      const stats = _aggregate(
        this.app.executionHistory,
        this.filterName,
        this.dateFrom,
        this.dateTo,
      );

      this.container.innerHTML = `
        <div class="sr-dashboard">
          <div class="sr-dash-header">
            <h2 class="sr-dash-title">Execution Dashboard</h2>
            <button class="btn btn-secondary btn-sm sr-dash-back" id="sr-dash-back">&#8592; Scripts</button>
          </div>

          <div class="sr-dash-filters">
            <input type="text" class="sr-dash-filter-input" id="sr-dash-filter-name"
              placeholder="Filter by script name…" value="${_esc(this.filterName)}" />
            <label class="sr-dash-date-label">From
              <input type="date" class="sr-dash-date" id="sr-dash-date-from" value="${_esc(this.dateFrom)}" />
            </label>
            <label class="sr-dash-date-label">To
              <input type="date" class="sr-dash-date" id="sr-dash-date-to" value="${_esc(this.dateTo)}" />
            </label>
            <button class="btn btn-sm btn-secondary" id="sr-dash-reset">Reset</button>
          </div>

          <div class="sr-dash-kpis">
            <div class="sr-kpi-card">
              <span class="sr-kpi-value">${stats.totalRuns}</span>
              <span class="sr-kpi-label">Total Runs</span>
            </div>
            <div class="sr-kpi-card sr-kpi-success">
              <span class="sr-kpi-value">${stats.successRate}${stats.successRate !== '—' ? '%' : ''}</span>
              <span class="sr-kpi-label">Success Rate</span>
            </div>
            <div class="sr-kpi-card">
              <span class="sr-kpi-value">${_fmtDuration(stats.avgDuration)}</span>
              <span class="sr-kpi-label">Avg Duration</span>
            </div>
            <div class="sr-kpi-card sr-kpi-fail">
              <span class="sr-kpi-value">${stats.failures}</span>
              <span class="sr-kpi-label">Failures</span>
            </div>
          </div>

          ${this._renderChart(stats)}
          ${this._renderTable(stats)}
        </div>
      `;

      this._bindEvents();
      this._initChart(stats);
    }

    // --- Sub-renders ---

    _renderChart(stats) {
      if (stats.timeline.days.length === 0) {
        return '<div class="sr-dash-empty-chart">No execution data to chart</div>';
      }
      return `
        <div class="sr-dash-chart-wrap">
          <h3 class="sr-dash-section-title">Runs Over Time</h3>
          <div class="sr-dash-chart-container">
            <canvas id="sr-dash-chart"></canvas>
          </div>
        </div>
      `;
    }

    _renderTable(stats) {
      if (stats.byScript.size === 0) {
        return `
          <div class="sr-dash-empty">
            <p>No executions recorded yet.</p>
            <small>Run a script and come back to see stats here.</small>
          </div>
        `;
      }

      const rows = [...stats.byScript.entries()]
        .sort((a, b) => b[1].runs - a[1].runs)
        .map(([name, s]) => {
          const rate = s.runs > 0 ? ((s.successes / s.runs) * 100).toFixed(0) : '—';
          const avg = s.durCount > 0 ? _fmtDuration(s.totalDuration / s.durCount) : '—';
          return `
            <tr>
              <td class="sr-table-name">${_esc(name)}</td>
              <td class="sr-table-num">${s.runs}</td>
              <td class="sr-table-num sr-table-success">${s.successes}</td>
              <td class="sr-table-num sr-table-fail">${s.failures}</td>
              <td class="sr-table-num">${rate}${rate !== '—' ? '%' : ''}</td>
              <td class="sr-table-num">${avg}</td>
            </tr>
          `;
        })
        .join('');

      return `
        <div class="sr-dash-table-wrap">
          <h3 class="sr-dash-section-title">Per-Script Breakdown</h3>
          <table class="sr-dash-table">
            <thead>
              <tr>
                <th>Script</th>
                <th>Runs</th>
                <th>Pass</th>
                <th>Fail</th>
                <th>Rate</th>
                <th>Avg Duration</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
    }

    // --- Chart.js integration (bar chart) ---

    _initChart(stats) {
      const canvas = this.container?.querySelector('#sr-dash-chart');
      if (!canvas) return;

      const Chart = globalThis.Chart;
      if (!Chart) {
        console.warn('[script-dashboard] Chart.js not available');
        return;
      }

      const colors = _getColors();
      const { days, data } = stats.timeline;
      const labels = days.map((d) => _fmtDate(d));
      const successData = days.map((d) => data.get(d)?.successes || 0);
      const failData = days.map((d) => data.get(d)?.failures || 0);

      this._chart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Success',
              data: successData,
              backgroundColor: `rgba(${_hexToRgb(colors.success)}, 0.7)`,
              borderColor: colors.success,
              borderWidth: 1,
              borderRadius: 3,
            },
            {
              label: 'Failed',
              data: failData,
              backgroundColor: `rgba(${_hexToRgb(colors.error)}, 0.7)`,
              borderColor: colors.error,
              borderWidth: 1,
              borderRadius: 3,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: colors.text, usePointStyle: true, padding: 16 },
            },
            tooltip: {
              backgroundColor: colors.surface,
              titleColor: colors.text,
              bodyColor: colors.text,
              borderColor: colors.border,
              borderWidth: 1,
            },
          },
          scales: {
            y: {
              beginAtZero: true,
              stacked: true,
              ticks: { color: colors.textDim, stepSize: 1 },
              grid: { color: `rgba(${_hexToRgb(colors.border)}, 0.3)` },
            },
            x: {
              stacked: true,
              ticks: { color: colors.textDim },
              grid: { color: `rgba(${_hexToRgb(colors.border)}, 0.3)` },
            },
          },
        },
      });
    }

    _destroyChart() {
      if (this._chart) {
        this._chart.destroy();
        this._chart = null;
      }
    }

    // --- Events ---

    _bindEvents() {
      const backBtn = this.container.querySelector('#sr-dash-back');
      if (backBtn) {
        backBtn.addEventListener('click', () => this.app.navigateToBrowser());
      }

      const nameInput = this.container.querySelector('#sr-dash-filter-name');
      if (nameInput) {
        nameInput.addEventListener('input', (e) => {
          this.filterName = e.target.value;
          this.render();
        });
      }

      const fromInput = this.container.querySelector('#sr-dash-date-from');
      if (fromInput) {
        fromInput.addEventListener('change', (e) => {
          this.dateFrom = e.target.value;
          this.render();
        });
      }

      const toInput = this.container.querySelector('#sr-dash-date-to');
      if (toInput) {
        toInput.addEventListener('change', (e) => {
          this.dateTo = e.target.value;
          this.render();
        });
      }

      const resetBtn = this.container.querySelector('#sr-dash-reset');
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          this.filterName = '';
          this.dateFrom = '';
          this.dateTo = '';
          this.render();
        });
      }
    }

    destroy() {
      this._destroyChart();
    }
  }

  // Expose globally so script-app.js can reference it
  globalThis.ScriptDashboard = ScriptDashboard;
})();
