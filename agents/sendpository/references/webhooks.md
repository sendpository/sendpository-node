# Webhooks: delivery events and received mail

Sendpository POSTs JSON to your endpoint when something happens to a message.
Endpoints are added under **Webhooks** in the dashboard (or `POST /webhooks`
with a `full_access` key). Each endpoint has a signing secret, shown once,
starting `whsec_`. Store it as `SENDPOSITORY_WEBHOOK_SECRET`.

## Events

| Event | When |
|---|---|
| `email.scheduled` | Accepted and held for a future time. |
| `email.sent` | Handed to the mail provider. |
| `email.delivered` | Accepted by the recipient's mailbox. |
| `email.delayed` | Temporary failure; Sendpository keeps retrying. |
| `email.bounced` | Permanent failure. The address is now suppressed. |
| `email.complained` | Marked as spam. The address is now suppressed. |
| `email.failed` | Couldn't be sent at all. |
| `email.opened` | Opened (only if the message had `track_opens`). |
| `email.clicked` | A link was clicked (only with `track_clicks`). Adds `url`. |
| `email.unsubscribed` | One-click unsubscribe; the address is now suppressed. |
| `email.received` | Mail arrived at a receiving address. See `receiving.md`. |

## Payload

```json
{
  "type": "email.delivered",
  "created_at": "2026-08-30T09:12:44.019Z",
  "data": {
    "email_id": "d67e39ed-96be-4b35-ab22-853163d92c92",
    "from": "hello@mail.yourdomain.com",
    "to": ["customer@example.com"],
    "subject": "Your code is 481920",
    "status": "delivered",
    "tags": { "type": "otp" }
  }
}
```

`email.opened` / `email.clicked` add `opened_at` / `clicked_at`,
`open_count` / `click_count`, `url` (clicks) and `user_agent`.

## Verify the signature - always

Every request has a header:

```
Sendpository-Signature: t=1788026132,v1=4f3a9c...
```

`v1` is HMAC-SHA256, hex, of `"{t}.{raw body}"` with the endpoint secret.
Reject timestamps more than 300 seconds old. **Use the raw body bytes** - if
a framework has already parsed the JSON, re-serialising it changes the bytes
and the check fails.

### Next.js App Router (SDK)

```ts
// app/api/webhooks/sendpository/route.ts
import { verifyWebhook, SignatureVerificationError } from "sendpository";

export async function POST(req: Request) {
  let event;
  try {
    event = verifyWebhook({
      body: await req.text(), // raw body, not req.json()
      signature: req.headers.get("sendpository-signature") ?? "",
      secret: process.env.SENDPOSITORY_WEBHOOK_SECRET!,
    });
  } catch (err) {
    if (err instanceof SignatureVerificationError) return new Response("Invalid signature", { status: 400 });
    throw err;
  }

  switch (event.type) {
    case "email.bounced":
    case "email.complained":
      // e.g. mark the user's email as undeliverable
      break;
    case "email.received":
      // event.data is the received message
      break;
  }
  return new Response(null, { status: 204 });
}
```

### Express

```ts
import express from "express";
import { verifyWebhook } from "sendpository";

const app = express();

// express.raw, not express.json - the signature is over the raw bytes.
app.post("/webhooks/sendpository", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const event = verifyWebhook({
      body: req.body.toString("utf8"),
      signature: req.get("sendpository-signature") ?? "",
      secret: process.env.SENDPOSITORY_WEBHOOK_SECRET!,
    });
    // handle event.type
    res.sendStatus(204);
  } catch {
    res.status(400).send("Invalid signature");
  }
});
```

### Without the SDK (Python)

```python
import hashlib, hmac, time

def verify(raw_body: bytes, header: str, secret: str) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    if abs(time.time() - int(parts["t"])) > 300:
        return False
    expected = hmac.new(secret.encode(), f"{parts['t']}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(parts["v1"], expected)
```

## Responding

- Return any `2xx` quickly - within 10 seconds - then do slow work
  afterwards (queue it). A slow response counts as a failure.
- After 15 consecutive failures the endpoint is disabled; the user re-enables
  it on the Webhooks page.
- Treat deliveries as possibly repeated: make handlers idempotent, keyed on
  `type` + `data.email_id` (or `data.inbound_id` for `email.received`).
- The endpoint must be a public `https` URL. For local development use a
  tunnel (for example `ngrok http 3000`) and register the tunnel URL.
