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

    if (hasChanged) {
      currentStatus = newStatus;
      notifyListeners();
    }

    // If connected, stop retrying
    if (newStatus.connected) {
      stopRetrying();
    }
  }

  /**
   * Start periodic connection monitoring with exponential backoff
   */
  function startMonitoring() {
    // Initial check
    checkStatus();

    // If not connected, schedule first retry
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
   * Register a listener for status changes
   */
  function onStatusChange(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback); // Return unsubscribe function
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

  return {
    startMonitoring,
    stopMonitoring,
    getStatus,
    onStatusChange,
    retryNow,
    checkStatus,
  };
})();
