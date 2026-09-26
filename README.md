# Sendpository

Transactional email API for developers.
Send your first application email with one HTTP request.

```ts
import { Sendpository } from "sendpository";

const sendpository = new Sendpository(process.env.SENDPOSITORY_API_KEY);

const { id } = await sendpository.emails.send({
  from: "Acme <hello@mail.yourdomain.com>",
  to: ["customer@example.com"],
  subject: "Your code is 481920",
  html: "<p>It expires in 10 minutes.</p>",
});
```

```bash
npm install sendpository
```

This is the official Node.js and TypeScript client. No runtime dependencies,
typed end to end (webhook payloads included), and it runs on Node 18+, Bun
and Deno. Cloudflare Workers need the `nodejs_compat` flag, because webhook
verification uses `node:crypto`.

## Set up in one command

```bash
npx sendpository init
```

Opens your browser to approve (or sign up), then saves the API key to your env
file and keeps it out of git, installs this package and the agent skill below,
and sends you a test email where your account allows.

## Using an AI coding agent?

```bash
npx sendpository agents
```

Installs the Sendpository skill into your project so Claude Code, Codex,
Cursor, Copilot and other agents write email code the right way - key on the
server, verified `from` address, idempotent retries, verified webhooks. It
only adds instruction files (`.claude/skills/sendpository/`, a section in
`AGENTS.md`, a Cursor rule if you use Cursor); run it again to update them.
See [sendpository.com/agents](https://sendpository.com/agents).

## Before your first send

1. Create an account at [sendpository.com](https://sendpository.com).
2. Add your domain under **Domains** and publish the DNS records it shows.
3. Create a key under **API keys** and put it in `SENDPOSITORY_API_KEY`.

The key is read from `SENDPOSITORY_API_KEY` when you don't pass one. Keep it
on your server - anyone who can read a key can send as you, so never ship one
to a browser or mobile app.

If the send fails, `err.type` says why:

| `err.type` | Fix |
|---|---|
| `authentication_error` | The key is missing, mistyped or revoked. |
| `domain_not_verified` | The `from` domain isn't verified yet - finish its DNS records. |
| `email_not_verified` | Confirm your account's email address first. |
| `suppressed_recipient` | That address bounced or complained before. Not a bug. |

## Retries that can't send twice

Pass an idempotency key on anything you might retry. Replaying the same key
returns the original message id rather than sending a second copy - which is
what you want when an OTP request times out after the mail already went.

```ts
await sendpository.emails.send(
  { from: "...", to: [user.email], subject: "Your code", html },
  { idempotencyKey: `otp-${user.id}-${session.id}` },
);
```

Derive the key from the event, not the clock. `otp-${Date.now()}` changes on
every attempt and protects nothing.

## Handling errors

Every failure throws a `SendpositoryError` with a stable `type`. Branch on the
type, never on the message.

```ts
import { SendpositoryError } from "sendpository";

try {
  await sendpository.emails.send({ ... });
} catch (err) {
  if (!(err instanceof SendpositoryError)) throw err;

  switch (err.type) {
    case "suppressed_recipient":
      return; // The address bounced or complained. Not a failure.
    case "domain_not_verified":
      return alertOps("Finish DNS setup for the sending domain.");
    case "quota_exceeded":
    case "trial_expired":
      return alertOps(err.message);
    default:
      throw err;
  }
}
```

Rate limits, 5xx and network errors are retried automatically - twice by
default, and `Retry-After` is respected exactly. Configure with
`new Sendpository(key, { maxRetries: 5 })`.

Those retries can't send twice: `emails.send()` attaches an idempotency key to
every call, generated if you didn't pass one. `emails.sendBatch()` has no key
yet, so a timeout or 5xx on a batch is thrown rather than retried - check with
`emails.list()` before sending it again.

## Verifying webhooks

Your endpoint is a public URL. Without verification, anyone who finds it can
tell your application an email bounced.

```ts
import { verifyWebhook } from "sendpository";

export async function POST(req: Request) {
  try {
    const event = verifyWebhook({
      // The raw body. Parsing and re-serialising changes the bytes and the
      // signature will not match.
      body: await req.text(),
      signature: req.headers.get("sendpository-signature") ?? "",
      secret: process.env.SENDPOSITORY_WEBHOOK_SECRET!,
    });

    if (event.type === "email.bounced") {
      await markUndeliverable(event.data.to[0]);
    }

    return new Response("ok");
  } catch {
    return new Response("Invalid signature", { status: 401 });
  }
}
```

The signature covers a timestamp, so a captured delivery can't be replayed
later. Comparison is constant-time.

## Everything else

```ts
// Batch - up to 100. Each succeeds or fails on its own, so check every entry.
const results = await sendpository.emails.sendBatch([msg1, msg2]);
for (const r of results) if ("error" in r) console.warn(r.error.message);

// Status and full delivery timeline
const email = await sendpository.emails.get(id);

// Schedule, then change your mind
const { id } = await sendpository.emails.send({ ...msg, scheduled_at: "2026-09-15T09:00:00Z" });
await sendpository.emails.cancel(id);

// Attachments - 10 files, 10 MB decoded. No programs (.exe, .js, .bat…).
// Can't be combined with scheduling.
await sendpository.emails.send({
  ...msg,
  attachments: [{ filename: "invoice.pdf", content: pdf.toString("base64"), content_type: "application/pdf" }],
});

// Marketing mail: one-click unsubscribe headers plus a visible link.
// {{unsubscribe_url}} is replaced per recipient; unsubscribes fire email.unsubscribed.
await sendpository.emails.send({
  ...msg,
  html: `<p>News…</p><p><a href="{{unsubscribe_url}}">Unsubscribe</a></p>`,
  list_unsubscribe: true,
});

// Domains
const domain = await sendpository.domains.create("mail.yourdomain.com");
console.table(domain.records);          // publish these
await sendpository.domains.verify(domain.id);  // safe to poll; nothing is cached
```

### Receiving

```ts
// Start receiving at an address on a verified domain.
const address = await sendpository.inbound.addresses.create({ domain_id: domain.id, local_part: "support" });
if (address.status === "pending") console.log("Publish:", address.dns_record);

// Read what arrived.
const { data } = await sendpository.inbound.list({ status: "received", limit: 20 });
const message = await sendpository.inbound.get(data[0].id);

// Anyone can write any From line - check it before acting on the mail.
if (message.sender_verdict !== "verified") console.warn("Unverified sender:", message.from);
```

`email.received` webhooks narrow on `type`:

```ts
const event = verifyWebhook({
  body: await req.text(),
  signature: req.headers.get("sendpository-signature") ?? "",
  secret: process.env.SENDPOSITORY_WEBHOOK_SECRET!,
});
if (event.type === "email.received" && event.data.sender_verdict === "verified") {
  await openTicket(event.data.from, event.data.subject, event.data.text_preview);
}
```

`apiKeys`, `webhooks`, `logs` and `inbound` need a key with `full_access`. Your
application should use a `sending` key - one that leaks can send email, but
cannot mint more keys.

```ts
await sendpository.apiKeys.create({ name: "production", permission: "sending" });
await sendpository.webhooks.create({ url: "https://api.yourdomain.com/hooks/email" });
await sendpository.logs.list({ status: "4xx", limit: 25 });
```

## Options

```ts
new Sendpository(apiKey, {
  baseUrl: "https://api.sendpository.com/v1", // self-hosted installs
  timeout: 30_000,
  maxRetries: 2,
  fetch: customFetch,
});
```

## Docs

Full reference at [sendpository.com/docs](https://sendpository.com/docs).

MIT licensed.
