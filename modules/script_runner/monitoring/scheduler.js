/**
 * Script Runner — ScriptScheduler
 * Thin cron-based scheduling layer on top of the existing executor.
 * Reads `schedule` fields from the ScriptStore and registers cron jobs.
 * Also supports user-defined schedules (DB-backed) for scripts and chains.
 */

const cron = require('node-cron');
const crypto = require('node:crypto');

class ScriptScheduler {
  constructor(executor, store, send) {
    this.executor = executor;
    this.store = store;
    this.send = send;
    this.jobs = new Map(); // scriptId -> cron task
    this.userJobs = new Map(); // scheduleId -> cron task (user-defined schedules)
  }

  /**
   * Scan all scripts in the store and schedule those with a `schedule` field.
   * Also register any user-defined schedules from the store.
   */
  start() {
    this.stop(); // Clear any existing jobs first

    const scripts = this.store.getAllScripts();
    let count = 0;

    for (const script of scripts) {
      if (!script.schedule || !cron.validate(script.schedule)) continue;
      this._register(script);
      count++;
    }

    // Register user-defined schedules from DB
    const userSchedules = this.store.getAllSchedules();
    let userCount = 0;
    for (const schedule of userSchedules) {
      if (schedule.enabled && cron.validate(schedule.cron)) {
        this.registerUserSchedule(schedule);
        userCount++;
      }
    }

    if (count > 0 || userCount > 0) {
      console.log(`[script-runner] Scheduler started — ${count} config job(s), ${userCount} user schedule(s)`);
    }
  }

  /**
   * Cancel all registered cron jobs.
   */
  stop() {
    for (const [id, task] of this.jobs) {
      task.stop();
    }
    this.jobs.clear();
    for (const [id, task] of this.userJobs) {
      task.stop();
    }
    this.userJobs.clear();
  }

  /**
   * Re-evaluate a single script (e.g. after discovery refreshes the store).
   */
  refresh(scriptId) {
    if (this.jobs.has(scriptId)) {
      this.jobs.get(scriptId).stop();
      this.jobs.delete(scriptId);
    }
    const script = this.store.getScript(scriptId);
    if (script?.schedule && cron.validate(script.schedule)) {
      this._register(script);
    }
  }

  _register(script) {
    const task = cron.schedule(script.schedule, () => {
      const tabId = `sched-${script.id}-${Date.now()}`;

      console.log(`[script-runner] Scheduler firing: ${script.name} (${script.schedule})`);

      if (this.send) {
        this.send('script-runner:scheduled-run', {
          scriptId: script.id,
          name: script.name,
          schedule: script.schedule,
          tabId,
          timestamp: new Date().toISOString(),
        });
      }

      this.executor.execute({
        scriptPath: script.scriptPath,
        name: script.name,
        tabId,
        env: script.env || {},
        retries: script.retries || 0,
        retryDelayMs: script.retryDelayMs || 3000,
      });
    });

    this.jobs.set(script.id, task);
  }

  // --- User-defined schedules (DB-backed) ---

  registerUserSchedule(schedule) {
    if (!schedule || !schedule.id || !cron.validate(schedule.cron)) return;
    // Remove existing job if re-registering
    this.unregisterUserSchedule(schedule.id);

    const task = cron.schedule(schedule.cron, () => {
      console.log(`[script-runner] User schedule firing: ${schedule.name} (${schedule.cron})`);

      if (schedule.target_type === 'chain') {
        this._fireChainSchedule(schedule);
      } else {
        this._fireScriptSchedule(schedule);
      }
    });

    this.userJobs.set(schedule.id, task);
  }

  unregisterUserSchedule(scheduleId) {
    if (this.userJobs.has(scheduleId)) {
      this.userJobs.get(scheduleId).stop();
      this.userJobs.delete(scheduleId);
    }
  }

  _fireScriptSchedule(schedule) {
    const script = this.store.getScript(schedule.target_id);
    if (!script) {
      console.warn(`[script-runner] Schedule "${schedule.name}" — target script not found: ${schedule.target_id}`);
      return;
    }
    const tabId = `usched-${schedule.id}-${Date.now()}`;

    if (this.send) {
      this.send('script-runner:scheduled-run', {
        scheduleId: schedule.id,
        scriptId: script.id,
        name: script.name,
        schedule: schedule.cron,
        tabId,
        timestamp: new Date().toISOString(),
      });
    }

    this.executor.execute({
      scriptPath: script.scriptPath,
      name: script.name,
      tabId,
      env: script.env || {},
      retries: script.retries || 0,
      retryDelayMs: script.retryDelayMs || 3000,
    });
  }

  _fireChainSchedule(schedule) {
    const chain = this.store.getChain(schedule.target_id);
    if (!chain) {
      console.warn(`[script-runner] Schedule "${schedule.name}" — target chain not found: ${schedule.target_id}`);
      return;
    }
    const scripts = (chain.script_ids || [])
      .map((id) => this.store.getScript(id))
      .filter(Boolean);

    if (scripts.length === 0) {
      console.warn(`[script-runner] Schedule "${schedule.name}" — chain "${chain.name}" has no valid scripts`);
      return;
    }

    const tabId = `usched-chain-${schedule.id}-${Date.now()}`;

    if (this.send) {
      this.send('script-runner:scheduled-run', {
        scheduleId: schedule.id,
        chainId: chain.id,
        name: chain.name,
        schedule: schedule.cron,
        tabId,
        timestamp: new Date().toISOString(),
      });
    }

    // Run chain scripts sequentially
    this._runChainSequentially(scripts, tabId);
  }

  async _runChainSequentially(scripts, tabId) {
    for (const script of scripts) {
      await new Promise((resolve) => {
        const onComplete = (data) => {
          if (data.tabId === tabId) {
            this.executor.removeListener('complete', onComplete);
            resolve(data);
          }
        };
        this.executor.on('complete', onComplete);
        this.executor.execute({
          scriptPath: script.scriptPath,
          name: script.name,
          tabId,
          env: script.env || {},
          retries: script.retries || 0,
          retryDelayMs: script.retryDelayMs || 3000,
        });
      });
    }
  }

  getScheduledScripts() {
    return Array.from(this.jobs.keys());
  }

  getUserScheduleIds() {
    return Array.from(this.userJobs.keys());
  }
}

module.exports = { ScriptScheduler };
