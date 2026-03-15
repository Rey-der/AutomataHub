/**
 * Centralized error messages for common failure scenarios.
 */

const ERROR_MESSAGES = {
  // Script discovery & execution
  SCRIPT_NOT_FOUND: 'Script file not found',
  SCRIPT_PATH_OUTSIDE: 'Script path is outside the allowed scripts directory',
  SCRIPT_NO_INTERPRETER: 'No interpreter found for this script type',
  PERMISSION_DENIED: 'Permission denied — check file permissions',
  SPAWN_FAILED: 'Failed to start script process',

  // Metadata
  MALFORMED_CONFIG: 'config.json is malformed — using defaults',
  NO_EXECUTABLES: 'No executable script files found in this folder',
  FOLDER_NOT_FOUND: 'Folder does not exist',
  NOT_A_DIRECTORY: 'Selected path is not a folder',
  IGNORED_FOLDER: 'This folder type is ignored',

  // IPC validation
  MISSING_SCRIPT_PATH: 'Missing required parameter: scriptPath',
  MISSING_TAB_ID: 'Missing required parameter: tabId',
  MISSING_FOLDER_PATH: 'Missing required parameter: folderPath',
  MISSING_MAIN_SCRIPT: 'Missing required parameter: mainScript',
  MISSING_SCRIPT_ID: 'Missing required parameter: scriptId',
  INVALID_SCRIPT_PATH: 'Invalid parameter: scriptPath must be a non-empty string',
  INVALID_TAB_ID: 'Invalid parameter: tabId must be a non-empty string',
  INVALID_FOLDER_PATH: 'Invalid parameter: folderPath must be a non-empty string',
  INVALID_SCRIPT_ID: 'Invalid parameter: scriptId must be a non-empty string',
  INVALID_CONTENT: 'Invalid parameter: content must be a non-empty string',
  INVALID_SCRIPT_NAME: 'Invalid parameter: scriptName must be a non-empty string',

  // General
  LOAD_SCRIPTS_FAILED: 'Failed to load scripts',
  SAVE_LOGS_FAILED: 'Failed to save logs',
  IMPORT_FAILED: 'Failed to import script folder',
  REMOVE_FAILED: 'Failed to remove script folder',
  NO_CONTENT: 'No content to save',
};

/**
 * Map common system error codes to user-friendly messages.
 */
function friendlyError(err) {
  if (!err) return 'An unknown error occurred';
  const code = err.code || '';
  switch (code) {
    case 'ENOENT': return ERROR_MESSAGES.SCRIPT_NOT_FOUND;
    case 'EACCES': return ERROR_MESSAGES.PERMISSION_DENIED;
    case 'EISDIR': return ERROR_MESSAGES.NOT_A_DIRECTORY;
    default: return err.message || 'An unknown error occurred';
  }
}

module.exports = { ERROR_MESSAGES, friendlyError };
