# Receiving email

Sendpository can accept mail at addresses on the user's verified domains -
support inboxes, reply-by-email, parsing forwarded receipts.

## Addresses

Added in the dashboard (open a domain → **Receiving → Add a receiving
address**) or with `inbound.addresses.create({ domain_id, local_part, host })`
and a `full_access` key. `local_part: "*"` catches everything at the host.

- The default host (for example `sp.yourdomain.com`) already points at
  Sendpository, so an address there works immediately.
- Any other host needs an MX record (`mail.sendpository.com`, priority 10)
  and stays `pending` until it is live. **Never suggest pointing the MX of the
  user's main domain here** unless they mean to move all their mail - it takes
  over every inbox on that domain (Google Workspace, Microsoft 365). Use a
  subdomain.
- Plans limit how many addresses and how many received emails a day.

## Getting the mail

Two ways; most apps use the webhook.

**1. Webhook (push).** Subscribe an endpoint to `email.received`. The payload's
`data`:

```json
{
  "inbound_id": "9f1c7d4e-2b1a-4f3c-9d55-0a1b2c3d4e5f",
  "to": "support@sp.yourdomain.com",
  "from": "customer@example.com",
  "from_name": "Priya Nair",
  "subject": "Invoice question",
  "message_id": "<CAF=abc@mail.gmail.com>",
  "received_at": "2026-09-16T09:12:03.000Z",
  "size_bytes": 18422,
  "spam": false,
  "sender_verdict": "verified",
  "attachments": [{ "filename": "invoice.pdf", "content_type": "application/pdf", "size": 48122 }],
  "text_preview": "Hi, I have a question about..."
}
```

Fetch the full message with `inbound.get(data.inbound_id)` when you need the
bodies. Spam is stored but not sent to webhooks.

**2. API (pull).** `inbound.list({ status, address, received_after })` for
metadata, `inbound.get(id)` for `text`, `html`, `headers`, attachment names and
the sender check. Needs a `full_access` key.

## Trusting the sender

`sender_verdict` says whether the From line is genuine, from SPF, DKIM and
DMARC:

- `verified` - the sender's domain vouches for it.
- `failed` - treat as forged. Don't act on it automatically.
- `unverified` - the domain publishes nothing either way (common for small
  senders).
- `unchecked` - nothing to check.

**Before an automation acts on received mail** (creates a ticket for a
customer account, approves something, follows instructions in the body),
require `sender_verdict === "verified"` or match the sender some other way.
Anyone can type any address into a From line.

## Limits

- Bodies up to 256 KB each; longer ones are truncated.
- Attachment file contents are not stored (names, types and sizes are);
  pictures are kept for the dashboard only. Read files from the message as
  it arrives if you need them.
- Received mail is deleted on the account's retention schedule.
- Received HTML is untrusted: never render it into your own pages without
  sanitising it, and never run scripts from it.
