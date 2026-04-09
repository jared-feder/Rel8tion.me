export const SMART_SIGN_DOUBLE_SCAN_WINDOW_MINUTES = 3;

export const DEVICE_TYPES = Object.freeze({
  CHIP: "chip",
  SMART_SIGN: "smart_sign",
  SMART_SIGN_SIDE_A: "smart_sign_side_a",
  SMART_SIGN_SIDE_B: "smart_sign_side_b"
});

export const CHECKIN_PATHS = Object.freeze({
  BUYER: "buyer",
  BUYER_WITH_AGENT: "buyer_with_agent",
  BUYER_AGENT: "buyer_agent"
});

export const SUPABASE_URL = window.__REL8TION_SUPABASE_URL__ || "";
export const SUPABASE_ANON_KEY = window.__REL8TION_SUPABASE_ANON_KEY__ || "";
