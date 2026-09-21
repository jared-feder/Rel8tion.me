    function readOutreachReleaseDraft() {
      const enabled = document.getElementById('releaseWindowEnabled');
      if (!enabled) return null;
      return {
        enabled: enabled.checked === true,
        from_open_start: document.getElementById('releaseWindowFrom')?.value || '',
        through_open_start: document.getElementById('releaseWindowThrough')?.value || '',
        expires_at: document.getElementById('releaseWindowExpires')?.value || '',
        reason: document.getElementById('releaseWindowReason')?.value || '',
        expected_updated_at: state.outreachReleaseDraft?.expected_updated_at ?? outreachControlValue('release_window.updated_at', '')
      };
    }

    function rememberOutreachReleaseDraft() {
      if (state.actionKey) return;
      const draft = readOutreachReleaseDraft();
      if (draft) state.outreachReleaseDraft = draft;
    }

    function releaseDraftIso(value) {
      if (!value) return null;
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) throw new Error('Enter a valid date and time. Your edits have been kept.');
      return date.toISOString();
    }

    function acceptOutreachControlRead(next) {
      if (!next || ['outreach_control:release', 'outreach_control:reload_release'].includes(state.actionKey)) return state.outreachControl;
      const previous = state.outreachControl?.release_window;
      const previousTime = Date.parse(previous?.updated_at || '');
      const nextTime = Date.parse(next.release_window?.updated_at || '');
      // A GET started before a save must not put the older release dates back.
      if (Number.isFinite(previousTime) && (!Number.isFinite(nextTime) || nextTime < previousTime)) {
        return { ...next, release_window: previous };
      }
      return next;
    }

    async function saveOutreachReleaseWindow() {
      if (state.actionKey) return;
      const draft = readOutreachReleaseDraft();
      if (!draft) return showToast('Open Outreach Control before saving release dates.');
      state.outreachReleaseDraft = draft;
      state.outreachReleaseError = '';

      // Capture every submitted value and its revision before prompts or renders.
      let payload;
      try {
        payload = {
          action: 'update_release_window',
          expected_updated_at: draft.expected_updated_at,
          release_window: {
            enabled: draft.enabled,
            from_open_start: releaseDraftIso(draft.from_open_start),
            through_open_start: releaseDraftIso(draft.through_open_start),
            expires_at: releaseDraftIso(draft.expires_at),
            reason: draft.reason.trim()
          }
        };
      } catch (error) {
        state.outreachReleaseError = error.message;
        showToast(error.message);
        refreshAreaContent();
        return;
      }

      let confirmation = '';
      if (draft.enabled) {
        confirmation = window.prompt('This window bypasses only the rolling opt-out health stop for the selected event dates. STOP suppression and all locked protections remain active. Type REL8TION to enable:') || '';
        if (confirmation !== 'REL8TION') return showToast('Override window change cancelled.');
      } else if (!window.confirm('Disable the current outreach health override window?')) {
        return;
      }
      payload.confirmation = confirmation;
      state.actionKey = 'outreach_control:release';
      refreshAreaContent();
      try {
        const result = await api('/api/admin/outreach-control', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (!result?.release_window?.value) throw new Error('The server did not return the saved release window. Reload saved dates to verify; your edits have been kept.');
        state.outreachControl = result;
        state.outreachReleaseDraft = null;
        state.outreachReleaseError = '';
        state.actionKey = '';
        showToast(draft.enabled ? 'Health override window enabled.' : 'Health override window disabled.');
        refreshAreaContent();
      } catch (error) {
        state.actionKey = '';
        state.outreachReleaseError = error.message || 'Unable to save the release window.';
        showToast(state.outreachReleaseError);
        refreshAreaContent();
      }
    }

    async function reloadOutreachReleaseDraft() {
      if (state.actionKey) return;
      if (state.outreachReleaseDraft && !window.confirm('Discard your unsaved release-window edits and load the currently saved dates?')) return;
      state.actionKey = 'outreach_control:reload_release';
      refreshAreaContent();
      try {
        const result = await api('/api/admin/outreach-control');
        if (!result?.release_window?.value) throw new Error('The server did not return the saved release window. Your edits have been kept.');
        state.outreachControl = result;
        state.outreachReleaseDraft = null;
        state.outreachReleaseError = '';
        showToast('Saved release dates reloaded.');
      } catch (error) {
        state.outreachReleaseError = error.message || 'Unable to reload saved dates.';
        showToast(state.outreachReleaseError);
      } finally {
        state.actionKey = '';
        refreshAreaContent();
      }
    }
