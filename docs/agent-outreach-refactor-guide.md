# Agent Outreach Refactor Guide

This document captures the current state of the outreach pipeline, what has already been changed in the Vercel renderer app, and the exact Supabase-side changes needed to finish the pipeline around the Sharp-based Vercel mockup generator.

## Copy-Paste Files In This Repo

To make the final rollout easier, this repo now also includes ready-to-paste files:

- [`docs/supabase-functions/generate-agent-outreach.ts`](</c:/Dev/GitHub/Rel8tion.me/docs/supabase-functions/generate-agent-outreach.ts:1>)
- [`docs/supabase-functions/trigger-agent-mockups.ts`](</c:/Dev/GitHub/Rel8tion.me/docs/supabase-functions/trigger-agent-mockups.ts:1>)
- [`docs/supabase-functions/send-agent-outreach.ts`](</c:/Dev/GitHub/Rel8tion.me/docs/supabase-functions/send-agent-outreach.ts:1>)
- [`docs/hot-list-elementor.html`](</c:/Dev/GitHub/Rel8tion.me/docs/hot-list-elementor.html:1>)

Those files are meant to be copied into Supabase / Elementor with minimal editing.

## What Is Already Done

The Vercel `mockup-renderer` project has already been updated and deployed to:

- restore the Sharp renderer
- fix ESM import resolution in production
- harden the render endpoint with auth
- switch the composition to use the foreground sign overlay instead of the circular agent avatar
- align the renderer with the real outreach queue states
- support manual rerenders by `id`

### Current Vercel Renderer Behavior

The render endpoint is:

- `POST /api/render-agent-mockup`

It now expects rows in `agent_outreach_queue` with:

- `generation_status = "generated"`
- `send_status = "not_sent"`
- `mockup_image_url IS NULL` unless `force: true` is passed

It accepts bodies shaped like:

```json
{ "limit": 10 }
```

```json
{ "ids": ["queue-row-uuid"], "force": true }
```

It writes:

- `mockup_image_url`
- `mockup_status`
- `mockup_rendered_at`
- `mockup_render_attempted_at`
- `mockup_render_error`
- `mockup_error`

## Final Target Pipeline

1. A new open-house row lands in `agent_outreach_queue`.
2. Enrichment fills in agent name and phone.
3. `generate-agent-outreach` creates the SMS drafts and scheduling metadata.
4. A Supabase wrapper function calls the Vercel Sharp renderer.
5. The renderer stores the uploaded JPG in Supabase Storage and writes `mockup_image_url`.
6. `rel8tion.me/hot-list` shows the real stored mockup, not a fake browser preview.
7. Jared edits and approves the copy on the hot-list page.
8. The send function delivers the initial and follow-up SMS on schedule.

## Architecture Decision

Use the Vercel Sharp renderer as the only image generator.

That means:

- retire the Supabase ImageScript mockup generator
- stop storing `image_prompt` as if it were the real render input
- stop building a fake overlay preview in the hot-list HTML block

## Recommended Supabase Edge Functions

### 1. `generate-agent-outreach`

Purpose:

- build message variants
- build follow-up copy
- set queue state to renderer-ready

Key changes from the current version:

- fix the missing `followup` value
- stop treating image generation as prompt-only
- set `generation_status = "generated"`
- set `mockup_status = "pending"`
- initialize send scheduling fields

Suggested implementation:

```ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type QueueRow = {
  id: string;
  agent_first_name: string | null;
  agent_name: string | null;
  agent_phone: string | null;
  brokerage: string | null;
  address: string | null;
  open_start: string | null;
  open_end: string | null;
  listing_photo_url: string | null;
};

function normalizePhone(phone: string | null): string {
  if (!phone) return "";
  return phone.replace(/\D/g, "");
}

function firstNameSafe(name: string | null): string {
  if (!name?.trim()) return "there";
  return name.trim().split(/\s+/)[0];
}

function shortAddress(address: string | null): string {
  if (!address?.trim()) return "your open house";
  return address.replace(/,\s*NY\s+\d{5}$/i, "").trim();
}

function formatOpenHouse(openStart: string | null): string {
  if (!openStart) return "this weekend";

  try {
    const dt = new Date(openStart);

    const day = dt.toLocaleDateString("en-US", {
      weekday: "long",
      timeZone: "America/New_York",
    });

    const time = dt.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/New_York",
    }).replace(":00", "");

    return `${day} at ${time}`;
  } catch {
    return "this weekend";
  }
}

function buildSmsLink(phone: string, body: string) {
  const clean = normalizePhone(phone);
  return `sms:${clean}?body=${encodeURIComponent(body)}`;
}

function computeInitialSendAt(): string {
  return new Date().toISOString();
}

function computeFollowupSendAt(openStart: string | null, initialSendAt: string): string | null {
  if (!openStart) return null;

  const openStartDate = new Date(openStart);
  const initialDate = new Date(initialSendAt);
  const followupDate = new Date(openStartDate.getTime() - 2 * 60 * 60 * 1000);

  if (Number.isNaN(openStartDate.getTime()) || Number.isNaN(followupDate.getTime())) {
    return null;
  }

  if (followupDate <= initialDate) {
    return null;
  }

  return followupDate.toISOString();
}

function buildVariants(row: QueueRow) {
  const firstName = firstNameSafe(row.agent_first_name || row.agent_name);
  const when = formatOpenHouse(row.open_start);
  const addr = shortAddress(row.address);

  const v1 =
    `Hey ${firstName} 👋 Jared here. I saw your open house at ${addr} ${when} and wanted to reach out. ` +
    `I’d love to stop by, support you, and help prequal buyers if needed. ` +
    `I’ve been doing this 27 years and know how to help make deals happen, so it’d be great to meet you for a few minutes — no pressure if you already have someone. ` +
    `Also, I’m picking a few local beta agents for Rel8tion. If you’re open to it, I’ll make you a custom sign and you’ll get the service free for life as one of my first agents.`;

  const v2 =
    `Hey ${firstName} 👋 Jared here. I noticed your open house at ${addr} ${when}. ` +
    `Would love to stop by, support you, and help prequal buyers if useful. ` +
    `I’ve been in this business 27 years, so I know how to help make deals happen. No pressure at all if you already work with someone. ` +
    `On a separate note, I’m looking for a few beta agents for Rel8tion, and early agents get a custom sign plus free service for life.`;

  const v3 =
    `Hey ${firstName} 👋 Jared here. I saw your open house at ${addr} ${when}. ` +
    `I’d love to stop by, support you, and help with any buyers that need prequal help. ` +
    `I’ve been doing this 27 years and love helping agents get deals done smoothly. ` +
    `Also looking for a few local beta agents for Rel8tion. If you’re open, I’ll make you a custom sign and you’ll have the service free for life.`;

  const followup =
    `Hey ${firstName} — just circling back before ${addr}. ` +
    `If you’re open, I’d still love to stop by, support the open house, and show you the custom Rel8tion sign I made for your listing.`;

  return { v1, v2, v3, selected: v1, followup };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(Number(body.limit || 25), 200));

    const { data: rows, error: fetchError } = await supabase
      .from("agent_outreach_queue")
      .select(
        "id, agent_first_name, agent_name, agent_phone, brokerage, address, open_start, open_end, listing_photo_url",
      )
      .eq("enrichment_status", "ready")
      .eq("generation_status", "pending")
      .eq("send_status", "not_sent")
      .order("open_start", { ascending: true })
      .limit(limit);

    if (fetchError) throw fetchError;

    if (!rows || rows.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, processed: 0, message: "No pending outreach rows found." }, null, 2),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const results: Array<{ id: string; ok: boolean; error?: string }> = [];

    for (const row of rows as QueueRow[]) {
      try {
        if (!row.agent_phone) {
          const { error } = await supabase
            .from("agent_outreach_queue")
            .update({
              generation_status: "failed",
              last_error: "Missing agent phone",
            })
            .eq("id", row.id);

          if (error) throw error;

          results.push({ id: row.id, ok: false, error: "Missing agent phone" });
          continue;
        }

        const { v1, v2, v3, selected, followup } = buildVariants(row);
        const initialSendAt = computeInitialSendAt();
        const followupSendAt = computeFollowupSendAt(row.open_start, initialSendAt);

        const { error: updateError } = await supabase
          .from("agent_outreach_queue")
          .update({
            sms_variant_1: v1,
            sms_variant_2: v2,
            sms_variant_3: v3,
            selected_sms: selected,
            followup_sms: followup,
            sms_link: buildSmsLink(row.agent_phone, selected),
            followup_sms_link: buildSmsLink(row.agent_phone, followup),
            generation_status: "generated",
            review_status: "pending",
            mockup_status: "pending",
            mockup_error: null,
            send_error: null,
            last_error: null,
            approved_for_send: false,
            send_mode: "automatic",
            initial_send_at: initialSendAt,
            followup_send_at: followupSendAt,
            initial_send_status: "pending",
            followup_send_status: followupSendAt ? "pending" : "not_scheduled",
            initial_block_reason: null,
            followup_block_reason: followupSendAt ? null : "followup_not_scheduled",
          })
          .eq("id", row.id);

        if (updateError) throw updateError;

        results.push({ id: row.id, ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        await supabase
          .from("agent_outreach_queue")
          .update({
            generation_status: "failed",
            last_error: message,
          })
          .eq("id", row.id);

        results.push({ id: row.id, ok: false, error: message });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, processed: results.length, results }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
```

### 2. `trigger-agent-mockups`

Purpose:

- call the Vercel Sharp renderer from Supabase
- keep the render secret off the browser
- support manual rerenders

Suggested implementation:

```ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const renderUrl =
      Deno.env.get("VERCEL_RENDER_URL") || "https://mockup-renderer-psi.vercel.app/api/render-agent-mockup";
    const sharedSecret = Deno.env.get("CRON_SHARED_SECRET");

    if (!renderUrl || !sharedSecret) {
      throw new Error("Missing VERCEL_RENDER_URL or CRON_SHARED_SECRET");
    }

    const body = await req.json().catch(() => ({}));

    const response = await fetch(renderUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": sharedSecret,
      },
      body: JSON.stringify({
        limit: body.limit || 25,
        ids: Array.isArray(body.ids) ? body.ids : undefined,
        force: Boolean(body.force),
      }),
    });

    const text = await response.text();

    return new Response(text, {
      status: response.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
```

### 3. Retire the Supabase ImageScript Mockup Function

Do not keep both renderers alive. The ImageScript mockup generator should be removed or disabled once the wrapper above is in place.

Reason:

- it creates a second image source of truth
- it produces a different composition than the Vercel renderer
- it increases debugging complexity

### 4. `send-agent-outreach`

Your send function is mostly structurally okay, but it should only send rows that are actually render-complete.

Recommended query additions:

```ts
      .eq("mockup_status", "rendered")
      .eq("generation_status", "generated")
```

Recommended select additions if not already present:

```ts
mockup_status,
generation_status,
review_status,
```

That way your send function never tries to send something that still lacks a final mockup.

## Hot-List Changes

The hot-list page is currently confusing because it is doing too much in the browser and faking the mockup preview when `mockup_image_url` is empty.

### What To Change

1. Remove the browser-side fake composition:

- remove `JARED_SIGN_PNG`
- remove the listing-photo-plus-overlay fallback from `renderCardImage()`
- only show the real stored `mockup_image_url`

Replace `renderCardImage()` with:

```js
function renderCardImage(row){
  if (row.mockup_image_url) {
    return `
      <div class="relative w-full h-[300px] rounded-2xl overflow-hidden bg-slate-100">
        <img
          src="${esc(row.mockup_image_url)}"
          class="absolute inset-0 w-full h-full object-cover"
          alt="Mockup"
        >
      </div>
    `;
  }

  return `
    <div class="relative w-full h-[300px] rounded-2xl overflow-hidden bg-[radial-gradient(circle_at_top_left,_#f3f5ff,_#eef2ff_35%,_#ffffff_75%)] border border-slate-200">
      <div class="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
        <div class="text-sm font-semibold text-slate-900">Mockup Not Ready</div>
        <div class="text-xs text-slate-500 mt-2">Status: ${esc(row.mockup_status || "pending")}</div>
      </div>
    </div>
  `;
}
```

2. Make the generate button trigger both steps:

Replace `generatePending()` with:

```js
async function generatePending(){
  const generateRes = await fetch(`${SUPABASE_URL}/functions/v1/generate-agent-outreach`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify({ limit: 200 })
  });

  const generateData = await generateRes.json();

  if(!generateRes.ok){
    alert(generateData.error || "Failed to generate outreach.");
    return;
  }

  const renderRes = await fetch(`${SUPABASE_URL}/functions/v1/trigger-agent-mockups`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify({ limit: 200 })
  });

  const renderData = await renderRes.json();

  if(!renderRes.ok){
    alert(renderData.error || "Generated texts, but mockup rendering failed.");
    return;
  }

  await loadRows();
}
```

3. Rename the button:

Change:

```html
Generate Pending
```

To:

```html
Generate + Render Pending
```

4. Remove the old prompt display block:

Delete the `row.image_prompt` UI block, since the Sharp renderer is now the image source of truth.

## Enhancements Included In This Refactor

### Already Live In Vercel

- Sharp-based render pipeline restored
- production import path fixes
- renderer auth protection
- foreground sign overlay composition
- renderer contract aligned to `generation_status = generated`
- manual rerender support via `ids` and `force`

### To Finish On Supabase

- fixed follow-up message generation
- one canonical renderer
- browser no longer fabricates a fake preview
- text generation and rendering become one admin action
- send logic respects render completion

## Recommended Rollout Order

1. Update `generate-agent-outreach`
2. Add `trigger-agent-mockups`
3. Disable or remove the ImageScript mockup function
4. Update the hot-list HTML block
5. Add the `mockup_status = rendered` filter to the send function
6. Test one row end-to-end

## Test Checklist

Use one known queue row and verify:

1. `generate-agent-outreach` writes:
   - SMS variants
   - `followup_sms`
   - `generation_status = generated`
   - `mockup_status = pending`
2. `trigger-agent-mockups` returns success
3. the Vercel renderer writes:
   - `mockup_image_url`
   - `mockup_status = rendered`
4. the hot-list page shows the real mockup image
5. approving the row allows the send function to pick it up
6. the send function writes Twilio SID fields after delivery
