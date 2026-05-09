export const state = {
  uid: new URLSearchParams(location.search).get('uid'),
  detectedHouse: null,
  nearbyHouses: [],
  currentBrand: null,
  prefilledAgent: null,
  keyRecord: null,
  loaderInterval: null
};

export function resetDetectionState() {
  state.detectedHouse = null;
  state.nearbyHouses = [];
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