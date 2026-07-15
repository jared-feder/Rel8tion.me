import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { sendSMS } from "../_shared/sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function hotLeadAgentBody(opts: {
  buyerName: string;
  buyerPhone: string;
  areas: string;
  price: string;
  preapproved: string;
}) {
  return `HOT BUYER LEAD

${opts.buyerName}
${opts.buyerPhone}

Looking in: ${opts.areas}
Budget: ${opts.price}

${opts.preapproved === "no" ? "NOT pre-approved - opportunity for financing" : "Already pre-approved"}

Call now - timing matters.`;
}

function buyerAcknowledgementBody(buyerName: string) {
  return `Hey ${buyerName}, we got your request. Your agent will reach out shortly.

- Rel8tion

Reply STOP to opt out.`;
}

function ownerFinancingBody(opts: {
  buyerName: string;
  buyerPhone: string;
  areas: string;
  price: string;
}) {
  return `HOT OPPORTUNITY
${opts.buyerName}
${opts.buyerPhone}

Areas: ${opts.areas}
Price: ${opts.price}

Call now and own the deal.`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const {
      agent_phone,
      buyer_phone,
      buyer_name,
      areas,
      price,
      preapproved,
      message,
      category,
      metadata,
      media_urls,
    } = body;

    const buyerName = clean(buyer_name) || "Buyer";
    const buyerPhone = clean(buyer_phone);
    const agentPhone = clean(agent_phone);
    const yourPhone = clean(Deno.env.get("YOUR_PHONE") || Deno.env.get("REL8TION_OWNER_ALERT_PHONE"));
    const results: Array<Record<string, unknown>> = [];

    if (message) {
      const mediaUrls = (Array.isArray(media_urls) ? media_urls : [])
        .map((value) => clean(value))
        .filter((value) => /^https:\/\//i.test(value))
        .slice(0, 10);
      const sms = await sendSMS({
        to: agentPhone,
        body: clean(message),
        category: clean(category) || "event_transactional",
        mediaUrls,
        metadata: {
          mode: "direct_message",
          ...(metadata && typeof metadata === "object" ? metadata : {}),
        },
      });

      return new Response(
        JSON.stringify({ success: true, mode: "direct_message", sms }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (agentPhone) {
      results.push(await sendSMS({
        to: agentPhone,
        body: hotLeadAgentBody({
          buyerName,
          buyerPhone,
          areas: clean(areas) || "Open House Visitor",
          price: clean(price),
          preapproved: clean(preapproved),
        }),
        category: clean(category) || "agent_checkin_alert",
        metadata: { mode: "lead_agent_alert" },
      }));
    }

    if (buyerPhone) {
      results.push(await sendSMS({
        to: buyerPhone,
        body: buyerAcknowledgementBody(buyerName),
        category: "buyer_confirmation",
        metadata: { mode: "buyer_acknowledgement" },
      }));
    }

    if (clean(preapproved) === "no" && yourPhone) {
      results.push(await sendSMS({
        to: yourPhone,
        body: ownerFinancingBody({
          buyerName,
          buyerPhone,
          areas: clean(areas) || "Open House Visitor",
          price: clean(price),
        }),
        category: "owner_fallback_alert",
        metadata: { mode: "owner_financing_alert", internal_operational_alert: true },
      }));
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
