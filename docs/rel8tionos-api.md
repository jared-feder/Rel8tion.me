# Rel8tionOS Server API

REL8TION exposes a private, server-to-server API so Rel8tionOS can display outreach conversations and safely trigger the same reply, Open House acceptance, and loan-officer assignment workflows used by REL8TION COMMAND.

## Connection

Base URL:

```text
https://app.rel8tion.me/api/rel8tionos
```

Every request requires the shared secret in an HTTP header:

```http
Authorization: Bearer <REL8TION_API_KEY>
```

The key must exist only in server-side environment variables. Never expose it as a browser variable, include it in client JavaScript, or prefix it with `NEXT_PUBLIC_`.

Configure the Rel8tionOS server with:

```text
REL8TION_API_BASE_URL=https://app.rel8tion.me/api/rel8tionos
REL8TION_API_KEY=<the same sensitive value stored by REL8TION as REL8TIONOS_API_KEY>
```

REL8TION accepts the current `REL8TIONOS_API_KEY` and an optional `REL8TIONOS_API_PREVIOUS_KEY` during controlled key rotation.

## Endpoints

### Health

```http
GET /health
```

Returns `200` only when authentication succeeds and the server can read the outreach data source.

### Conversation list

```http
GET /threads?filter=needs_reply&limit=40&cursor=2026-07-15T12:00:00.000Z
```

Supported filters are `all`, `inbound`, `needs_reply`, `interested`, and `opt_out`. Only conversations linked to a REL8TION outreach queue row are returned.

### Conversation detail

```http
GET /messages?thread_id=<queue-row-uuid>
```

Returns the property/agent context, the ordered message history, and any linked Open House field assignment.

### Send a reply

```http
POST /reply
Content-Type: application/json

{
  "thread_id": "<queue-row-uuid>",
  "body": "Thanks for getting back to us.",
  "idempotency_key": "conversation-id:local-message-id"
}
```

An idempotency key is required so a retried application request does not intentionally send the same SMS twice. The reply still passes through REL8TION's live opt-out, suppression, provider-routing, and quiet-hours controls. A manual reply during quiet hours is allowed only when it responds to an inbound message received within the prior 24 hours.

### Accept an Open House

```http
POST /open-house
Content-Type: application/json

{
  "thread_id": "<queue-row-uuid>",
  "loan_officer_uid": "<optional-verified-profile-uuid>"
}
```

This uses the same Open House acceptance workflow as REL8TION COMMAND and returns the linked field visit/event identifiers.

### List or assign loan officers

```http
GET /loan-officers
```

```http
POST /loan-officers
Content-Type: application/json

{
  "event_id": "<open-house-event-uuid>",
  "loan_officer_uid": "<verified-profile-uuid>"
}
```

## Rel8tionOS server example

The browser should call a Rel8tionOS-owned server route. That server route then calls REL8TION:

```js
const response = await fetch(
  `${process.env.REL8TION_API_BASE_URL}/threads?filter=needs_reply&limit=40`,
  {
    headers: {
      Authorization: `Bearer ${process.env.REL8TION_API_KEY}`,
      Accept: 'application/json'
    },
    cache: 'no-store'
  }
);

if (!response.ok) throw new Error(`REL8TION API failed: ${response.status}`);
const data = await response.json();
```

All responses include `api_version`, `request_id`, and `ok`. Responses are marked `Cache-Control: no-store`.

## Operational safeguards

- Keep the shared key server-only and store it as a sensitive Vercel environment variable.
- Use a unique, stable idempotency key for each intended outbound reply.
- Treat `409` as a business-rule block such as opt-out or quiet hours, not as a transient retry.
- Log `request_id`, not the API key, when troubleshooting.
- Do not bypass REL8TION's existing send function; it is the enforcement point for opt-out, suppression, routing, and quiet-hour safety.
