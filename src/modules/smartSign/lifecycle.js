import { createOpenHouseEvent, getActiveEventBySmartSignId, getRecentEventByHostAgentSlug, updateOpenHouseEvent } from '../../api/events.js';
import { findNearestOpenHouses } from '../../api/openHouses.js';
import { createScanEvent, getRecentScanEventsByAgentSlug } from '../../api/scanEvents.js';
import { createSmartSign, getSmartSignByUid, updateSmartSign } from '../../api/smartSigns.js';

export async function recordChipScan({ uid, agentSlug, agentId = null, deviceType = 'chip', scanContext = 'unknown', metadata = {} }) {
  if (!uid) throw new Error('Missing scan uid');

  return createScanEvent({
    uid,
    agent_id: agentId,
    agent_slug: agentSlug || null,
    scan_type: 'chip_scan',
    device_type: deviceType,
    scan_context: scanContext,
    metadata
  });
}

export async function findCompanionScan({ agentSlug, uid, minutes = 10 }) {
  if (!agentSlug) return null;
  const recent = await getRecentScanEventsByAgentSlug(agentSlug, minutes);
  if (!Array.isArray(recent) || !recent.length) return null;
  return recent.find((row) => row.uid && row.uid !== uid) || null;
}

export async function getOrCreateSmartSignFromPair({ primaryUid, secondaryUid = null, ownerAgentSlug = null, ownerAgentId = null, primaryDeviceType = null, secondaryDeviceType = null }) {
  let sign = await getSmartSignByUid(primaryUid);
  if (!sign && secondaryUid) sign = await getSmartSignByUid(secondaryUid);
  if (sign) return sign;

  return createSmartSign({
    uid_primary: primaryUid,
    uid_secondary: secondaryUid,
    owner_agent_id: ownerAgentId,
    owner_agent_slug: ownerAgentSlug,
    status: 'setup_in_progress',
    primary_device_type: primaryDeviceType,
    secondary_device_type: secondaryDeviceType,
    activation_uid_primary: primaryUid,
    activation_uid_secondary: secondaryUid,
    activation_method: secondaryUid ? 'paired_scan' : 'single_scan'
  });
}

export async function resolveNearestListingContext({ lat, lng }) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  const houses = await findNearestOpenHouses(lat, lng);
  if (!Array.isArray(houses) || !houses.length) return null;
  return houses[0];
}

export async function createOrResumeOpenHouseEvent({
  smartSign,
  hostAgentSlug,
  hostAgentId = null,
  listingContext = null,
  primaryUid,
  secondaryUid = null,
  activationMethod = 'paired_scan'
}) {
  if (!smartSign?.id) throw new Error('Missing smart sign record');

  const active = await getActiveEventBySmartSignId(smartSign.id);
  if (active) {
    return updateOpenHouseEvent(active.id, {
      last_activity_at: new Date().toISOString(),
      activation_uid_primary: primaryUid || active.activation_uid_primary,
      activation_uid_secondary: secondaryUid || active.activation_uid_secondary,
      activation_method: activationMethod,
      status: active.status === 'draft' ? 'active' : active.status,
      setup_confirmed_at: active.setup_confirmed_at || new Date().toISOString()
    });
  }

  const recent = hostAgentSlug ? await getRecentEventByHostAgentSlug(hostAgentSlug, 2) : null;
  if (recent && recent.status !== 'completed' && recent.status !== 'cancelled') {
    return updateOpenHouseEvent(recent.id, {
      smart_sign_id: smartSign.id,
      activation_uid_primary: primaryUid,
      activation_uid_secondary: secondaryUid,
      activation_method: activationMethod,
      last_activity_at: new Date().toISOString(),
      status: 'active',
      setup_confirmed_at: recent.setup_confirmed_at || new Date().toISOString()
    });
  }

  return createOpenHouseEvent({
    host_agent_id: hostAgentId,
    host_agent_slug: hostAgentSlug,
    smart_sign_id: smartSign.id,
    event_date: new Date().toISOString().slice(0, 10),
    start_time: new Date().toISOString(),
    status: 'active',
    open_house_source_id: listingContext?.id || null,
    branding_snapshot: listingContext?.brokerage ? { brokerage: listingContext.brokerage } : {},
    setup_context: {
      listing_address: listingContext?.address || null,
      listing_price: listingContext?.price || null,
      activation_source: 'smart_sign',
      primary_uid: primaryUid || null,
      secondary_uid: secondaryUid || null
    },
    activation_uid_primary: primaryUid || null,
    activation_uid_secondary: secondaryUid || null,
    activation_method: activationMethod,
    setup_confirmed_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString()
  });
}

export async function activateSmartSignSession({
  uid,
  agentSlug,
  agentId = null,
  lat = null,
  lng = null,
  deviceType = 'chip',
  scanContext = 'setup_attempt'
}) {
  const scan = await recordChipScan({ uid, agentSlug, agentId, deviceType, scanContext, metadata: { lat, lng } });
  const companion = await findCompanionScan({ agentSlug, uid, minutes: 10 });

  const primaryUid = uid;
  const secondaryUid = companion?.uid || null;
  const sign = await getOrCreateSmartSignFromPair({
    primaryUid,
    secondaryUid,
    ownerAgentSlug: agentSlug,
    ownerAgentId: agentId,
    primaryDeviceType: deviceType,
    secondaryDeviceType: companion?.device_type || null
  });

  const listingContext = await resolveNearestListingContext({ lat, lng });
  const eventRecord = await createOrResumeOpenHouseEvent({
    smartSign: sign,
    hostAgentSlug: agentSlug,
    hostAgentId: agentId,
    listingContext,
    primaryUid,
    secondaryUid,
    activationMethod: secondaryUid ? 'paired_scan' : 'single_scan'
  });

  await updateSmartSign(sign.id, {
    owner_agent_id: agentId,
    owner_agent_slug: agentSlug,
    status: 'active',
    active_event_id: eventRecord.id,
    activation_uid_primary: primaryUid,
    activation_uid_secondary: secondaryUid,
    activation_method: secondaryUid ? 'paired_scan' : 'single_scan',
    setup_confirmed_at: new Date().toISOString(),
    primary_device_type: deviceType,
    secondary_device_type: companion?.device_type || null
  });

  await createScanEvent({
    uid,
    agent_id: agentId,
    agent_slug: agentSlug || null,
    scan_type: secondaryUid ? 'setup_complete' : 'smart_sign_confirmation',
    related_sign_id: sign.id,
    open_house_event_id: eventRecord.id,
    device_type: deviceType,
    scan_context: 'lifecycle_activation',
    metadata: {
      companion_uid: secondaryUid,
      listing_id: listingContext?.id || null
    }
  });

  return {
    scan,
    companionScan: companion,
    smartSign: sign,
    eventRecord,
    listingContext
  };
}
