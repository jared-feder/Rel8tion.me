import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type SmsCategory =
  | "buyer_confirmation"
  | "agent_checkin_alert"
  | "loan_officer_alert"
  | "buyer_loan_officer_intro"
  | "event_chat_buyer_alert"
  | "event_chat_loan_officer_alert"
  | "owner_fallback_alert"
  | "event_transactional"
  | "outreach"
  | "outreach_followup"
  | "demo_request"
  | "manual_outreach";

type SmsRoute = "events" | "outreach";
type SmsProvider = "twilio" | "android_gateway";

type SendSmsOptions = {
  to: string;
  body: string;
  category?: SmsCategory | string;
  metadata?: Record<string, unknown>;
  mediaUrls?: string[];
  providerOverride?: SmsProvider | string;
  statusCallback?: string;
  supabase?: any;
};

type SmsLogEntry = {
  provider: string;
  route?: string | null;
  category?: string | null;
  to_phone: string;
  body?: string | null;
  status: "queued" | "sent" | "failed" | "blocked";
  external_id?: string | null;
  device_id?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown>;
};

const EVENT_CATEGORIES = new Set([
  "buyer_confirmation",
  "agent_checkin_alert",
  "loan_officer_alert",
  "buyer_loan_officer_intro",
  "event_chat_buyer_alert",
  "event_chat_loan_officer_alert",
  "owner_fallback_alert",
  "event_transactional",
]);

const OUTREACH_CATEGORIES = new Set([
  "outreach",
  "outreach_followup",
  "demo_request",
  "manual_outreach",
]);

export class SmsSendError extends Error {
  code: string;
  status: "failed" | "blocked";
  provider: string;
  route: string | null;

  constructor(message: string, options: {
    code?: string;
    status?: "failed" | "blocked";
    provider?: string;
    route?: string | null;
  } = {}) {
    super(message);
    this.name = "SmsSendError";
    this.code = options.code || "sms_failed";
    this.status = options.status || "failed";
    this.provider = options.provider || providerName();
    this.route = options.route || null;
  }
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeProvider(value: unknown, fallback: SmsProvider = "twilio"): SmsProvider {
  const normalized = clean(value).toLowerCase();
  if (normalized === "android_gateway") return "android_gateway";
  if (normalized === "twilio") return "twilio";
  return fallback;
}

function providerName(): SmsProvider {
  return normalizeProvider(Deno.env.get("SMS_PROVIDER"), "twilio");
}

function providerForRoute(route: SmsRoute, providerOverride?: SmsProvider | string): SmsProvider {
  const override = route === "outreach"
    ? Deno.env.get("SMS_OUTREACH_PROVIDER")
    : Deno.env.get("SMS_EVENTS_PROVIDER");
  return normalizeProvider(providerOverride, normalizeProvider(override, providerName()));
}

export function normalizePhoneDigits(phone: string | null | undefined): string {
  const digits = clean(phone).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export function toE164(phone: string | null | undefined): string {
  const original = clean(phone);
  const digits = original.replace(/\D/g, "");
  if (!digits) return "";
  if (original.startsWith("+") && digits.length >= 10) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

function smsClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key);
}

function routeForCategory(category: string): SmsRoute {
  const normalized = clean(category || "event_transactional").toLowerCase();
  if (OUTREACH_CATEGORIES.has(normalized)) return "outreach";
  if (EVENT_CATEGORIES.has(normalized)) return "events";
  throw new SmsSendError(`Unsupported SMS category: ${category}`, {
    code: "sms_unsupported_category",
    status: "blocked",
  });
}

function isSuppressionBypassed(category: string, metadata: Record<string, unknown> = {}): boolean {
  return category === "owner_fallback_alert" || metadata.internal_operational_alert === true;
}

export function isQuietHoursNY(date = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  }).format(date));
  const minute = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    minute: "numeric",
  }).format(date));
  const minutes = hour * 60 + minute;
  return minutes >= 21 * 60 || minutes < 8 * 60;
}

function ensureOutreachStopText(body: string): string {
  if (/reply\s+STOP\s+to\s+opt\s+out\.?/i.test(body)) return body;
  return `${body.trim()}\n\nReply STOP to opt out.`;
}

async function logSmsAttempt(supabase: any, entry: SmsLogEntry) {
  if (!supabase) return;
  try {
    await supabase.from("sms_message_log").insert({
      provider: entry.provider,
      route: entry.route || null,
      category: entry.category || null,
      to_phone: entry.to_phone,
      body: entry.body || null,
      status: entry.status,
      external_id: entry.external_id || null,
      device_id: entry.device_id || null,
      error: entry.error || null,
      metadata: entry.metadata || {},
    });
  } catch (error) {
    console.error("[sms] log insert failed", error);
  }
}

async function isSuppressed(supabase: any, phone: string): Promise<boolean> {
  if (!supabase || !phone) return false;
  try {
    const { data, error } = await supabase
      .from("sms_suppression_list")
      .select("id, provider")
      .eq("phone", phone)
      .limit(1);
    if (error) {
      throw error;
    }
    return Boolean(data?.length);
  } catch (error) {
    console.error("[sms] suppression lookup failed", error);
    throw new SmsSendError("sms_suppression_check_failed: Unable to verify recipient opt-out status", {
      code: "sms_suppression_check_failed",
      status: "blocked",
    });
  }
}

function androidConfig(route: SmsRoute) {
  const prefix = route === "outreach" ? "ANDROID_OUTREACH" : "ANDROID_EVENTS";
  return {
    baseUrl: clean(Deno.env.get(`${prefix}_GATEWAY_URL`) || "https://api.sms-gate.app").replace(/\/$/, ""),
    username: clean(Deno.env.get(`${prefix}_GATEWAY_USERNAME`)),
    password: clean(Deno.env.get(`${prefix}_GATEWAY_PASSWORD`)),
    deviceId: clean(Deno.env.get(`${prefix}_GATEWAY_DEVICE_ID`)),
  };
}

function androidMessagesUrl(baseUrl: string): string {
  const base = clean(baseUrl || "https://api.sms-gate.app").replace(/\/$/, "");
  if (/\/3rdparty\/v1\/messages$/i.test(base)) return base;
  if (/\/3rdparty\/v1\/message$/i.test(base)) return `${base}s`;
  if (/\/3rdparty\/v1$/i.test(base)) return `${base}/messages`;
  return `${base}/3rdparty/v1/messages`;
}

async function sendViaAndroidGateway(opts: {
  route: SmsRoute;
  to: string;
  body: string;
}) {
  const config = androidConfig(opts.route);
  if (!config.username || !config.password || !config.deviceId) {
    throw new SmsSendError(`Missing Android ${opts.route} gateway credentials or device id`, {
      code: "sms_android_config_missing",
      route: opts.route,
    });
  }

  const response = await fetch(androidMessagesUrl(config.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${config.username}:${config.password}`)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      phoneNumbers: [opts.to],
      textMessage: { text: opts.body },
      deviceId: config.deviceId,
    }),
  });

  const raw = await response.text().catch(() => "");
  let data: Record<string, unknown> = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }

  if (!response.ok) {
    const message = clean(data.message || data.error || raw) || `Android SMS Gateway error ${response.status}`;
    throw new SmsSendError(message, {
      code: "sms_android_gateway_failed",
      route: opts.route,
    });
  }

  const externalId = clean(
    data.id || data.messageId || data.message_id || data.uuid || data.requestId || data.request_id,
  );
  const providerStatus = clean(data.status || data.state || "sent").toLowerCase() || "sent";

  if (/fail|error|reject|cancel|undeliver/.test(providerStatus)) {
    throw new SmsSendError(clean(data.message || data.error || raw) || `Android SMS Gateway status: ${providerStatus}`, {
      code: "sms_android_gateway_failed",
      route: opts.route,
    });
  }

  return {
    provider: "android_gateway",
    route: opts.route,
    status: providerStatus,
    externalId: externalId || null,
    deviceId: config.deviceId,
    raw: data,
  };
}

async function sendViaTwilio(opts: {
  route: SmsRoute;
  to: string;
  body: string;
  mediaUrls?: string[];
  statusCallback?: string;
}) {
  const accountSid = clean(Deno.env.get("TWILIO_ACCOUNT_SID"));
  const authToken = clean(Deno.env.get("TWILIO_AUTH_TOKEN"));
  const routePrefix = opts.route === "outreach" ? "TWILIO_OUTREACH" : "TWILIO_EVENTS";
  const routeMessagingServiceSid = clean(Deno.env.get(`${routePrefix}_MESSAGING_SERVICE_SID`));
  const routeFrom = clean(Deno.env.get(`${routePrefix}_FROM_NUMBER`));
  const dedicatedOutreachSenderRequired = opts.route === "outreach" &&
    clean(Deno.env.get("SMS_OUTREACH_PROVIDER")).toLowerCase() === "twilio";
  const messagingServiceSid = clean(
    routeMessagingServiceSid ||
      (!dedicatedOutreachSenderRequired ? Deno.env.get("TWILIO_MESSAGING_SERVICE_SID") : ""),
  );
  const configuredFrom = clean(
    routeFrom ||
      (!dedicatedOutreachSenderRequired
        ? Deno.env.get("TWILIO_FROM_NUMBER") || Deno.env.get("TWILIO_PHONE")
        : ""),
  );

  if (!accountSid || !authToken || (!messagingServiceSid && !configuredFrom)) {
    throw new SmsSendError(`Missing Twilio credentials or ${opts.route} sender`, {
      code: "sms_twilio_config_missing",
      provider: "twilio",
      route: opts.route,
    });
  }

  const form = new URLSearchParams();
  if (messagingServiceSid) {
    form.set("MessagingServiceSid", messagingServiceSid);
  } else {
    form.set("From", configuredFrom);
  }
  form.set("To", opts.to);
  form.set("Body", opts.body);
  if (opts.statusCallback) form.set("StatusCallback", opts.statusCallback);
  for (const mediaUrl of opts.mediaUrls || []) {
    if (mediaUrl) form.append("MediaUrl", mediaUrl);
  }

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new SmsSendError(clean(data?.message) || `Twilio error ${response.status}`, {
      code: "sms_twilio_failed",
      provider: "twilio",
      route: opts.route,
    });
  }

  const from = clean(data.from || configuredFrom);

  return {
    provider: "twilio",
    route: opts.route,
    status: clean(data.status || "queued").toLowerCase() || "queued",
    externalId: clean(data.sid) || null,
    from: from || null,
    messagingServiceSid: messagingServiceSid || null,
    raw: data,
  };
}

export async function sendSMS(options: SendSmsOptions) {
  const category = clean(options.category || "event_transactional").toLowerCase();
  const metadata = options.metadata || {};
  const route = routeForCategory(category);
  const provider = providerForRoute(route, options.providerOverride);
  const supabase = options.supabase || smsClient();
  const to = toE164(options.to);
  const routeLabel = route;
  let body = clean(options.body);

  if (!to) {
    await logSmsAttempt(supabase, {
      provider,
      route: routeLabel,
      category,
      to_phone: clean(options.to),
      body,
      status: "blocked",
      error: "Missing or invalid recipient phone",
      metadata,
    });
    throw new SmsSendError("Missing or invalid recipient phone", {
      code: "sms_invalid_phone",
      status: "blocked",
      provider,
      route: routeLabel,
    });
  }

  if (route === "outreach") {
    if (isQuietHoursNY()) {
      await logSmsAttempt(supabase, {
        provider,
        route: routeLabel,
        category,
        to_phone: to,
        body,
        status: "blocked",
        error: "sms_quiet_hours: Outreach blocked from 9 PM to 8 AM America/New_York",
        metadata,
      });
      throw new SmsSendError("sms_quiet_hours: Outreach blocked from 9 PM to 8 AM America/New_York", {
        code: "sms_quiet_hours",
        status: "blocked",
        provider,
        route: routeLabel,
      });
    }
    body = ensureOutreachStopText(body);
  }

  if (!isSuppressionBypassed(category, metadata)) {
    try {
      if (await isSuppressed(supabase, to)) {
        await logSmsAttempt(supabase, {
          provider,
          route: routeLabel,
          category,
          to_phone: to,
          body,
          status: "blocked",
          error: "sms_suppressed: Recipient is on the global SMS suppression list",
          metadata,
        });
        throw new SmsSendError("sms_suppressed: Recipient is on the global SMS suppression list", {
          code: "sms_suppressed",
          status: "blocked",
          provider,
          route: routeLabel,
        });
      }
    } catch (error) {
      if (error instanceof SmsSendError && error.code === "sms_suppressed") throw error;
      const message = error instanceof Error ? error.message : String(error);
      await logSmsAttempt(supabase, {
        provider,
        route: routeLabel,
        category,
        to_phone: to,
        body,
        status: "blocked",
        error: message,
        metadata,
      });
      throw error;
    }
  }

  try {
    const result = provider === "android_gateway"
      ? await sendViaAndroidGateway({ route, to, body })
      : await sendViaTwilio({
        route,
        to,
        body,
        mediaUrls: options.mediaUrls,
        statusCallback: options.statusCallback,
      });

    const status = result.provider === "twilio" && result.status !== "sent" ? "queued" : "sent";
    await logSmsAttempt(supabase, {
      provider,
      route: routeLabel,
      category,
      to_phone: to,
      body,
      status,
      external_id: result.externalId,
      device_id: "deviceId" in result ? result.deviceId : null,
      metadata: {
        ...metadata,
        provider_status: result.status,
        media_urls: options.mediaUrls || [],
      },
    });

    return {
      ok: true,
      provider,
      route: routeLabel,
      status: result.status,
      externalId: result.externalId,
      sid: result.externalId,
      deviceId: "deviceId" in result ? result.deviceId : null,
      from: "from" in result ? result.from : null,
      body,
      raw: result.raw,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logSmsAttempt(supabase, {
      provider,
      route: routeLabel,
      category,
      to_phone: to,
      body,
      status: error instanceof SmsSendError && error.status === "blocked" ? "blocked" : "failed",
      error: message,
      metadata,
    });
    throw error;
  }
}
