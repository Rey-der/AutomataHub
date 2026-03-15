const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { ERROR_MESSAGES, friendlyError } = require('./core/errors');
const { resolveInside } = require('./core/path-utils');

const INTERPRETER_MAP = {
  '.sh': '/bin/bash',
  '.bash': '/bin/bash',
  '.py': 'python3',
  '.py3': 'python3',
  '.js': 'node',
  '.mjs': 'node',
  '.rb': 'ruby',
  '.pl': 'perl',
  '.csx': 'dotnet-script',
};

class ScriptExecutor extends EventEmitter {
  constructor(scriptsDir) {
    super();
    this.scriptsDir = scriptsDir;
    this.currentProcess = null;
    this.currentJob = null;
    this.queue = [];
    this._killTimer = null;
  }

  isRunning() {
    return this.currentProcess !== null;
  }

  _validatePath(scriptPath) {
    return resolveInside(scriptPath, this.scriptsDir);
  }

  _getInterpreter(scriptPath) {
    const ext = path.extname(scriptPath).toLowerCase();
    return INTERPRETER_MAP[ext] || null;
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
      this.emit('error', {
        tabId: job.tabId,
        text: friendlyError(err),
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
        text: `${ERROR_MESSAGES.SCRIPT_NOT_FOUND}: ${job.scriptPath}`,
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
        text: ERROR_MESSAGES.SCRIPT_NO_INTERPRETER,
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

    const args = [resolvedPath];
    const command = interpreter;

    const startTime = Date.now();

    const child = spawn(command, args, {
      cwd: path.dirname(resolvedPath),
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
      stdoutRemainder = lines.pop(); // keep incomplete trailing line
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
      this.emit('error', {
        tabId: job.tabId,
        text: friendlyError(err),
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
      // Flush any remaining partial lines
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
      // Remove from queue if queued
      this.queue = this.queue.filter((j) => j.tabId !== tabId);
      return;
    }

    const child = this.currentProcess;

    try {
      child.kill('SIGTERM');
    } catch {
      // Process may have already exited
      return;
    }

    this._killTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignore — already dead
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
