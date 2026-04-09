import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.js";

function headers(extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    ...extra
  };
}

async function request(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Supabase configuration missing. Set __REL8TION_SUPABASE_URL__ and __REL8TION_SUPABASE_ANON_KEY__.");
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: headers(options.headers)
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Supabase request failed (${response.status})`);
  }

  return text ? JSON.parse(text) : null;
}

export async function getEventById(eventId) {
  const rows = await request(`open_house_events?id=eq.${encodeURIComponent(eventId)}&select=*`);
  return rows?.[0] || null;
}

export async function createCheckin(payload) {
  return request("event_checkins", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload)
  });
}

export async function closeEvent(eventId) {
  return request(`open_house_events?id=eq.${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    body: JSON.stringify({ ended_at: new Date().toISOString(), last_activity_at: new Date().toISOString() })
  });
}

export async function touchEvent(eventId) {
  return request(`open_house_events?id=eq.${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    body: JSON.stringify({ last_activity_at: new Date().toISOString() })
  });
}
