function eventPassMarker(value) {
  return /event[_ -]?pass/i.test(String(value || ''));
}

function isEventPassBackingSign(sign = {}, inventoryTypes = []) {
  if ((inventoryTypes || []).some((value) => String(value || '').toLowerCase() === 'event_pass')) {
    return true;
  }

  return [
    sign.activation_method,
    sign.primary_device_type,
    sign.secondary_device_type
  ].some(eventPassMarker);
}

function classifySignProduct(sign = {}, inventoryTypes = []) {
  return isEventPassBackingSign(sign, inventoryTypes) ? 'event_pass' : 'smart_sign';
}

module.exports = {
  classifySignProduct,
  isEventPassBackingSign
};
