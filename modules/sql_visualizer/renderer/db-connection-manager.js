/**
 * SQL Visualizer — Database Connection Manager
 * Provides staged connection monitoring with periodic retry logic.
 * Manages connection state and notifies listeners on status changes.
 */

const DbConnectionManager = (() => {
  const listeners = new Set();
  let currentStatus = null;
  let retryTimer = null;
  let retryCount = 0;
  const MAX_RETRIES = 10;
  
  // Exponential backoff: 500ms, 1s, 2s, 4s, 8s, 16s, 30s, 30s, 30s, 30s
  const RETRY_DELAYS = [500, 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000];

  /**
   * Check database connection status
   */
  async function checkStatus() {
    try {
      const status = await globalThis.api.invoke('sql-visualizer:get-db-status');
      updateStatus(status);
      return status;
    } catch (err) {
      console.error('[db-connection-manager] Error checking status:', err);
      const errorStatus = {
        connected: false,
        path: null,
        message: 'Failed to check connection: ' + err.message,
      };
      updateStatus(errorStatus);
      return errorStatus;
    }
  }

  /**
   * Update status and notify listeners if it changed
   */
  function updateStatus(newStatus) {
    const hasChanged = !currentStatus ||
      newStatus.connected !== currentStatus.connected ||
      newStatus.path !== currentStatus.path;

    // Always notify on disconnect — even if path didn't change —
    // so content is cleared when the user removes the active database.
    const forceNotify = !newStatus.connected && currentStatus?.connected === false;

    if (hasChanged || forceNotify) {
      currentStatus = newStatus;
      notifyListeners();
    } else {
      currentStatus = newStatus;
    }

    // If connected, stop retrying
    if (newStatus.connected) {
      stopRetrying();
    }
  }

  /**
   * Start periodic connection monitoring with exponential backoff
   */
  async function startMonitoring() {
    // Await the initial check so currentStatus is populated before deciding to retry
    await checkStatus();

    // Only schedule retries if still not connected after the initial check
    if (!currentStatus?.connected) {
      scheduleNextRetry();
    }
  }

  /**
   * Schedule the next retry with exponential backoff
   */
  function scheduleNextRetry() {
    if (retryCount >= MAX_RETRIES) {
      console.warn('[db-connection-manager] Max retries reached');
      return;
    }

    const delay = RETRY_DELAYS[retryCount] || 30000;
    retryCount++;

    retryTimer = setTimeout(async () => {
      const status = await checkStatus();
      
      // If still not connected, schedule another retry
      if (!status.connected && retryCount < MAX_RETRIES) {
        scheduleNextRetry();
      }
    }, delay);
  }

  /**
   * Stop the retry timer
   */
  function stopRetrying() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    retryCount = 0;
  }

  /**
   * Stop all monitoring
   */
  function stopMonitoring() {
    stopRetrying();
  }

  /**
   * Get current status
   */
  function getStatus() {
    return currentStatus || {
      connected: false,
      path: null,
      message: 'Checking connection...',
    };
  }

  /**
   * Register a listener for status changes.
   * Immediately invokes the callback with the current status if known,
   * so new tabs/re-renders don't miss an already-connected state.
   */
  function onStatusChange(callback) {
    listeners.add(callback);
    if (currentStatus !== null) {
      try {
        callback(currentStatus);
      } catch (err) {
        console.error('[db-connection-manager] Listener error on immediate notify:', err);
      }
    }
    return () => listeners.delete(callback);
  }

  /**
   * Notify all listeners of status change
   */
  function notifyListeners() {
    for (const cb of listeners) {
      try {
        cb(currentStatus);
      } catch (err) {
        console.error('[db-connection-manager] Listener error:', err);
      }
    }
  }

  /**
   * Force an immediate retry (useful for manual reconnect button)
   */
  async function retryNow() {
    console.log('[db-connection-manager] Manual retry triggered');
    stopRetrying();
    retryCount = 0;
    const status = await checkStatus();
    
    if (!status.connected) {
      scheduleNextRetry();
    }
    
    return status;
  }

  /**
   * Switch the active database and refresh status
   */
  async function switchDb(newPath) {
    const result = await globalThis.api.invoke('sql-visualizer:switch-db', { path: newPath });
    if (result.success) {
      await checkStatus();
    }
    return result;
  }

  return {
    startMonitoring,
    stopMonitoring,
    getStatus,
    onStatusChange,
    retryNow,
    checkStatus,
    switchDb,
  };
})();
