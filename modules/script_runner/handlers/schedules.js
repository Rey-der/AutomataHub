/**
 * Script Runner — Schedules Handler
 * CRUD for user-defined schedules (cron-based timers for scripts or chains).
 */

function register(ipcBridge, { store, persistence, emit, scheduler }) {
  ipcBridge.handle('script-runner:get-schedules', async (_e, _args) => {
    try {
      return { schedules: store.getAllSchedules() };
    } catch (err) {
      console.error('[script-runner] get-schedules error:', err.message);
      return { error: err.message };
    }
  });

  ipcBridge.handle('script-runner:create-schedule', async (_e, args) => {
    try {
      const { name, target_type, target_id, cron, enabled } = args || {};
      if (!name || !name.trim()) return { success: false, error: 'Schedule name is required' };
      if (!target_id) return { success: false, error: 'Target is required' };
      if (!cron) return { success: false, error: 'Schedule cron expression is required' };

      const schedule = {
        id: store.generateId(),
        name: name.trim(),
        target_type: target_type || 'script',
        target_id,
        cron,
        enabled: enabled !== false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      store.addSchedule(schedule);
      if (persistence) {
        persistence.saveSchedule(schedule);
        persistence.flush();
      }

      if (scheduler && schedule.enabled) scheduler.registerUserSchedule(schedule);

      emit('script-runner:schedule-created', { schedule });
      console.log('[script-runner] Created schedule:', schedule.name);
      return { success: true, schedule };
    } catch (err) {
      console.error('[script-runner] create-schedule error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcBridge.handle('script-runner:update-schedule', async (_e, args) => {
    try {
      const { schedule_id, ...updates } = args || {};
      if (!schedule_id) return { success: false, error: 'Schedule ID is required' };

      if (updates.name !== undefined) updates.name = updates.name.trim();
      const schedule = store.updateSchedule(schedule_id, updates);
      if (persistence) {
        persistence.saveSchedule(schedule);
        persistence.flush();
      }

      // Re-register or unregister the cron job
      if (scheduler) {
        scheduler.unregisterUserSchedule(schedule_id);
        if (schedule.enabled) scheduler.registerUserSchedule(schedule);
      }

      emit('script-runner:schedule-updated', { schedule });
      return { success: true, schedule };
    } catch (err) {
      console.error('[script-runner] update-schedule error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcBridge.handle('script-runner:delete-schedule', async (_e, args) => {
    try {
      const { schedule_id } = args || {};
      if (!schedule_id) return { success: false, error: 'Schedule ID is required' };

      store.removeSchedule(schedule_id);
      if (persistence) {
        persistence.removeSchedule(schedule_id);
        persistence.flush();
      }

      if (scheduler) scheduler.unregisterUserSchedule(schedule_id);

      emit('script-runner:schedule-deleted', { schedule_id });
      console.log('[script-runner] Deleted schedule:', schedule_id);
      return { success: true };
    } catch (err) {
      console.error('[script-runner] delete-schedule error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcBridge.handle('script-runner:toggle-schedule', async (_e, args) => {
    try {
      const { schedule_id, enabled } = args || {};
      if (!schedule_id) return { success: false, error: 'Schedule ID is required' };

      const schedule = store.updateSchedule(schedule_id, { enabled: !!enabled });
      if (persistence) {
        persistence.saveSchedule(schedule);
        persistence.flush();
      }

      if (scheduler) {
        scheduler.unregisterUserSchedule(schedule_id);
        if (schedule.enabled) scheduler.registerUserSchedule(schedule);
      }

      emit('script-runner:schedule-updated', { schedule });
      return { success: true, schedule };
    } catch (err) {
      console.error('[script-runner] toggle-schedule error:', err.message);
      return { success: false, error: err.message };
    }
  });
}

module.exports = { register };
