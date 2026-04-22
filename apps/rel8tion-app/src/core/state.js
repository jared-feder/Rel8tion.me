export const state = {
  uid: new URLSearchParams(location.search).get('uid'),
  detectedHouse: null,
  nearbyHouses: [],
  currentBrand: null,
  prefilledAgent: null,
  keyRecord: null,
  loaderInterval: null,
  detectedAgentPhoto: null,
  selectedBrokerage: ''
};

export function resetDetectionState() {
  state.detectedHouse = null;
  state.nearbyHouses = [];
  state.detectedAgentPhoto = null;
}

export function setCurrentBrand(brand) {
  state.currentBrand = brand;
}

export function setPrefilledAgent(agent) {
  state.prefilledAgent = agent;
}

export function setKeyRecord(keyRecord) {
  state.keyRecord = keyRecord;
}

export function setDetectedHouse(house) {
  state.detectedHouse = house;
}

export function setNearbyHouses(houses) {
  state.nearbyHouses = Array.isArray(houses) ? houses : [];
}

export function setLoaderInterval(id) {
  state.loaderInterval = id;
}

export function setDetectedAgentPhoto(photoUrl) {
  state.detectedAgentPhoto = photoUrl || null;
}

export function setSelectedBrokerage(brokerage) {
  state.selectedBrokerage = brokerage || '';
}
