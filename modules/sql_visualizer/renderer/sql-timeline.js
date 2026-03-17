/**
 * SQL Visualizer — Execution Timeline tab renderer.
 * Gantt-style horizontal bar chart showing script execution windows,
 * with overlap detection, status coloring, and drill-down on click.
 * Registers the "sql-timeline" tab type with TabManager.
 */

const SqlTimeline = (() => {
  const tabStates = new Map();

  // --- Time Range helpers ---

  const TIME_RANGES = [
    { id: 'hour',  label: 'Last hour' },
    { id: 'today', label: 'Today' },
    { id: 'week',  label: 'This week' },
    { id: 'month', label: 'This month' },
    { id: 'all',   label: 'All time' },
  ];

  // --- Render ---

  async function render(tab, container) {
    if (!container) return;
    container.innerHTML = '';

    const state = {
      timeRange: 'week',
      data: [],
      detailPanel: null,
      // Zoom/pan state (null = fit-all, otherwise absolute ms bounds)
      viewStart: null,
      viewEnd: null,
      _dragOrigin: null,  // { x, viewStart, viewEnd } while dragging
    };
    tabStates.set(tab.id, state);

    const wrapper = document.createElement('div');
    wrapper.className = 'sql-timeline-tab';

    // Header
    const header = document.createElement('div');
    header.className = 'sql-tl-header';

    const h2 = document.createElement('h2');
    h2.textContent = 'Execution Timeline';
    header.appendChild(h2);

    const rangeBar = document.createElement('div');
    rangeBar.className = 'sql-tl-range-bar';
    for (const r of TIME_RANGES) {
      const btn = document.createElement('button');
      btn.className = `btn btn-sm sql-tl-range-btn${r.id === state.timeRange ? ' active' : ''}`;
      btn.textContent = r.label;
      btn.dataset.range = r.id;
      btn.addEventListener('click', () => {
        state.timeRange = r.id;
        state.viewStart = null;
        state.viewEnd = null;
        rangeBar.querySelectorAll('.sql-tl-range-btn').forEach((b) => b.classList.toggle('active', b.dataset.range === r.id));
        refreshTimeline(wrapper, state);
      });
      rangeBar.appendChild(btn);
    }

    // Zoom controls
    const zoomIn = document.createElement('button');
    zoomIn.className = 'btn btn-sm sql-tl-zoom-btn';
    zoomIn.textContent = 'Zoom +';
    zoomIn.title = 'Zoom in';
    zoomIn.addEventListener('click', () => applyZoom(wrapper, state, 0.5));
    rangeBar.appendChild(zoomIn);

    const zoomOut = document.createElement('button');
    zoomOut.className = 'btn btn-sm sql-tl-zoom-btn';
    zoomOut.textContent = 'Zoom −';
    zoomOut.title = 'Zoom out';
    zoomOut.addEventListener('click', () => applyZoom(wrapper, state, 2));
    rangeBar.appendChild(zoomOut);

    const resetView = document.createElement('button');
    resetView.className = 'btn btn-sm sql-tl-zoom-btn';
    resetView.textContent = 'Fit All';
    resetView.title = 'Reset zoom to fit all';
    resetView.addEventListener('click', () => {
      state.viewStart = null;
      state.viewEnd = null;
      refreshTimeline(wrapper, state);
    });
    rangeBar.appendChild(resetView);

    header.appendChild(rangeBar);
    wrapper.appendChild(header);

    // Gantt area
    const ganttArea = document.createElement('div');
    ganttArea.className = 'sql-tl-gantt-area';
    wrapper.appendChild(ganttArea);

    // Detail panel (hidden initially)
    const detail = document.createElement('div');
    detail.className = 'sql-tl-detail hidden';
    wrapper.appendChild(detail);
    state.detailPanel = detail;

    container.appendChild(wrapper);
    await refreshTimeline(wrapper, state);
  }

  // --- Refresh ---

  function _buildScriptRow(script, data, minTime, maxTime, span, overlaps, state) {
    const row = document.createElement('div');
    row.className = 'sql-tl-row';

    const label = document.createElement('div');
    label.className = 'sql-tl-label';
    label.textContent = script;
    row.appendChild(label);

    const track = document.createElement('div');
    track.className = 'sql-tl-track';

    for (const exec of data.filter((d) => d.script === script)) {
      const startMs = new Date(exec.start_time).getTime();
      const endMs = exec.end_time ? new Date(exec.end_time).getTime() : Date.now();
      const leftPct = ((startMs - minTime) / span) * 100;
      const widthPct = Math.max(0.3, ((endMs - startMs) / span) * 100);

      const bar = document.createElement('div');
      bar.className = `sql-tl-bar sql-tl-bar--${(exec.status || 'running').toLowerCase()}`;
      bar.style.left = `${leftPct}%`;
      bar.style.width = `${widthPct}%`;
      if (overlaps.has(exec.id)) bar.classList.add('sql-tl-bar--overlap');

      const dur = exec.durationMs != null ? formatDuration(exec.durationMs) : 'running…';
      bar.title = `${exec.script}\n${exec.start_time} → ${exec.end_time || '(running)'}\nDuration: ${dur}\nStatus: ${exec.status || 'RUNNING'}`;
      bar.addEventListener('click', () => showDetail(state, exec));
      track.appendChild(bar);
    }

    row.appendChild(track);
    return row;
  }

  function _attachGanttPanZoom(ganttArea, wrapper, state, minTime, maxTime) {
    ganttArea.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.3 : 0.7;
      applyZoom(wrapper, state, factor, ganttArea, e);
    }, { passive: false });

    ganttArea.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        const vStart = state.viewStart ?? minTime;
        const vEnd = state.viewEnd ?? maxTime;
        state._dragOrigin = { x: e.clientX, viewStart: vStart, viewEnd: vEnd };
        ganttArea.style.cursor = 'grabbing';
      }
    });

    ganttArea.addEventListener('mousemove', (e) => {
      if (state._dragOrigin) {
        const dx = e.clientX - state._dragOrigin.x;
        const trackWidth = ganttArea.querySelector('.sql-tl-track')?.offsetWidth || ganttArea.offsetWidth;
        const vSpan = state._dragOrigin.viewEnd - state._dragOrigin.viewStart;
        const timeDelta = -(dx / trackWidth) * vSpan;
        state.viewStart = state._dragOrigin.viewStart + timeDelta;
        state.viewEnd = state._dragOrigin.viewEnd + timeDelta;
        refreshTimeline(wrapper, state);
      }
    });

    const clearDrag = () => { state._dragOrigin = null; ganttArea.style.cursor = ''; };
    ganttArea.addEventListener('mouseup', clearDrag);
    ganttArea.addEventListener('mouseleave', clearDrag);
  }

  async function refreshTimeline(wrapper, state) {
    const ganttArea = wrapper.querySelector('.sql-tl-gantt-area');
    ganttArea.innerHTML = '';

    let data = [];
    try {
      data = await globalThis.api.invoke('sql-visualizer:get-execution-timeline', { timeRange: state.timeRange });
    } catch (err) {
      ganttArea.innerHTML = `<div class="sql-tl-error">Failed to load timeline: ${err.message}</div>`;
      return;
    }

    state.data = data;

    if (data.length === 0) {
      ganttArea.innerHTML = '<div class="sql-tl-empty">No executions found for this time range.</div>';
      return;
    }

    const starts = data.map((d) => new Date(d.start_time).getTime());
    const ends = data.map((d) => d.end_time ? new Date(d.end_time).getTime() : Date.now());
    const dataMin = Math.min(...starts);
    const dataMax = Math.max(...ends);

    const minTime = state.viewStart ?? dataMin;
    const maxTime = state.viewEnd ?? dataMax;
    const span = maxTime - minTime || 1;

    const scripts = [...new Set(data.map((d) => d.script))].sort((a, b) => a.localeCompare(b));
    const overlaps = detectOverlaps(data);

    ganttArea.appendChild(buildTimeAxis(minTime, maxTime));
    for (const script of scripts) {
      ganttArea.appendChild(_buildScriptRow(script, data, minTime, maxTime, span, overlaps, state));
    }

    _attachGanttPanZoom(ganttArea, wrapper, state, minTime, maxTime);
  }

  // --- Zoom helper ---

  function applyZoom(wrapper, state, factor, ganttArea, mouseEvent) {
    const data = state.data;
    if (data.length === 0) return;

    const starts = data.map((d) => new Date(d.start_time).getTime());
    const ends = data.map((d) => d.end_time ? new Date(d.end_time).getTime() : Date.now());
    const dataMin = Math.min(...starts);
    const dataMax = Math.max(...ends);

    const curStart = state.viewStart ?? dataMin;
    const curEnd = state.viewEnd ?? dataMax;
    const curSpan = curEnd - curStart;

    // Find zoom anchor (mouse position or center)
    let anchor = 0.5;
    if (ganttArea && mouseEvent) {
      const track = ganttArea.querySelector('.sql-tl-track');
      if (track) {
        const rect = track.getBoundingClientRect();
        anchor = Math.max(0, Math.min(1, (mouseEvent.clientX - rect.left) / rect.width));
      }
    }

    const newSpan = curSpan * factor;
    // Minimum zoom: 5 seconds; maximum zoom: 3x full data range
    const fullSpan = dataMax - dataMin || 1;
    if (newSpan < 5000 || newSpan > fullSpan * 3) return;

    state.viewStart = curStart + (curSpan - newSpan) * anchor;
    state.viewEnd = state.viewStart + newSpan;
    refreshTimeline(wrapper, state);
  }

  // --- Time axis ---

  function buildTimeAxis(minTime, maxTime) {
    const axis = document.createElement('div');
    axis.className = 'sql-tl-axis';

    const labelArea = document.createElement('div');
    labelArea.className = 'sql-tl-label';
    labelArea.textContent = '';
    axis.appendChild(labelArea);

    const tickTrack = document.createElement('div');
    tickTrack.className = 'sql-tl-tick-track';

    const span = maxTime - minTime || 1;
    const TICK_COUNT = 6;
    for (let i = 0; i <= TICK_COUNT; i++) {
      const t = minTime + (span * i) / TICK_COUNT;
      const tick = document.createElement('span');
      tick.className = 'sql-tl-tick';
      tick.style.left = `${(i / TICK_COUNT) * 100}%`;
      tick.textContent = formatTimeLabel(new Date(t));
      tickTrack.appendChild(tick);
    }

    axis.appendChild(tickTrack);
    return axis;
  }

  // --- Overlap detection ---

  function detectOverlaps(data) {
    const overlaps = new Set();
    const sorted = [...data].sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

    for (let i = 0; i < sorted.length; i++) {
      const endI = sorted[i].end_time ? new Date(sorted[i].end_time).getTime() : Date.now();
      for (let j = i + 1; j < sorted.length; j++) {
        const startJ = new Date(sorted[j].start_time).getTime();
        if (startJ >= endI) break;
        overlaps.add(sorted[i].id);
        overlaps.add(sorted[j].id);
      }
    }

    return overlaps;
  }

  // --- Detail panel ---

  function _appendCorrLogs(panel, logs) {
    if (!logs || logs.length === 0) return;
    const section = document.createElement('div');
    section.className = 'sql-tl-detail-section';
    const h4 = document.createElement('h4');
    h4.textContent = `Logs (${logs.length})`;
    section.appendChild(h4);
    const list = document.createElement('div');
    list.className = 'sql-tl-log-list';
    for (const log of logs) {
      const item = document.createElement('div');
      item.className = `sql-tl-log-item sql-tl-log-item--${log.status.toLowerCase()}`;
      item.innerHTML = `
        <span class="sql-tl-log-time">${escHtml(log.timestamp)}</span>
        <span class="sql-badge sql-badge--${log.status.toLowerCase()}">${log.status}</span>
        <span class="sql-tl-log-msg">${escHtml(log.message)}</span>
      `;
      list.appendChild(item);
    }
    section.appendChild(list);
    panel.appendChild(section);
  }

  function _appendCorrErrors(panel, errors) {
    if (!errors || errors.length === 0) return;
    const section = document.createElement('div');
    section.className = 'sql-tl-detail-section';
    const h4 = document.createElement('h4');
    h4.textContent = `Errors (${errors.length})`;
    section.appendChild(h4);
    for (const err of errors) {
      const item = document.createElement('div');
      item.className = 'sql-tl-error-item';
      item.innerHTML = `
        <div class="sql-tl-error-header">
          <span class="sql-tl-log-time">${escHtml(err.timestamp)}</span>
          <span>${escHtml(err.message)}</span>
        </div>
      `;
      if (err.stack_trace) {
        const stack = document.createElement('pre');
        stack.className = 'sql-tl-stack';
        stack.textContent = err.stack_trace;
        item.appendChild(stack);
      }
      section.appendChild(item);
    }
    panel.appendChild(section);
  }

  async function showDetail(state, exec) {
    const panel = state.detailPanel;
    panel.classList.remove('hidden');
    panel.innerHTML = '<div class="sql-tl-detail-loading">Loading correlated records…</div>';

    let corr;
    try {
      corr = await globalThis.api.invoke('sql-visualizer:get-correlated-records', { executionId: exec.id });
    } catch (err) {
      panel.innerHTML = `<div class="sql-tl-error">Failed to load details: ${err.message}</div>`;
      return;
    }

    panel.innerHTML = '';

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn-sm sql-tl-detail-close';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => panel.classList.add('hidden'));
    panel.appendChild(closeBtn);

    // Execution info
    const info = document.createElement('div');
    info.className = 'sql-tl-detail-info';
    const dur = exec.durationMs != null ? formatDuration(exec.durationMs) : 'running…';
    info.innerHTML = `
      <h3>${escHtml(exec.script)} — Execution #${exec.id}</h3>
      <div class="sql-tl-detail-meta">
        <span>Start: ${escHtml(exec.start_time)}</span>
        <span>End: ${escHtml(exec.end_time || '(running)')}</span>
        <span>Duration: ${dur}</span>
        <span class="sql-badge sql-badge--${(exec.status || 'running').toLowerCase()}">${exec.status || 'RUNNING'}</span>
      </div>
    `;
    if (exec.error_message) {
      const errBox = document.createElement('div');
      errBox.className = 'sql-error-box';
      errBox.textContent = exec.error_message;
      info.appendChild(errBox);
    }
    panel.appendChild(info);

    _appendCorrLogs(panel, corr.logs);
    _appendCorrErrors(panel, corr.errors);

    if ((!corr.logs || corr.logs.length === 0) && (!corr.errors || corr.errors.length === 0)) {
      const empty = document.createElement('p');
      empty.className = 'sql-tl-empty';
      empty.textContent = 'No correlated logs or errors found for this execution window.';
      panel.appendChild(empty);
    }
  }

  // --- Util ---

  function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const mins = Math.floor(ms / 60000);
    const secs = Math.round((ms % 60000) / 1000);
    return `${mins}m ${secs}s`;
  }

  function formatTimeLabel(date) {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const mon = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${mon}/${d} ${h}:${m}`;
  }

  function escHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function onClose(tab) {
    tabStates.delete(tab.id);
  }

  return { render, onClose };
})();

// --- Register with TabManager ---

(function register() {
  function doRegister() {
    if (!globalThis.tabManager) {
      setTimeout(doRegister, 0);
      return;
    }

    globalThis.tabManager.registerTabType('sql-timeline', {
      render: SqlTimeline.render,
      onClose: SqlTimeline.onClose,
      maxTabs: 1,
    });
  }

  doRegister();
})();
