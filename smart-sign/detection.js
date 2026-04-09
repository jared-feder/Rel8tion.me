import { SMART_SIGN_DOUBLE_SCAN_WINDOW_MINUTES } from "./config.js";
import { deriveDeviceTypeFallback, isSignCapableType, normalizeDeviceType } from "./device.js";

export function shouldPromptSmartSignSetup({
  previousScan,
  currentScan,
  now = new Date(),
  requireExplicitConfirmation = true
}) {
  if (!previousScan || !currentScan) {
    return { eligible: false, reason: "missing_scan" };
  }

  const sameAgent = previousScan.agent_id && currentScan.agent_id && previousScan.agent_id === currentScan.agent_id;
  if (!sameAgent) {
    return { eligible: false, reason: "different_agent" };
  }

  const differentUid = previousScan.uid && currentScan.uid && previousScan.uid !== currentScan.uid;
  if (!differentUid) {
    return { eligible: false, reason: "same_uid" };
  }

  const prevTs = new Date(previousScan.scanned_at || previousScan.created_at || now).getTime();
  const currTs = new Date(currentScan.scanned_at || currentScan.created_at || now).getTime();
  const deltaMs = Math.abs(currTs - prevTs);
  const withinWindow = deltaMs <= SMART_SIGN_DOUBLE_SCAN_WINDOW_MINUTES * 60 * 1000;
  if (!withinWindow) {
    return { eligible: false, reason: "outside_window" };
  }

  const previousType = normalizeDeviceType(previousScan.device_type) || deriveDeviceTypeFallback(previousScan.uid);
  const currentType = normalizeDeviceType(currentScan.device_type) || deriveDeviceTypeFallback(currentScan.uid);
  const hasSignCapable = isSignCapableType(previousType) || isSignCapableType(currentType);

  if (!hasSignCapable) {
    return { eligible: false, reason: "not_sign_capable" };
  }

  return {
    eligible: true,
    reason: requireExplicitConfirmation ? "confirmation_required" : "auto_allowed",
    activation_uid_primary: previousScan.uid,
    activation_uid_secondary: currentScan.uid,
    inferred_types: {
      previous: previousType,
      current: currentType
    }
  };
}
