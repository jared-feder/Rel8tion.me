import { CHECKIN_PATHS } from "./config.js";
import { createCheckin } from "./api.js";

export function buildCheckinPayload(path, eventId, values) {
  const base = {
    open_house_event_id: eventId,
    visitor_type: path,
    visitor_name: values.visitor_name || null,
    visitor_phone: values.visitor_phone || null,
    visitor_email: values.visitor_email || null,
    buyer_agent_name: values.buyer_agent_name || null,
    buyer_agent_phone: values.buyer_agent_phone || null,
    buyer_agent_email: values.buyer_agent_email || null,
    pre_approved: values.pre_approved === "yes" ? true : (values.pre_approved === "no" ? false : null),
    represented_buyer_confirmed: values.represented_buyer_confirmed || false,
    metadata: {
      source: "smart-sign-event",
      phase: "1.1"
    }
  };

  if (path === CHECKIN_PATHS.BUYER) return base;
  if (path === CHECKIN_PATHS.BUYER_WITH_AGENT) return base;
  if (path === CHECKIN_PATHS.BUYER_AGENT) return base;

  throw new Error("Unsupported visitor path");
}

export async function submitCheckin(path, eventId, values) {
  const payload = buildCheckinPayload(path, eventId, values);
  return createCheckin(payload);
}
