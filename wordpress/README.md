# WordPress Working Files

This folder is a local tracking home for WordPress-side files that are being edited or migrated outside the main app code.

Current focus:

- `/hot-list` page
- outreach reply visibility
- reducing manual controls in the outreach UI

Files:

- `pricing-section.html`
  - complete HTML/CSS/JS drop-in for the public WordPress pricing page
  - fetches the canonical public pricing API and intentionally has no hardcoded dollar amounts
  - routes private loan-officer consultations and real estate broker/team discount calls to the native REL8TION booking calendar
  - requires manual publication in WordPress; committing this file does not update the live page

- `hot-list.current-redacted.html`
  - the current page source Jared pasted into the session
  - kept here as the baseline reference
  - anon key intentionally redacted
- `hot-list.v2.html`
  - the updated working version from this session
  - reply-first layout
  - removes approval/copy/open/mark-sent controls
  - assumes outbound sending is automatic unless blocked

Notes:

- These files are for source tracking in the repo.
- They are not automatically synced to the live WordPress page.
- Replace `YOUR_ANON_KEY_HERE` with the live anon key when pasting into WordPress.
