export function isSameDay(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return da.getUTCFullYear() === db.getUTCFullYear()
    && da.getUTCMonth() === db.getUTCMonth()
    && da.getUTCDate() === db.getUTCDate();
}

export function resolveEventLifecycle({ activeEvent, request, now = new Date() }) {
  if (!activeEvent) {
    return { action: "create_new", reason: "no_active_event" };
  }

  const sameSign = activeEvent.smart_sign_id === request.smart_sign_id;
  if (!sameSign) {
    return { action: "create_new", reason: "different_sign" };
  }

  const sameHost = activeEvent.host_agent_id && request.host_agent_id && activeEvent.host_agent_id === request.host_agent_id;
  const sameProperty = activeEvent.open_house_source_id && request.open_house_source_id
    && activeEvent.open_house_source_id === request.open_house_source_id;

  if (sameHost && sameProperty && isSameDay(activeEvent.created_at || now, now)) {
    return { action: "resume", reason: "same_sign_host_property_day" };
  }

  if (!sameProperty) {
    return { action: "close_and_create_new", reason: "property_changed" };
  }

  return { action: "prompt_resume_or_new", reason: "active_event_exists" };
}
