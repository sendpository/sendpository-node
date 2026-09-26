# Migrating to Sendpository

Moving an app's email from another provider (Resend, SendGrid, Postmark,
Mailgun, Amazon SES) or from Nodemailer/SMTP. Generated from the same data
as sendpository.com/migrate - provider details were checked against each
provider's own documentation.

## The plan - follow it in order

1. **Find every place the app sends email.** Search for the provider's
   package, client and env vars (table below), plus any wrapper the app built
   around them (`sendEmail`, `mailer`, `lib/email`). List them for the user.
2. **Put one email module in front of the provider** if the app doesn't
   have one, and move every call site to it. The swap then happens in one
   file.
3. **Ask the user to set up Sendpository first** - this part is theirs:
   add the sending domain in the dashboard and publish its DNS records
   *alongside* the old provider's (they coexist; don't remove anything
   yet), wait for it to verify, and create a `sending` API key.
4. **Rewrite the send** using the mapping for the provider below. Keep the
   same `from` addresses so recipients see no change.
5. **Rewrite the webhook handler**: new signature check, new event names.
   Keep the old route working until the old provider is switched off.
6. **Bring the suppression list over** (bounces, complaints, unsubscribes)
   before real traffic moves - see below. Mailing those addresses again
   damages the domain's reputation.
7. **Switch with a flag, not a deploy.** Read an `EMAIL_PROVIDER` env var in
   the email module so production can move - and move back - without a
   code change. Keep the old provider's code path until a day of production
   mail has gone through Sendpository.
8. **Test** (list at the end), then remove the old package, env vars and
   webhook route. Tell the user when it's safe to delete the old provider's
   DNS records - not before.

## Recognising the current provider

| Provider | Packages | Env vars |
|---|---|---|
| Resend | `resend` (npm), `resend` (pip) | `RESEND_API_KEY` |
| SendGrid | `@sendgrid/mail`, `@sendgrid/client` (npm), `sendgrid` (pip) | `SENDGRID_API_KEY` |
| Postmark | `postmark` (npm), `postmarker` (pip) | `POSTMARK_SERVER_TOKEN`, `POSTMARK_API_TOKEN` |
| Mailgun | `mailgun.js`, `mailgun-js` (npm) | `MAILGUN_API_KEY`, `MAILGUN_DOMAIN` |
| Amazon SES | `@aws-sdk/client-ses`, `@aws-sdk/client-sesv2`, `aws-sdk` (npm), `boto3` with `ses`/`sesv2` (pip) | `AWS_ACCESS_KEY_ID`, `AWS_REGION`, an SES configuration set |
| Nodemailer / SMTP | `nodemailer` (npm), `smtplib` or framework mailers (Django, Rails, Laravel) | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_*` |

## Sendpository side, for every provider

```ts
import { Sendpository, SendpositoryError } from "sendpository";

const sendpository = new Sendpository(); // SENDPOSITORY_API_KEY

const { id } = await sendpository.emails.send(
  {
    from: "Acme <billing@mail.yourdomain.com>",
    to: ["customer@example.com"],
    subject: "Your receipt",
    html: "<p>Thanks for your order.</p>",
    text: "Thanks for your order.",
    tags: { type: "receipt" },
  },
  { idempotencyKey: "receipt-10428" },
);
```

Failures throw `SendpositoryError`; branch on `err.type`. Webhooks are
verified with `verifyWebhook` from the same package (see `webhooks.md`).
Templates stored at the old provider have no equivalent: render the HTML
in the app (React Email, MJML, Handlebars, plain strings) and send it.

## From Resend

Moving from Resend to Sendpository is mostly a key and base-URL change: both take a JSON body with from, to, subject and html over HTTPS with a Bearer key, both honour an Idempotency-Key header, and event names are almost the same. The three real changes are tags (an array of name/value pairs becomes a plain object), webhook verification (Svix headers become one Sendpository-Signature header) and re-verifying your domain.

Effort: Usually under an hour for the code, plus DNS propagation.

| | Resend | Sendpository |
|---|---|---|
| Auth | Authorization: Bearer re_... | Authorization: Bearer sp_... - create a key with the sending permission for the app, full_access only where you manage domains or webhooks by API. |
| Endpoint | POST https://api.resend.com/emails | POST https://api.sendpository.com/v1/emails |
| Body | JSON: from, to, subject, html, text, cc, bcc, reply_to, headers, attachments, scheduled_at | The same field names. to, cc, bcc and reply_to take arrays; a single string is accepted for to. |
| Tags | Array of { name, value } | Plain object: { "type": "receipt" } |
| Templates | react (Node SDK) or a stored template id with variables | Send rendered HTML. React Email works: render the component to HTML and pass it as html. |
| Idempotency | Idempotency-Key header | Idempotency-Key header - a replay returns the original id |
| Batch | POST /emails/batch | POST https://api.sendpository.com/v1/emails/batch, up to 100 messages, each accepted or rejected on its own |
| Response | { "id": "..." } | { "id": "..." } |

Webhooks:

- Resend: Svix: svix-id, svix-timestamp and svix-signature headers
- Sendpository: One Sendpository-Signature header: t=<unix>,v1=<HMAC-SHA256 of "t.rawBody">. The SDK's verifyWebhook checks it and rejects anything older than five minutes.

| Resend event | Sendpository event |
|---|---|
| `email.sent` | `email.sent` |
| `email.delivered` | `email.delivered` |
| `email.delivery_delayed` | `email.delayed` |
| `email.bounced` | `email.bounced` |
| `email.complained` | `email.complained` |
| `email.failed` | `email.failed` |
| `email.opened` | `email.opened` |
| `email.clicked` | `email.clicked` |
| `email.scheduled` | `email.scheduled` |
| `email.received` | `email.received` |

The payload is { type, created_at, data } with data.email_id identifying the message.

Errors - Resend returns: An error object with a name and a message. Map your checks on Resend's error name to our error.type. validation_error, rate_limit_exceeded and not_found keep their meaning.

Domain:

- Add the same domain in Sendpository. Its SPF and bounce records go on a sp. subdomain, so they don't collide with anything Resend asked you to publish.
- The DKIM record has a different selector, so it sits alongside Resend's. Both can exist while you switch over.

Watch for:

- Rewrite tags from [{ name, value }] to { name: value } - an array is rejected.
- Replace the Svix verification with verifyWebhook from the sendpository package; the Svix headers will be absent.
- Resend's SDK returns { data, error }. Sendpository's SDK throws a SendpositoryError instead - wrap sends in try/catch.
- Rename email.delivery_delayed to email.delayed in your event switch.

Before (Resend):

```ts
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const { data, error } = await resend.emails.send({
  from: "Acme <billing@yourdomain.com>",
  to: ["customer@example.com"],
  subject: "Your receipt",
  html: "<p>Thanks for your order.</p>",
  tags: [{ name: "type", value: "receipt" }],
});
```

## From SendGrid

Migrating from SendGrid to Sendpository means flattening the request: SendGrid's personalizations, from object and content array become flat from, to, subject, html and text fields. Sendpository returns 200 with the message id in the body instead of an empty 202, signs webhooks with HMAC-SHA256 instead of ECDSA, and sends one event per request instead of an array.

Effort: An afternoon for most codebases - the request shape is the main rewrite.

| | SendGrid | Sendpository |
|---|---|---|
| Auth | Authorization: Bearer SG.... | Authorization: Bearer sp_... - a sending key for the app, full_access only for managing domains and webhooks by API. |
| Endpoint | POST https://api.sendgrid.com/v3/mail/send | POST https://api.sendpository.com/v1/emails |
| Recipients | personalizations: [{ to: [{ email, name }] }] | to: ["Name <addr>"] - plain strings, cc and bcc alongside |
| Sender | from: { email, name } | from: "Name <addr>" |
| Body | content: [{ type: "text/html", value }] | html and text fields |
| Metadata | categories and custom_args | tags: a string key/value object |
| Scheduling | send_at (unix timestamp) | scheduled_at (ISO 8601), cancellable |
| Response | 202 Accepted, empty body; the message id is in the X-Message-Id header | 200 with { "id": "..." } in the body |

Webhooks:

- SendGrid: Signed Event Webhook: ECDSA with a public key, in X-Twilio-Email-Event-Webhook-Signature and -Timestamp
- Sendpository: HMAC-SHA256 with your endpoint secret, in Sendpository-Signature: t=<unix>,v1=<hex>

| SendGrid event | Sendpository event |
|---|---|
| `processed` | `email.sent` |
| `delivered` | `email.delivered` |
| `deferred` | `email.delayed` |
| `bounce` | `email.bounced` |
| `dropped` | `email.failed` |
| `spamreport` | `email.complained` |
| `open` | `email.opened` |
| `click` | `email.clicked` |
| `unsubscribe` | `email.unsubscribed` |

SendGrid posts an array of events; Sendpository posts one event per request, so drop the loop.

Errors - SendGrid returns: { "errors": [{ "message", "field", "help" }] }. Sendpository returns a single error with a stable type. Branch on error.type rather than parsing messages.

Domain:

- SendGrid's domain authentication uses CNAMEs on its own subdomains. Sendpository's records are separate, so you can add them without removing SendGrid's.
- If you used a SendGrid link-branding subdomain, keep it until old emails' links have stopped being clicked.

Watch for:

- A 202 with no body is gone - read the id from the JSON response and store it if you look messages up later.
- Personalizations that sent different content to several recipients in one call become separate messages, or one POST to /emails/batch with up to 100.
- Dynamic templates (template_id with dynamic_template_data) have no equivalent - render the HTML in your app before sending.
- Your event handler must accept a single JSON object, not an array.

Before (SendGrid):

```ts
await fetch("https://api.sendgrid.com/v3/mail/send", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    personalizations: [{ to: [{ email: "customer@example.com" }] }],
    from: { email: "billing@yourdomain.com", name: "Acme" },
    subject: "Your receipt",
    content: [{ type: "text/html", value: "<p>Thanks for your order.</p>" }],
    categories: ["receipt"],
  }),
}); // 202, empty body
```

## From Postmark

Migrating from Postmark to Sendpository is a field rename and an auth change: PascalCase fields (From, To, HtmlBody, TextBody) become lowercase ones (from, to, html, text), and the X-Postmark-Server-Token header becomes a Bearer key. Sendpository also signs every webhook with HMAC-SHA256, where Postmark relies on basic auth or IP allowlisting.

Effort: An hour or two - the request maps field for field.

| | Postmark | Sendpository |
|---|---|---|
| Auth | X-Postmark-Server-Token: <server token> | Authorization: Bearer sp_... |
| Endpoint | POST https://api.postmarkapp.com/email | POST https://api.sendpository.com/v1/emails |
| Fields | From, To (comma-separated string), Cc, Bcc, Subject, HtmlBody, TextBody, ReplyTo | from, to (array), cc, bcc, subject, html, text, reply_to |
| Metadata | Tag (one string) and Metadata (key/values) | tags: a string key/value object |
| Tracking | TrackOpens, TrackLinks | track_opens, track_clicks - or an account default |
| Streams | MessageStream separates transactional and broadcast | No streams - use tags to tell mail apart |
| Batch | POST /email/batch, up to 500 | POST https://api.sendpository.com/v1/emails/batch, up to 100 |
| Response | { To, SubmittedAt, MessageID, ErrorCode, Message } | { "id": "..." } on success; an error object otherwise |

Webhooks:

- Postmark: No HMAC signature - secured with basic auth in the URL or an IP allowlist
- Sendpository: Every request signed: Sendpository-Signature: t=<unix>,v1=<HMAC-SHA256>. Verify it and you can drop the basic-auth credentials.

| Postmark event | Sendpository event |
|---|---|
| `Delivery` | `email.delivered` |
| `Bounce` | `email.bounced` |
| `Spam Complaint` | `email.complained` |
| `Open Tracking` | `email.opened` |
| `Click` | `email.clicked` |
| `Subscription Change` | `email.unsubscribed` |
| `Inbound` | `email.received` |

Errors - Postmark returns: HTTP 422 with a numeric ErrorCode and a Message, e.g. 406 for an inactive recipient. Swap numeric ErrorCode checks for error.type strings: an inactive recipient is suppressed_recipient, an unverified sender is domain_not_verified.

Domain:

- Postmark verifies a DKIM record and a Return-Path CNAME. Sendpository's DKIM uses a different selector, and its bounce record lives on a sp. subdomain, so both can coexist.

Watch for:

- To becomes an array - split any comma-separated recipient string.
- A single Tag becomes a key in tags, e.g. { "type": "receipt" }.
- If you relied on ErrorCode 406 to skip inactive recipients, check for error.type === "suppressed_recipient" instead.
- Webhook handlers should verify the signature; the basic-auth credentials in the URL are no longer needed.

Before (Postmark):

```ts
await fetch("https://api.postmarkapp.com/email", {
  method: "POST",
  headers: {
    "X-Postmark-Server-Token": process.env.POSTMARK_SERVER_TOKEN,
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  body: JSON.stringify({
    From: "Acme <billing@yourdomain.com>",
    To: "customer@example.com",
    Subject: "Your receipt",
    HtmlBody: "<p>Thanks for your order.</p>",
    TextBody: "Thanks for your order.",
    Tag: "receipt",
    MessageStream: "outbound",
  }),
});
```

## From Mailgun

Migrating from Mailgun to Sendpository replaces form-encoded requests with JSON and basic auth with a Bearer key. The sending domain moves out of the URL and into the from address, o:tag and v: variables become a tags object, and webhook verification switches from HMAC over timestamp and token to HMAC over the timestamp and raw body.

Effort: An afternoon - mostly swapping form-data for JSON.

| | Mailgun | Sendpository |
|---|---|---|
| Auth | HTTP basic auth, user api and your API key as the password | Authorization: Bearer sp_... |
| Endpoint | POST https://api.mailgun.net/v3/<domain>/messages (EU: api.eu.mailgun.net) | POST https://api.sendpository.com/v1/emails - the domain comes from the from address |
| Encoding | multipart/form-data | application/json |
| Fields | from, to, subject, text, html | from, to (array), subject, text, html |
| Metadata | o:tag (repeatable) and v:<name> variables | tags: a string key/value object |
| Tracking | o:tracking-opens, o:tracking-clicks | track_opens, track_clicks |
| Scheduling | o:deliverytime (RFC 2822, up to 3 days ahead) | scheduled_at (ISO 8601) |
| Custom headers | h:<Header-Name> | headers: { "Header-Name": "value" } |

Webhooks:

- Mailgun: signature object in the body: HMAC-SHA256 of timestamp + token with your webhook signing key
- Sendpository: Sendpository-Signature header: HMAC-SHA256 of "timestamp.rawBody" with your endpoint secret

| Mailgun event | Sendpository event |
|---|---|
| `delivered` | `email.delivered` |
| `failed (temporary)` | `email.delayed` |
| `failed (permanent)` | `email.bounced` |
| `complained` | `email.complained` |
| `opened` | `email.opened` |
| `clicked` | `email.clicked` |
| `unsubscribed` | `email.unsubscribed` |

Inbound routes become receiving addresses on your domain, delivered as email.received with an SPF, DKIM and DMARC verdict.

Errors - Mailgun returns: A JSON message describing the problem, with the HTTP status. Sendpository returns { error: { type, message } } - branch on type.

Domain:

- Mailgun domains are often a subdomain like mg.yourdomain.com. Add whichever domain your From address uses - Sendpository signs as that domain.
- Mailgun's MX records only matter if you receive mail through Mailgun routes. Move receiving last, once sending is settled.

Watch for:

- Batch sending with recipient-variables becomes one POST to /emails/batch with a message per recipient - personalise the HTML in your code.
- Stored templates (template with t:variables) have no equivalent; render the HTML before sending.
- The webhook signature moves from the body to a header and covers the raw body, so read the body as text before parsing it.

Before (Mailgun):

```ts
const form = new FormData();
form.append("from", "Acme <billing@mg.yourdomain.com>");
form.append("to", "customer@example.com");
form.append("subject", "Your receipt");
form.append("html", "<p>Thanks for your order.</p>");
form.append("o:tag", "receipt");

await fetch("https://api.mailgun.net/v3/mg.yourdomain.com/messages", {
  method: "POST",
  headers: {
    Authorization: "Basic " + btoa(`api:${process.env.MAILGUN_API_KEY}`),
  },
  body: form,
});
```

## From Amazon SES

Migrating from Amazon SES to Sendpository replaces the AWS SDK, SigV4 signing and IAM credentials with one HTTPS request and a Bearer key. Bounce and complaint events arrive as signed webhooks instead of going through configuration sets and SNS, and suppression, logs and a dashboard come built in. You trade SES's lowest-in-class per-email price for far less infrastructure to run.

Effort: A day if you also retire SNS topics, SQS queues and bounce-processing Lambdas; an hour for the send call alone.

| | Amazon SES | Sendpository |
|---|---|---|
| Auth | AWS SigV4 with IAM credentials and an ses:SendEmail policy | Authorization: Bearer sp_... - no IAM, no region |
| Endpoint | SESv2 SendEmail (POST /v2/email/outbound-emails), usually through the AWS SDK | POST https://api.sendpository.com/v1/emails |
| Body | FromEmailAddress, Destination.ToAddresses, Content.Simple.Subject.Data, Content.Simple.Body.Html.Data | from, to, subject, html, text |
| Attachments | Content.Simple.Attachments, or a raw MIME message | attachments: [{ filename, content (base64), content_type }] |
| Metadata | EmailTags: [{ Name, Value }] with a configuration set | tags: a string key/value object |
| Events | Configuration set → SNS, EventBridge, Firehose or CloudWatch | Signed webhooks to your URL, plus searchable logs |
| Response | { MessageId } | { "id": "..." } |

Webhooks:

- Amazon SES: SNS notifications, verified with the SNS message signature and certificate
- Sendpository: HTTPS POST with Sendpository-Signature: t=<unix>,v1=<HMAC-SHA256>

| Amazon SES event | Sendpository event |
|---|---|
| `Send` | `email.sent` |
| `Delivery` | `email.delivered` |
| `DeliveryDelay` | `email.delayed` |
| `Bounce` | `email.bounced` |
| `Complaint` | `email.complained` |
| `Reject` | `email.failed` |
| `Open` | `email.opened` |
| `Click` | `email.clicked` |
| `Subscription` | `email.unsubscribed` |

No SNS subscription confirmation step - add the URL and events arrive.

Errors - Amazon SES returns: SDK exceptions such as MessageRejected, MailFromDomainNotVerifiedException and TooManyRequestsException. These map to validation_error, domain_not_verified and rate_limit_exceeded. rate_limit_exceeded includes a Retry-After header.

Domain:

- SES Easy DKIM publishes three CNAMEs. Sendpository publishes its own DKIM TXT record on a different selector, so they coexist.
- There is no sandbox or production-access request: sending opens once your domain verifies and your account email is confirmed.

Watch for:

- Your bounce-processing Lambda or queue consumer becomes a webhook handler - and suppression already happens for you, so it may only need to update your own user records.
- Raw MIME sends need to be split into from, to, subject, html, text and attachments.
- Remove the IAM user or role once SES is no longer called, so unused credentials don't linger.

Before (Amazon SES):

```ts
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

const ses = new SESv2Client({ region: "us-east-1" });

await ses.send(
  new SendEmailCommand({
    FromEmailAddress: "Acme <billing@yourdomain.com>",
    Destination: { ToAddresses: ["customer@example.com"] },
    Content: {
      Simple: {
        Subject: { Data: "Your receipt" },
        Body: { Html: { Data: "<p>Thanks for your order.</p>" } },
      },
    },
    EmailTags: [{ Name: "type", Value: "receipt" }],
    ConfigurationSetName: "transactional",
  }),
);
```

## From Nodemailer or another SMTP client

Sendpository is an HTTPS API, not an SMTP relay. Replace the transport's
`sendMail` with `sendpository.emails.send`:

| Nodemailer | Sendpository |
|---|---|
| `from` | `from` - `"Name <addr>"` string |
| `to`, `cc`, `bcc` (string or array) | the same, as arrays |
| `replyTo` | `reply_to` |
| `subject`, `html`, `text` | the same |
| `headers` | `headers` (identity headers are refused) |
| `attachments[].content` (Buffer/string) or `.path` | `attachments[].content` as base64 - read the file and `toString("base64")` |
| `attachments[].cid` | `attachments[].content_id` |
| `attachments[].contentType` | `attachments[].content_type` |
| Return value `info.messageId` | `{ id }` |

Remove the SMTP env vars and the transporter once nothing uses them.
Bounces now arrive as `email.bounced` webhooks instead of bounce mail.

## Bringing the suppression list over

Export bounced, complained, blocked and unsubscribed addresses from the old
provider (its dashboard has an export, or write a small script against its
API) and have the user import them in the Sendpository dashboard:
**Suppressions → Import**. It accepts a pasted list or a CSV file, pulls
every email address out of it, and skips ones already there - up to 10,000
at a time. Addresses on the list are refused with `suppressed_recipient`,
which the app should treat as expected, not as an error.

## Test before switching production

- Send to a real Gmail and a real Outlook address and open Show original: SPF, DKIM and DMARC should all say PASS, with DKIM signed as your own domain.
- Send a message with an attachment and one with an inline image, and check both render.
- Trigger a bounce (an address at a domain you control with no mailbox) and confirm your webhook handler receives email.bounced and marks the address.
- Send the same request twice with one Idempotency-Key and confirm only one email arrives.
- Point a staging environment at the new API key first, and watch the Logs page for 4xx responses before switching production.
- Keep the old provider's DNS records until the new domain has verified and a day of production mail has been delivered - removing them first breaks mail still in flight.
