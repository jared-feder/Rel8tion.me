export type CanonicalAgentProductionField =
  | 'agent_name'
  | 'first_name'
  | 'last_name'
  | 'brokerage'
  | 'phone'
  | 'email'
  | 'production_volume'
  | 'transaction_count'
  | 'active_listing_count'
  | 'sold_listing_count'
  | 'listings_days_since_last'
  | 'listings_active_last_12_months'
  | 'buyside_last_90_days'
  | 'buyside_last_12_months'
  | 'average_price'
  | 'market_area'
  | 'city'
  | 'county'
  | 'zip'
  | 'state';

export type ProductionImportRow = {
  id?: string | null;
  matched_agent_id?: string | null;
  agent_name: string;
  first_name: string;
  last_name: string;
  brokerage: string;
  phone: string;
  phone_normalized: string;
  email: string;
  market_area: string;
  city: string;
  county: string;
  primary_county: string;
  inferred_county: string;
  zip: string;
  state: string;
  location_confidence: number;
  location_source: string;
  production_volume: number;
  transaction_count: number;
  active_listing_count: number;
  sold_listing_count: number;
  listings_days_since_last: number;
  listings_active_last_12_months: number;
  buyside_last_90_days: number;
  buyside_last_12_months: number;
  average_price: number;
  raw?: Record<string, unknown>;
  match_confidence?: number;
  match_reason?: string;
  needs_review?: boolean;
};

export type AgentRanking = {
  id?: string;
  agent_id?: string | null;
  latest_import_row_id?: string | null;
  agent_name: string | null;
  brokerage: string | null;
  phone: string | null;
  phone_normalized: string | null;
  email: string | null;
  market_area: string | null;
  county?: string | null;
  primary_county?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  inferred_county?: string | null;
  location_confidence?: number;
  location_source?: string | null;
  production_volume: number;
  transaction_count: number;
  active_listing_count: number;
  sold_listing_count: number;
  listings_days_since_last: number;
  listings_active_last_12_months: number;
  buyside_last_90_days: number;
  buyside_last_12_months: number;
  average_price: number;
  open_house_count: number;
  matched_open_house_count?: number;
  matched_weekend_open_house_count?: number;
  matched_active_listing_count?: number;
  matched_open_house_ids?: string[];
  last_matched_open_house_at?: string | null;
  rel8tion_lead_capture_score: number;
  opportunity_gap_score: number;
  agent_rank_score: number;
  recommended_tier: 'A+' | 'A' | 'B' | 'C' | 'Unknown' | string;
  recommended_pitch: string;
  next_best_action: string;
  gap_summary: string;
  rel8tion_value_summary: string;
  has_open_house_this_weekend: boolean;
  has_phone: boolean;
  has_email: boolean;
  raw_sources?: Record<string, unknown>;
};

export type ProductionParseResult = {
  headers: string[];
  normalized_headers: string[];
  mapping: Record<CanonicalAgentProductionField, { index: number; source: string; confidence: number; manual: boolean }>;
  unmapped_columns: string[];
  rows: ProductionImportRow[];
  row_count: number;
  duplicate_count: number;
};

export function normalizeImportRows(csvText: string, options?: {
  market_area?: string;
  default_county?: string;
  default_market_area?: string;
  default_state?: string;
  apply_location_defaults?: boolean;
  try_county_inference?: boolean;
  column_overrides?: Partial<Record<CanonicalAgentProductionField, string>>;
}): ProductionParseResult;

export function matchImportedRows(rows: ProductionImportRow[], agents: Array<Record<string, unknown>>): ProductionImportRow[];
export function rankingFromImportRow(row: ProductionImportRow, averages?: Record<string, number>, signals?: Record<string, unknown>): AgentRanking;
export function outreachPayloadFromRanking(ranking: AgentRanking): Record<string, unknown>;
