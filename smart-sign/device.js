import { DEVICE_TYPES } from "./config.js";

const SIGN_CAPABLE_TYPES = new Set([
  DEVICE_TYPES.SMART_SIGN,
  DEVICE_TYPES.SMART_SIGN_SIDE_A,
  DEVICE_TYPES.SMART_SIGN_SIDE_B
]);

export function normalizeDeviceType(rawType) {
  const t = String(rawType || "").trim().toLowerCase();
  if (Object.values(DEVICE_TYPES).includes(t)) return t;
  return null;
}

export function isSignCapableType(rawType) {
  const normalized = normalizeDeviceType(rawType);
  return normalized ? SIGN_CAPABLE_TYPES.has(normalized) : false;
}

export function deriveDeviceTypeFallback(uid) {
  const raw = String(uid || "").toLowerCase();
  if (!raw) return null;

  if (raw.includes("ssa") || raw.includes("sidea")) return DEVICE_TYPES.SMART_SIGN_SIDE_A;
  if (raw.includes("ssb") || raw.includes("sideb")) return DEVICE_TYPES.SMART_SIGN_SIDE_B;
  if (raw.includes("smart") || raw.includes("sign")) return DEVICE_TYPES.SMART_SIGN;
  return DEVICE_TYPES.CHIP;
}
