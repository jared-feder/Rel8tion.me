export function normalizeOpenHouseSourceId(eventRow) {
  return eventRow?.open_house_source_id || eventRow?.property_id || null;
}
