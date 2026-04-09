export const state = {
  event: null,
  checkinPath: null,
  loading: false,
  error: null
};

export function setState(partial) {
  Object.assign(state, partial);
}
