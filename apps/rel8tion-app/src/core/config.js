export const SUPABASE_URL = 'https://nicanqrfqlbnlmnoernb.supabase.co';
export const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pY2FucXJmcWxibmxtbm9lcm5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExNjEwNzcsImV4cCI6MjA3NjczNzA3N30.FNE_8qVT4BZBrgdhYqvdwEzeCdbtUzBXndq_Us-WUjg';
const runtimeConfig = typeof globalThis !== 'undefined' ? globalThis : {};

export const ASSETS = {
  rel8tionLogo: 'https://rel8tion.me/wp-content/uploads/2026/04/logo150x100trans.png',
  floatingChip: 'https://nicanqrfqlbnlmnoernb.supabase.co/storage/v1/object/public/images/signchip.png'
};

export const OFFICIAL_NYS_HOUSING_ANTI_DISCRIMINATION_DISCLOSURE_SOURCE_URL =
  'https://dos.ny.gov/housing-and-anti-discrimination-disclosure-form';

export const REL8TION_NYS_HOUSING_ANTI_DISCRIMINATION_DISCLOSURE_STORAGE_URL =
  'https://nicanqrfqlbnlmnoernb.supabase.co/storage/v1/object/public/compliance/nyhousingantidisc.pdf';

export const NYS_HOUSING_ANTI_DISCRIMINATION_DISCLOSURE_PDF_URL =
  runtimeConfig.REL8TION_NYS_DISCLOSURE_PDF_URL || REL8TION_NYS_HOUSING_ANTI_DISCRIMINATION_DISCLOSURE_STORAGE_URL;

export const PROFILE_BUCKET = 'agent-images';

export const ROUTES = {
  onboarding: '/onboarding',
  buyerProfile: '/a',
  claim: '/claim',
  agents: '/agents',
  sign: '/sign',
  event: '/event',
  admin: '/admin'
};
