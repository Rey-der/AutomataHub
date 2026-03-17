/**
 * NetOps Charts Configuration — Reusable chart templates and utilities.
 * 
 * Provides pre-configured Chart.js instances with theme-aware colors and responsive sizing.
 */

/**
 * Get theme-aware colors using CSS variables.
 */
function getThemeColors() {
  const root = document.documentElement;
  const computed = getComputedStyle(root);

  return {
    text: computed.getPropertyValue('--text').trim() || '#e0e0e0',
    textDim: computed.getPropertyValue('--text-dim').trim() || '#a0a0a0',
    border: computed.getPropertyValue('--border').trim() || '#3a3a3a',
    surface: computed.getPropertyValue('--surface').trim() || '#1a1a1a',
    surfaceHover: computed.getPropertyValue('--surface-hover').trim() || '#2a2a2a',
    success: computed.getPropertyValue('--success').trim() || '#4ade80',
    error: computed.getPropertyValue('--error').trim() || '#ff6b6b',
    warning: computed.getPropertyValue('--warning').trim() || '#fbbf24',
    info: computed.getPropertyValue('--info').trim() || '#60a5fa',
    accent: computed.getPropertyValue('--accent').trim() || '#2dd4bf'
  };
}

/**
 * Create a traffic line chart (In/Out bandwidth).
 */
function createTrafficChart(canvasElement, data = {}) {
  const colors = getThemeColors();
  
  const ctx = canvasElement.getContext('2d');
  const Chart = globalThis.Chart;
  
  if (!Chart) {
    console.error('[charts] Chart.js not loaded');
    return null;
  }

  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.labels || [],
      datasets: [
        {
          label: 'Traffic In (MB/s)',
          data: data.trafficIn || [],
          borderColor: colors.info,
          backgroundColor: `rgba(${hexToRgb(colors.info)}, 0.05)`,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 6,
          fill: true
        },
        {
          label: 'Traffic Out (MB/s)',
          data: data.trafficOut || [],
          borderColor: 'rgb(251, 146, 60)',
          backgroundColor: 'rgba(251, 146, 60, 0.05)',
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { color: colors.text, usePointStyle: true } },
        tooltip: { 
          mode: 'index',
          intersect: false,
          backgroundColor: colors.surface,
          titleColor: colors.text,
          bodyColor: colors.text,
          borderColor: colors.border,
          borderWidth: 1
        }
      },
      scales: {
        y: { 
          min: 0,
          grace: '10%',
          ticks: { color: colors.textDim },
          grid: { color: `rgba(${hexToRgb(colors.border)}, 0.3)` }
        },
        x: {
          ticks: { color: colors.textDim },
          grid: { color: `rgba(${hexToRgb(colors.border)}, 0.3)` }
        }
      }
    }
  });
}

/**
 * Create packets area chart.
 */
function createPacketsChart(canvasElement, data = {}) {
  const colors = getThemeColors();
  const ctx = canvasElement.getContext('2d');
  const Chart = globalThis.Chart;
  
  if (!Chart) return null;

  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.labels || [],
      datasets: [
        {
          label: 'Received Packets',
          data: data.packetsIn || [],
          borderColor: colors.success,
          backgroundColor: `rgba(${hexToRgb(colors.success)}, 0.2)`,
          tension: 0.4,
          borderWidth: 2,
          fill: true
        },
        {
          label: 'Transmitted Packets',
          data: data.packetsOut || [],
          borderColor: 'rgb(34, 197, 94)',
          backgroundColor: 'rgba(34, 197, 94, 0.2)',
          tension: 0.4,
          borderWidth: 2,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { color: colors.text, usePointStyle: true } },
        tooltip: { 
          mode: 'index',
          backgroundColor: colors.surface,
          titleColor: colors.text,
          bodyColor: colors.text,
          borderColor: colors.border,
          borderWidth: 1
        }
      },
      scales: {
        y: { 
          min: 0,
          grace: '10%',
          ticks: { color: colors.textDim },
          grid: { color: `rgba(${hexToRgb(colors.border)}, 0.3)` }
        },
        x: {
          ticks: { color: colors.textDim },
          grid: { color: `rgba(${hexToRgb(colors.border)}, 0.3)` }
        }
      }
    }
  });
}

/**
 * Create CPU usage area chart.
 */
function createCpuChart(canvasElement, data = {}) {
  const colors = getThemeColors();
  const ctx = canvasElement.getContext('2d');
  const Chart = globalThis.Chart;
  
  if (!Chart) return null;

  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.labels || [],
      datasets: [
        {
          label: 'CPU Usage (%)',
          data: data.cpu || [],
          borderColor: colors.accent,
          backgroundColor: `rgba(${hexToRgb(colors.accent)}, 0.2)`,
          tension: 0.4,
          borderWidth: 2,
          fill: true,
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { position: 'bottom', labels: { color: colors.text } },
        tooltip: { 
          backgroundColor: colors.surface,
          titleColor: colors.text,
          bodyColor: colors.text,
          borderColor: colors.border,
          borderWidth: 1
        }
      },
      scales: {
        y: { 
          min: 0,
          max: 100,
          ticks: { color: colors.textDim },
          grid: { color: `rgba(${hexToRgb(colors.border)}, 0.3)` }
        },
        x: {
          ticks: { color: colors.textDim },
          grid: { color: `rgba(${hexToRgb(colors.border)}, 0.3)` }
        }
      }
    }
  });
}

/**
 * Create memory utilization area chart.
 */
function createMemoryChart(canvasElement, data = {}) {
  const colors = getThemeColors();
  const ctx = canvasElement.getContext('2d');
  const Chart = globalThis.Chart;
  
  if (!Chart) return null;

  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.labels || [],
      datasets: [
        {
          label: 'Memory Usage (%)',
          data: data.memory || [],
          borderColor: '#06b6d4',
          backgroundColor: 'rgba(6, 182, 212, 0.2)',
          tension: 0.4,
          borderWidth: 2,
          fill: true,
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { position: 'bottom', labels: { color: colors.text } },
        tooltip: { 
          backgroundColor: colors.surface,
          titleColor: colors.text,
          bodyColor: colors.text,
          borderColor: colors.border,
          borderWidth: 1,
          callbacks: {
            afterLabel: function(context) {
              if (data.memoryMb?.[context.dataIndex]) {
                return `${data.memoryMb[context.dataIndex]} MB`;
              }
              return '';
            }
          }
        }
      },
      scales: {
        y: { 
          min: 0,
          max: 100,
          ticks: { color: colors.textDim },
          grid: { color: `rgba(${hexToRgb(colors.border)}, 0.3)` }
        },
        x: {
          ticks: { color: colors.textDim },
          grid: { color: `rgba(${hexToRgb(colors.border)}, 0.3)` }
        }
      }
    }
  });
}

/**
 * Create buffer miss distribution bar chart.
 */
function createBufferMissChart(canvasElement, data = {}) {
  const colors = getThemeColors();
  const ctx = canvasElement.getContext('2d');
  const Chart = globalThis.Chart;
  
  if (!Chart) return null;

  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Small', 'Medium', 'Large'],
      datasets: [
        {
          label: 'Buffer Misses (MB)',
          data: data.misses || [0, 0, 0],
          backgroundColor: [
            'rgb(248, 113, 113)',
            'rgb(251, 146, 60)',
            'rgb(251, 191, 36)'
          ],
          borderColor: colors.border,
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      indexAxis: 'x',
      plugins: {
        legend: { position: 'bottom', labels: { color: colors.text } },
        tooltip: { 
          backgroundColor: colors.surface,
          titleColor: colors.text,
          bodyColor: colors.text,
          borderColor: colors.border,
          borderWidth: 1
        }
      },
      scales: {
        y: {
          min: 0,
          ticks: { color: colors.textDim },
          grid: { color: `rgba(${hexToRgb(colors.border)}, 0.3)` }
        },
        x: {
          ticks: { color: colors.textDim },
          grid: { display: false }
        }
      }
    }
  });
}

/**
 * Helper to convert hex color to RGB string.
 */
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `${Number.parseInt(result[1], 16)}, ${Number.parseInt(result[2], 16)}, ${Number.parseInt(result[3], 16)}` : '200, 200, 200';
}

/**
 * Generate time labels for charts (HH:MM format).
 */
function generateTimeLabels(count = 24, intervalMinutes = 5) {
  const labels = [];
  const now = new Date();
  
  for (let i = count - 1; i >= 0; i--) {
    const time = new Date(now.getTime() - i * intervalMinutes * 60 * 1000);
    const hours = time.getHours().toString().padStart(2, '0');
    const mins = time.getMinutes().toString().padStart(2, '0');
    labels.push(`${hours}:${mins}`);
  }
  
  return labels;
}

// Export for browser (globalThis)
if (typeof globalThis !== 'undefined') {
  globalThis.getThemeColors = getThemeColors;
  globalThis.createTrafficChart = createTrafficChart;
  globalThis.createPacketsChart = createPacketsChart;
  globalThis.createCpuChart = createCpuChart;
  globalThis.createMemoryChart = createMemoryChart;
  globalThis.createBufferMissChart = createBufferMissChart;
  globalThis.hexToRgb = hexToRgb;
  globalThis.generateTimeLabels = generateTimeLabels;
}

// Export for Node.js module system
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getThemeColors,
    createTrafficChart,
    createPacketsChart,
    createCpuChart,
    createMemoryChart,
    createBufferMissChart,
    hexToRgb,
    generateTimeLabels
  };
}
