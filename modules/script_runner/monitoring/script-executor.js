/**
 * Script Runner — ScriptExecutor
 * Manages script execution queue and subprocess control.
 */

const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const INTERPRETER_MAP = {
  '.sh': '/bin/bash',
  '.bash': '/bin/bash',
  '.py': 'python3',
  '.py3': 'python3',
  '.js': 'node',
  '.mjs': 'node',
  '.rb': 'ruby',
  '.pl': 'perl',
  '.csx': 'dotnet',
  '.cs': 'dotnet',
};

const INTERPRETER_ARGS = {
  '.csx': ['script'],
  '.cs': ['run'],
};

const PROJECT_MODE = new Set(['.cs']);

class ScriptExecutor extends EventEmitter {
  constructor(scriptsDir, opts = {}) {
    super();
    this.scriptsDir = scriptsDir;
    this.extraEnv = opts.env || {};
    this.currentProcess = null;
    this.currentJob = null;
    this.queue = [];
    this._killTimer = null;
    this.resolveInside = opts.resolveInside;
    this.friendlyError = opts.friendlyError;
    this.ERROR_MESSAGES = opts.ERROR_MESSAGES || {};
  }

  isRunning() {
    return this.currentProcess !== null;
  }

  _validatePath(scriptPath) {
    if (!this.resolveInside) return scriptPath; // Fallback if not provided
    return this.resolveInside(scriptPath, this.scriptsDir);
  }

  _getInterpreter(scriptPath) {
    const ext = path.extname(scriptPath).toLowerCase();
    return INTERPRETER_MAP[ext] || null;
  }

  _getInterpreterArgs(scriptPath) {
    const ext = path.extname(scriptPath).toLowerCase();
    return INTERPRETER_ARGS[ext] || [];
  }

  execute(job) {
    if (this.isRunning()) {
      this.queue.push(job);
      const position = this.queue.length;
      this.emit('queue-status', {
        tabId: job.tabId,
        position,
        queuedScripts: this.queue.map((j, i) => ({ name: j.name, position: i + 1, tabId: j.tabId })),
      });
      return;
    }

    this._spawn(job);
  }

  _spawn(job) {
    let resolvedPath;
    try {
      resolvedPath = this._validatePath(job.scriptPath);
    } catch (err) {
      const friendlyMsg = this.friendlyError ? this.friendlyError(err) : err.message;
      this.emit('error', {
        tabId: job.tabId,
        text: friendlyMsg,
        timestamp: new Date().toISOString(),
      });
      this.emit('complete', {
        tabId: job.tabId,
        exitCode: 1,
        signal: null,
        runtime: 0,
      });
      this._processNext();
      return;
    }

    if (!fs.existsSync(resolvedPath)) {
      this.emit('error', {
        tabId: job.tabId,
        text: `Script not found: ${job.scriptPath}`,
        timestamp: new Date().toISOString(),
      });
      this.emit('complete', {
        tabId: job.tabId,
        exitCode: 1,
        signal: null,
        runtime: 0,
      });
      this._processNext();
      return;
    }

    const interpreter = this._getInterpreter(resolvedPath);
    if (!interpreter) {
      this.emit('error', {
        tabId: job.tabId,
        text: 'No interpreter found for this script type',
        timestamp: new Date().toISOString(),
      });
      this.emit('complete', {
        tabId: job.tabId,
        exitCode: 1,
        signal: null,
        runtime: 0,
      });
      this._processNext();
      return;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const args = PROJECT_MODE.has(ext)
      ? this._getInterpreterArgs(resolvedPath)
      : [...this._getInterpreterArgs(resolvedPath), resolvedPath];
    const command = interpreter;

    const startTime = Date.now();

    const child = spawn(command, args, {
      cwd: path.dirname(resolvedPath),
      env: { ...process.env, ...this.extraEnv, ...(job.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      detached: false,
    });

    this.currentProcess = child;
    this.currentJob = job;

    let stdoutRemainder = '';
    child.stdout.on('data', (chunk) => {
      const text = stdoutRemainder + chunk.toString();
      const lines = text.split('\n');
      stdoutRemainder = lines.pop();
      for (const line of lines) {
        this.emit('output', {
          tabId: job.tabId,
          text: line,
          timestamp: new Date().toISOString(),
        });
      }
    });

    let stderrRemainder = '';
    child.stderr.on('data', (chunk) => {
      const text = stderrRemainder + chunk.toString();
      const lines = text.split('\n');
      stderrRemainder = lines.pop();
      for (const line of lines) {
        this.emit('error', {
          tabId: job.tabId,
          text: line,
          timestamp: new Date().toISOString(),
        });
      }
    });

    child.on('error', (err) => {
      const msg = err.code === 'ENOENT'
        ? `Command not found: "${command}". Make sure it is installed and in your PATH.`
        : (this.friendlyError ? this.friendlyError(err) : err.message);
      this.emit('error', {
        tabId: job.tabId,
        text: msg,
        timestamp: new Date().toISOString(),
      });
      this._cleanup();
      this.emit('complete', {
        tabId: job.tabId,
        exitCode: 1,
        signal: null,
        runtime: Date.now() - startTime,
      });
      this._processNext();
    });

    child.on('close', (exitCode, signal) => {
      if (stdoutRemainder) {
        this.emit('output', {
          tabId: job.tabId,
          text: stdoutRemainder,
          timestamp: new Date().toISOString(),
        });
      }
      if (stderrRemainder) {
        this.emit('error', {
          tabId: job.tabId,
          text: stderrRemainder,
          timestamp: new Date().toISOString(),
        });
      }
      this._cleanup();
      this.emit('complete', {
        tabId: job.tabId,
        exitCode: exitCode ?? 1,
        signal: signal || null,
        runtime: Date.now() - startTime,
      });
      this._processNext();
    });
  }

  stop(tabId) {
    if (!this.currentProcess || !this.currentJob) return;

    if (this.currentJob.tabId !== tabId) {
      this.queue = this.queue.filter((j) => j.tabId !== tabId);
      return;
    }

    const child = this.currentProcess;

    try {
      child.kill('SIGTERM');
    } catch {
      return;
    }

    this._killTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignore
      }
    }, 5000);
  }

  _cleanup() {
    if (this._killTimer) {
      clearTimeout(this._killTimer);
      this._killTimer = null;
    }
    this.currentProcess = null;
    this.currentJob = null;
  }

  _processNext() {
    const next = this.queue.shift();
    if (next) {
      this._spawn(next);
    }
  }

  killAll() {
    this.queue = [];
    if (this.currentProcess) {
      try {
        this.currentProcess.kill('SIGKILL');
      } catch {
        // Ignore
      }
      this._cleanup();
    }
  }
}

module.exports = { ScriptExecutor };
