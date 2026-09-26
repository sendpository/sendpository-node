---
name: sendpository
description: Add email to an app with Sendpository - sending transactional email (sign-up confirmations, password resets, OTP codes, receipts, notifications), batch sends, scheduling, attachments, delivery webhooks, receiving email, and migrating from Resend, SendGrid, Postmark, Mailgun, Amazon SES or Nodemailer/SMTP. Use when the user mentions Sendpository, a SENDPOSITORY_API_KEY, the `sendpository` npm package, or asks to send or receive email in a project that uses Sendpository, or to switch a project's email to Sendpository.
---

# Sendpository

Sendpository is a transactional email API. One HTTP call sends one email;
delivery, bounces and opens come back as signed webhooks.

- API base: `https://api.sendpository.com/v1`
- Dashboard: `https://app.sendpository.com`
- Docs: `https://sendpository.com/docs`
- Node.js SDK: `npm install sendpository` (Node 18+, Bun, Deno; zero dependencies)

Read this file first. For more detail, read the file under `references/` that
matches the task:

| Task | Read |
|---|---|
| Every endpoint, parameter and response | `references/api.md` |
| Receiving delivery/bounce/open events, verifying signatures | `references/webhooks.md` |
| Next.js, Express, serverless, Python, curl examples | `references/frameworks.md` |
| Receiving email at your own addresses | `references/receiving.md` |
| Moving from Resend, SendGrid, Postmark, Mailgun, Amazon SES or Nodemailer | `references/migrate.md` |

## Rules that are never optional

1. **The API key stays on the server.** Read it from `SENDPOSITORY_API_KEY`.
   Never put it in client-side code, a `NEXT_PUBLIC_`/`VITE_` variable, a
   mobile app, or a committed file. Anyone holding a key can send as the
   account. If the user pasted a key into chat or code, tell them to move it
   into an environment variable and to rotate it if it was committed.
2. **Send from the server** - an API route, server action, background job or
   backend service. Never call the API from a browser.
3. **`from` must be an address on a domain verified in the account** (for
   example `hello@mail.yourdomain.com`). You cannot verify a domain from code
   the user doesn't control; if sending fails with `domain_not_verified`, tell
   the user to add the domain under Domains in the dashboard and publish the
   DNS records it shows.
4. **Branch on `error.type`, never on `error.message`.** Types are stable;
   messages are reworded.
5. **Anything that might be retried gets an idempotency key** derived from the
   event (`otp-${userId}-${requestId}`), never from the clock. The same key
   returns the original message id instead of sending twice.
6. **Verify every webhook signature** with the raw request body before
   trusting it. See `references/webhooks.md`.

## Setup checklist

Before writing code, check what the project already has:

- `sendpository` in `package.json`? If not and it's a Node/TypeScript project:
  `npm install sendpository` (or the project's package manager).
- `SENDPOSITORY_API_KEY` in `.env.example` / `.env.local`? If not, add
  `SENDPOSITORY_API_KEY=` to `.env.example` (no value) and tell the user to
  create a key under **API keys** in the dashboard and put it in their local
  env file and their host's environment settings.
- A verified sending domain? Ask the user which `from` address to use if the
  project doesn't already configure one. A good pattern is a
  `EMAIL_FROM="App Name <hello@mail.yourdomain.com>"` environment variable.

## Send an email (Node.js / TypeScript)

```ts
import { Sendpository, SendpositoryError } from "sendpository";

// Reads SENDPOSITORY_API_KEY when no key is passed.
const sendpository = new Sendpository();

const { id } = await sendpository.emails.send({
  from: "Acme <hello@mail.yourdomain.com>",
  to: ["customer@example.com"],
  subject: "Your code is 481920",
  html: "<p>It expires in 10 minutes.</p>",
  text: "Your code is 481920. It expires in 10 minutes.",
});
```

Create the client once per module (or once per process), not per request.

Useful options on `emails.send`:

| Field | Notes |
|---|---|
| `to`, `cc`, `bcc`, `reply_to` | String or array. At most 50 recipients across `to`, `cc` and `bcc`. |
| `html` / `text` | At least one. Send both for best deliverability. |
| `tags` | `{ key: "value" }` strings, for filtering in the dashboard and webhooks. |
| `headers` | Custom headers. `From`, `Sender`, `Reply-To`, `Message-ID`, DKIM and similar are refused - use the fields above. |
| `attachments` | Up to 10, 10 MB decoded total: `{ filename, content (base64), content_type?, content_id? }`. Programs (`.exe`, `.js`, …) are refused. |
| `scheduled_at` | ISO 8601. Not combinable with attachments. Cancel with `emails.cancel(id)`. |
| `track_opens`, `track_clicks` | Off by default. Leave them off for password resets and codes. |
| `list_unsubscribe` | One-click unsubscribe headers; needed for marketing/bulk mail to Gmail and Yahoo. A `{{unsubscribe_url}}` in the body is replaced with the link. Single recipient only. |

Retries: the SDK retries rate limits and transient errors itself and adds an
idempotency key to every `send`. Pass your own when the send is triggered by
something that can happen twice:

```ts
await sendpository.emails.send(message, { idempotencyKey: `welcome-${user.id}` });
```

Batch (up to 100 messages, partial success):

```ts
const results = await sendpository.emails.sendBatch([msgA, msgB]);
// results[i] is { id } or { error: { type, message } } for messages[i].
// The request succeeds even when some messages fail - check every entry.
```

A batch has no idempotency key, so the SDK does not retry it after a timeout
(it may already have sent). Use single sends with idempotency keys when a
duplicate would matter.

## Without the SDK (any language)

```bash
curl https://api.sendpository.com/v1/emails \
  -H "Authorization: Bearer $SENDPOSITORY_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: welcome-42" \
  -d '{
    "from": "Acme <hello@mail.yourdomain.com>",
    "to": ["customer@example.com"],
    "subject": "Welcome",
    "html": "<p>Thanks for signing up.</p>"
  }'
# 200 {"id":"8b0c..."}
```

Errors are always `{"error": {"type": "...", "message": "..."}}` with the
HTTP status below.

## Errors

| `type` | HTTP | What to do |
|---|---|---|
| `validation_error` | 422 | Fix the request; the message says which field. |
| `authentication_error` | 401 | Key missing, wrong or revoked. Check `SENDPOSITORY_API_KEY`. |
| `permission_denied` | 403 | Account suspended, or a `sending` key used on a management endpoint (domains, keys, webhooks, logs need a `full_access` key). |
| `domain_not_verified` | 403 | The `from` domain isn't verified in this account. The user must finish its DNS records in the dashboard. |
| `email_not_verified` | 403 | The account owner hasn't confirmed their own email address yet. |
| `suppressed_recipient` | 422 | The address bounced or complained before. Not a bug - skip it, don't retry. |
| `quota_exceeded` | 402 | Monthly or daily allowance used. Alert someone; don't loop. |
| `trial_expired` | 402 | The trial ended; a plan is needed. |
| `rate_limit_exceeded` | 429 | Wait `Retry-After` seconds, then retry. |
| `not_found` | 404 | No such message, domain or key on this account. |
| `internal_error` | 500 | Retry with backoff, with the same idempotency key. |

With the SDK, failures throw `SendpositoryError` with `.type`, `.status`,
`.retryAfter`, and helpers `.isRetryable` and `.isSuppressed`:

```ts
try {
  await sendpository.emails.send(message);
} catch (err) {
  if (err instanceof SendpositoryError && err.isSuppressed) return; // expected
  throw err;
}
```

## Trying it before a domain is verified

Some accounts show a **sandbox sender** (`onboarding@…`) on the dashboard. It
sends only to the account owner's own address, up to 20 emails a day, and
can't schedule. It's for a first test; real sending needs the user's own
verified domain.

## Common mistakes to avoid

- Creating a new client or reading the key inside a React component.
- Using a `from` on a domain that isn't verified, or on the bare root domain
  when the user verified a subdomain like `mail.yourdomain.com`.
- Parsing the webhook body as JSON before verifying its signature (the
  signature is over the raw bytes).
- Retrying a failed send without an idempotency key - that's how people get
  two OTP emails.
- Treating `suppressed_recipient` as an outage.
- Adding open/click tracking to security emails (resets, codes, magic links).
- Putting more than 50 recipients on one message to "save quota" - send one
  message per recipient, or use `sendBatch`.
