function showNotification(message, type = 'info', duration = 3000) {
  // Remove existing notification if any
  const existing = document.querySelector('.notification');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.className = `notification notification-${type}`;

  const msg = document.createElement('span');
  msg.textContent = message;
  el.appendChild(msg);

  const closeBtn = document.createElement('span');
  closeBtn.className = 'notification-close';
  closeBtn.textContent = '\u00D7';
  closeBtn.setAttribute('tabindex', '0');
  closeBtn.setAttribute('role', 'button');
  closeBtn.setAttribute('aria-label', 'Dismiss notification');
  closeBtn.addEventListener('click', () => el.remove());
  closeBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      el.remove();
    }
  });
  el.appendChild(closeBtn);

  document.body.appendChild(el);

  if (duration > 0) {
    setTimeout(() => {
      if (el.parentNode) el.remove();
    }, duration);
  }
}

function formatTimestamp(date = new Date()) {
  return date.toISOString();
}

function sanitizeScriptName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-');
}

function truncateOutput(text, maxLines = 1000) {
  const lines = String(text || '').split('\n');
  if (lines.length <= maxLines) {
    return lines.join('\n');
  }
  return lines.slice(lines.length - maxLines).join('\n');
}

window.ui = {
  showNotification,
  formatTimestamp,
  sanitizeScriptName,
  truncateOutput
};
