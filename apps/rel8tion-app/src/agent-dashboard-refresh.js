(function (root) {
  'use strict';
  // One bounded read at a time. Stopping invalidates even a transport that ignores abort.
  function create(options) {
    const now = options.now || Date.now;
    const setTimer = options.setTimer || setTimeout;
    const clearTimer = options.clearTimer || clearTimeout;
    let active = false, generation = 0, timer = null, pending = null, request = null, deadlineTimer = null;
    let updatedAt = null;
    const notify = (phase, error = '') => options.onStatus({ phase, error, updatedAt });
    function schedule() {
      if (timer) clearTimer(timer);
      if (active) timer = setTimer(() => { timer = null; refresh(false); }, options.interval || 30000);
    }
    async function refresh(manual = false) {
      if (pending) return pending;
      if (!manual && (!active || !options.isVisible() || options.isEditing())) {
        if (active && options.isVisible() && options.isEditing()) notify('paused');
        schedule();
        return;
      }
      const version = ++generation;
      request = new AbortController();
      const controller = request;
      const signal = controller.signal;
      let deadline;
      notify('loading');
      const work = (async () => {
        try {
          const payload = await Promise.race([
            Promise.resolve().then(() => options.load(signal)),
            new Promise((_, reject) => {
              deadline = setTimer(() => {
                controller.abort();
                reject(new Error('The dashboard update timed out. Try again.'));
              }, options.timeout || 15000);
              deadlineTimer = deadline;
            })
          ]);
          if (version !== generation) return;
          if (!manual && (!options.isVisible() || options.isEditing())) {
            notify('paused');
            return;
          }
          options.apply(payload);
          updatedAt = now();
          notify('current');
        } catch (error) {
          if (version === generation) notify(updatedAt ? 'stale' : 'error', error.message || 'Could not update the dashboard.');
        } finally {
          if (deadline) clearTimer(deadline);
          if (deadlineTimer === deadline) deadlineTimer = null;
          if (version === generation) { pending = null; request = null; schedule(); }
        }
      })();
      pending = work;
      return work;
    }
    return {
      refresh,
      start() { active = true; schedule(); },
      stop() {
        active = false; generation++;
        if (timer) clearTimer(timer);
        if (deadlineTimer) clearTimer(deadlineTimer);
        deadlineTimer = null;
        timer = null; request?.abort(); request = null; pending = null;
      }
    };
  }

  function capture(container, doc = document, win = window) {
    const fields = [];
    container.querySelectorAll('[data-fit-form]').forEach((form) => {
      form.querySelectorAll('input,select,textarea').forEach((field) => {
        const focused = doc.activeElement === field;
        fields.push({ checkin: form.dataset.checkinId, name: field.name, value: field.value,
          checked: field.checked, focused,
          start: focused ? field.selectionStart : null, end: focused ? field.selectionEnd : null });
      });
    });
    const details = [...container.querySelectorAll('details')].map((item, index) => ({ key: item.id || String(index), open: item.open }));
    return { fields, details, scrollX: win.scrollX, scrollY: win.scrollY };
  }

  function restore(saved, container, win = window) {
    [...container.querySelectorAll('details')].forEach((item, index) => {
      const prior = saved.details?.find((entry) => entry.key === (item.id || String(index)));
      if (prior) item.open = prior.open;
    });
    container.querySelectorAll('[data-fit-form]').forEach((form) => {
      form.querySelectorAll('input,select,textarea').forEach((field) => {
        const prior = saved.fields.find((item) => item.checkin === form.dataset.checkinId && item.name === field.name);
        if (!prior) return;
        field.value = prior.value;
        if (field.type === 'checkbox' || field.type === 'radio') field.checked = prior.checked;
        if (prior.focused) {
          field.focus({ preventScroll: true });
          if (prior.start !== null && typeof field.setSelectionRange === 'function') {
            try { field.setSelectionRange(prior.start, prior.end); } catch (_) {}
          }
        }
      });
    });
    win.scrollTo(saved.scrollX, saved.scrollY);
  }
  root.Rel8tionDashboardRefresh = { create, capture, restore };
})(typeof window === 'undefined' ? globalThis : window);
