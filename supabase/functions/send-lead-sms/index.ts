import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    const {
      agent_phone,
      buyer_phone,
      buyer_name,
      areas,
      price,
      preapproved,
      message,
    } = body;

    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const from = Deno.env.get("TWILIO_PHONE");
    const yourPhone = Deno.env.get("YOUR_PHONE");

    const auth = btoa(`${accountSid}:${authToken}`);

    // Direct message mode, used for agent access links and other one-off SMS.
    if (message) {
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          From: from || "",
          To: agent_phone,
          Body: message,
        }),
      });

      return new Response(
        JSON.stringify({ success: true, mode: "direct_message" }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // Agent SMS, lead mode.
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: from || "",
        To: agent_phone,
        Body: `🔥 HOT BUYER LEAD

${buyer_name}
${buyer_phone}

Looking in: ${areas}
Budget: ${price}

${preapproved === "no" ? "🚨 NOT pre-approved — opportunity for financing" : "✅ Already pre-approved"}

Call NOW — timing matters.`,
      }),
    });

    // Buyer SMS.
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: from || "",
        To: buyer_phone,
        Body: `Hey ${buyer_name}, we got your request. Your agent will reach out shortly. 🚀

- Rel8tion

Reply STOP to opt out.`,
      }),
    });

    // Owner alert for financing opportunities.
    if (preapproved === "no") {
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          From: from || "",
          To: yourPhone || "",
          Body: `🚨 HOT OPPORTUNITY
${buyer_name}
${buyer_phone}

Areas: ${areas}
Price: ${price}

🚨 Call Now & Own The Deal!`,
        }),
      });
    }

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
});
