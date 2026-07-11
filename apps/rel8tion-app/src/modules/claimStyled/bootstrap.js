import { bindPublicHandlers, init } from './flow.js?v=20260531-eventpass-profile-qr';

export function initClaimStyledPage() {
  bindPublicHandlers();
  init();
}
