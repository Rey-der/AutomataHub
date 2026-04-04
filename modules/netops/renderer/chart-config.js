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
  globalThis.createCpuChart = createCpuChart;
  globalThis.createMemoryChart = createMemoryChart;
  globalThis.hexToRgb = hexToRgb;
  globalThis.generateTimeLabels = generateTimeLabels;
}

// Export for Node.js module system
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getThemeColors,
    createCpuChart,
    createMemoryChart,
    hexToRgb,
    generateTimeLabels
  };
}
