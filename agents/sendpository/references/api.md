# Sendpository API reference

Base URL `https://api.sendpository.com/v1`. Every request:

```
Authorization: Bearer <SENDPOSITORY_API_KEY>
Content-Type: application/json
```

Keys have one of two permissions. **`sending`** keys can only send and read
mail (`/emails`). **`full_access`** keys can also manage domains, API keys,
webhooks, logs and receiving. Use a `sending` key in application code.

Lists take `limit` (1-100, default 25) and `offset`, and return
`{ data, limit, offset, total }` unless noted.

Rate limits are per key per second, set by the plan. A `429` carries
`Retry-After` in seconds.

## Emails

| Method | Path | SDK | Notes |
|---|---|---|---|
| POST | `/emails` | `emails.send(message, { idempotencyKey })` | Returns `{ id }`. Optional `Idempotency-Key` header. |
| POST | `/emails/batch` | `emails.sendBatch(messages)` | Body is an array of up to 100 messages (or `{ "data": [...] }`). Returns `{ data: [ { id } \| { error } ] }`, one per message, in order. |
| GET | `/emails/{id}` | `emails.get(id)` | Full message with `status` and `events` timeline. |
| GET | `/emails` | `emails.list({ limit, offset, status, created_after, created_before })` | Newest first. |
| POST | `/emails/{id}/cancel` | `emails.cancel(id)` | Only while `status` is `scheduled`. |

Send body:

| Field | Type | Required | Notes |
|---|---|---|---|
| `from` | string | yes | `"Name <addr@verified-domain>"` or bare address. |
| `to` | string[] | yes | At most 50 recipients across `to`, `cc`, `bcc`. |
| `subject` | string | yes | Max 998 characters, no line breaks. |
| `html` | string | one of | |
| `text` | string | one of | |
| `cc`, `bcc`, `reply_to` | string[] | no | `reply_to` at most 10. |
| `headers` | object | no | String values, no line breaks. Identity headers (`From`, `Sender`, `To`, `Reply-To`, `Message-ID`, `Date`, `Subject`, `DKIM-Signature`, `Received`, `X-Postal-*`, …) are refused. |
| `tags` | object | no | String key/values. |
| `attachments` | object[] | no | Up to 10, 10 MB decoded total. `{ filename, content (base64), content_type?, content_id? }`. Executables refused. `content_id: "logo"` is used as `<img src="cid:logo">`. |
| `scheduled_at` | string | no | ISO 8601 with offset. Past time = now. Not with attachments. |
| `track_opens` | boolean | no | Default off (or the account default). Needs `html`. |
| `track_clicks` | boolean | no | Default off. Needs `html`. |
| `list_unsubscribe` | boolean | no | RFC 8058 one-click headers. Single recipient. `{{unsubscribe_url}}` in the body turns it on. |

Email statuses: `queued`, `scheduled`, `sent`, `delivered`, `delayed`,
`bounced`, `complained`, `failed`, `cancelled`.

Timeline event names: `email.queued`, `email.scheduled`, `email.sent`,
`email.delivered`, `email.delayed`, `email.bounced`, `email.complained`,
`email.failed`, `email.opened`, `email.clicked`, `email.unsubscribed`,
`email.cancelled`.

## Domains (full_access)

| Method | Path | SDK | Notes |
|---|---|---|---|
| POST | `/domains` | `domains.create(name)` | `{ "name": "mail.yourdomain.com" }`. Returns the DNS `records` to publish. |
| GET | `/domains` | `domains.list()` | |
| GET | `/domains/{id}` | `domains.get(id)` | Per-record `verified` state. |
| POST | `/domains/{id}/verify` | `domains.verify(id)` | Runs a DNS check now. |
| DELETE | `/domains/{id}` | `domains.delete(id)` | Sending from it stops immediately. |

Domain statuses: `not_started`, `pending`, `verified`, `failed`. A verified
domain whose records later disappear is suspended until they return.

Records are TXT/CNAME/MX with a `purpose` of `spf`, `dkim`, `dmarc` or
`return_path`. The user publishes them at their DNS provider; DNS can take
minutes to hours.

## API keys (full_access)

| Method | Path | SDK | Notes |
|---|---|---|---|
| POST | `/api-keys` | `apiKeys.create({ name, permission })` | `permission` is `sending` (default) or `full_access`. The token is returned once. |
| GET | `/api-keys` | `apiKeys.list()` | Tokens masked to their prefix. |
| GET | `/api-keys/{id}` | `apiKeys.get(id)` | |
| PATCH | `/api-keys/{id}` | `apiKeys.update(id, { name })` | |
| DELETE | `/api-keys/{id}` | `apiKeys.revoke(id)` | |

## Webhooks (full_access)

| Method | Path | SDK | Notes |
|---|---|---|---|
| POST | `/webhooks` | `webhooks.create({ url, description, events })` | `url` must be public `https`. Returns the signing `secret` once. Empty `events` = all. |
| GET | `/webhooks` | `webhooks.list()` | |
| DELETE | `/webhooks/{id}` | `webhooks.delete(id)` | |

## Logs (full_access)

| Method | Path | SDK | Notes |
|---|---|---|---|
| GET | `/logs` | `logs.list({ limit, offset, status, endpoint })` | Every API request: method, endpoint, status code, error type, duration. `status` is `2xx`, `4xx` or `5xx`. |
| GET | `/logs/{id}` | `logs.get(id)` | Adds IP, user agent and key id. |

## Receiving (full_access)

| Method | Path | SDK | Notes |
|---|---|---|---|
| GET | `/inbound` | `inbound.list({ status, address, received_after, received_before })` | Metadata only. |
| GET | `/inbound/{id}` | `inbound.get(id)` | Bodies, headers, attachment names, `sender_verdict`. |
| GET | `/inbound/addresses` | `inbound.addresses.list()` | |
| POST | `/inbound/addresses` | `inbound.addresses.create({ domain_id, local_part, host })` | `local_part` `*` = catch-all. |
| DELETE | `/inbound/addresses/{id}` | `inbound.addresses.delete(id)` | |

See `receiving.md`.
