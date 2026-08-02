# REL8TION Pricing Catalog and Stripe Operations

`config/pricing-catalog.json` is the only tracked source for normal product amounts, billing intervals, trials, renewals, included features, eligibility, fulfillment, entitlements, and Stripe lookup keys.

## Public delivery

- `/api/public/pricing` returns a normalized, cacheable public view of the catalog.
- Allowed browser origins are the REL8TION, app, getrel8tion, and my.rel8tion hostnames listed in the endpoint.
- Public pages must show `Pricing is temporarily unavailable. Please try again shortly.` if the API cannot load. They must not retain embedded fallback amounts.
- The WordPress drop-in is `wordpress/pricing-section.html`. Publishing that tracked file to the live WordPress page remains a manual operation.

## Checkout

- `api/checkout/open-house-kit.js` resolves catalog lookup keys against active Stripe Prices and refuses Checkout when amount, currency, or interval differs.
- `api/checkout/plan.js` provides public REL8TION Agent checkout with catalog entitlements and no shipping collection.
- The website builder resolves Digital You and optional custom-domain Prices from the public catalog and Stripe lookup keys. It does not own a separate Complete System payment.
- Complete System orders store the plan code, entitlement codes, website/digital-card/content-tool flags, company-branded Rel8tionChips flag, brokerage, branding status, optional logo URL, preferred colors, and branding notes in Checkout metadata.
- The signed Stripe webhook upserts catalog-coded entitlements into the server-only `pricing_entitlements` ledger. `supabase/migrations/20260802100949_pricing_entitlements.sql` was applied and security-verified on linked production on 2026-08-02.
- Public Outreach Seat amounts are retired. Loan-officer programs require a private calendar consultation and an approved private proposal; they are excluded from `/api/public/pricing` and the Stripe synchronization loop.
- Sponsored Event Pass amounts remain internal-only. The restricted amount is never selected from a browser discount flag and still requires server-side verification of an active eligible Outreach Seat.

## Private booking calendar

- `/book-a-call?type=loan_officer` is the private loan-officer consultation path.
- `/book-a-call?type=broker_team` is the real estate broker/team discount consultation path.
- `config/booking-calendar.json` defines the Eastern Time schedule, duration, notice window, call types, and notification recipient.
- `/api/bookings/availability` returns open slots only after reading confirmed reservations through the service role.
- `/api/bookings/create` revalidates the selected slot, inserts atomically against the confirmed-start unique index, and sends calendar invitations through REL8TION SMTP, with Resend retained as a fallback.
- `supabase/migrations/20260802140923_rel8tion_call_bookings.sql` was applied and security-verified on linked production on 2026-08-02. Browser roles intentionally have no access to the booking table.
- Production requires `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, and a verified `REL8TION_FROM_EMAIL` or `RESEND_FROM_EMAIL`. `BOOKING_IP_HASH_SECRET` is optional but recommended for one-way request fingerprints.

## Stripe synchronization

Set `STRIPE_SECRET_KEY` in the shell without printing it, then run:

```powershell
npm run pricing:stripe:dry-run
npm run pricing:stripe:apply
npm run pricing:stripe:dry-run
```

The sync script:

- reuses a correct active Price;
- creates Products only when a catalog-coded Product is missing;
- creates replacement Prices when amount, currency, or interval differs;
- verifies a replacement before deactivating an old Price for new sales;
- never deletes Stripe objects or migrates/cancels existing subscriptions;
- prints only safe Product/Price IDs and change summaries;
- exits nonzero when application or final verification fails.

Existing subscriptions remain on their historical Prices until a separately approved migration is designed and executed.

## Verification

Run:

```powershell
npm run verify:routes
npm run verify:pricing
npm run verify:kit-pricing
npm run verify:booking
```

For the website builder, also run its lint, build, and agent-auth route verification before deployment.
