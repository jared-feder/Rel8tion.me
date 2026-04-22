import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("FUNCTION STARTED");

    const rawAuth =
      req.headers.get("authorization") ||
      req.headers.get("Authorization") ||
      "";

    const clean = rawAuth.replace(/\s+/g, " ").trim();

    console.log("AUTH RECEIVED:", clean);

    const isCron = clean === `Bearer ${CRON_SECRET}`;
    const isJWT = clean.startsWith("Bearer eyJ");

    if (!isCron && !isJWT) {
      console.log("AUTH FAILED");
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: corsHeaders },
      );
    }

    console.log("AUTH PASSED");

    let allListings: any[] = [];

    const boxes = [
      {
        topLeft: "[-73.96,40.80]",
        bottomRight: "[-73.70,40.54]",
      },
      {
        topLeft: "[-73.80,40.92]",
        bottomRight: "[-73.40,40.55]",
      },
      {
        topLeft: "[-73.40,41.10]",
        bottomRight: "[-72.00,40.60]",
      },
    ];

    for (const box of boxes) {
      let offset = 0;
      let total = 9999;
      const limit = 100;

      while (offset < total && offset < 1000) {
        try {
          console.log("FETCHING:", box, offset);

          const res = await fetch(
            `https://www.onekeymls.com/api/search?topLeft=${box.topLeft}&bottomRight=${box.bottomRight}&propertySaleType=Sale&openHouse=true&StateOrProvince=NY&offset=${offset}`,
          );

          let data;

          try {
            data = await res.json();
          } catch {
            console.log("BAD JSON RESPONSE");
            break;
          }

          if (!data?.Results || data.Results.length === 0) break;

          allListings = allListings.concat(data.Results);

          total = data.Total || total;
          offset += limit;
        } catch (err) {
          console.log("FETCH ERROR:", err);
          break;
        }
      }
    }

    console.log("RAW pulled:", allListings.length);

    const map = new Map();

    for (const p of allListings) {
      try {
        const id = p.UniqueListingId;
        if (!id) continue;

        const lat = p.LocationPoint?.lat;
        const lng = p.LocationPoint?.lon;
        if (!lat || !lng) continue;

        const agentName =
          p.Listing?.ListAgent?.FullName ||
          p.Listing?.ListAgent?.MemberFullName ||
          p.Listing?.ListAgent?.Name ||
          p.Listing?.Agent?.FullName ||
          p.Listing?.Agent?.Name ||
          p.ListingAgentName ||
          p.ListAgentFullName ||
          p.ListAgentName ||
          null;

        const brokerage =
          p.Listing?.AgentOffice?.ListOffice?.ListOfficeName || "Unknown";

        map.set(id, {
          id,
          address: p.DisplayName || null,
          price: p.Listing?.Price?.ListPrice || null,
          beds: p.Structure?.BedroomsTotal || null,
          baths: p.Structure?.BathroomsTotalInteger || null,
          brokerage,
          agent: agentName,
          lat,
          lng,
          open_start: p.Computed?.OpenHousesEarliestStartTime || null,
          open_end: p.Computed?.OpenHousesEarliestEndTime || null,
          image:
            p.Media?.[0]?.MediaURL ||
            p.Media?.[1]?.MediaURL ||
            p.ImagesHero ||
            p.MediaURL ||
            null,
          source: "onekey",
        });
      } catch (err) {
        console.log("SKIPPED BAD LISTING:", err);
        continue;
      }
    }

    const listings = Array.from(map.values());

    console.log("DEDUPED:", listings.length);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < listings.length; i += 100) {
      const chunk = listings.slice(i, i + 100);

      try {
        console.log("UPSERTING:", chunk.length);

        const { error } = await supabase
          .from("open_houses")
          .upsert(chunk, { onConflict: "id" });

        if (error) {
          console.log("UPSERT ERROR:", error);
          failCount++;
        } else {
          successCount += chunk.length;
        }
      } catch (err) {
        console.log("CHUNK FAILED:", err);
        failCount++;
      }
    }

    console.log("QUEUEING OUTREACH CANDIDATES");

    const { error: queueError } = await supabase.rpc("queue_recent_outreach_candidates");

    if (queueError) {
      console.log("QUEUE ERROR:", queueError);
      throw queueError;
    }

    console.log("DONE:", {
      success: successCount,
      failed: failCount,
      total: listings.length,
      queued: true,
    });

    return new Response(
      JSON.stringify({
        success: true,
        inserted: successCount,
        failed: failCount,
        total: listings.length,
        queued: true,
      }),
      { status: 200, headers: corsHeaders },
    );
  } catch (err: any) {
    console.error("FATAL ERROR:", err?.message);

    return new Response(
      JSON.stringify({
        error: err?.message || "unknown",
      }),
      { status: 500, headers: corsHeaders },
    );
  }
});
