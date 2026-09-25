export type EmailStatus =
  | "queued" | "scheduled" | "sent" | "delivered"
  | "delayed" | "bounced" | "complained" | "failed" | "cancelled";

/** `"a@b.com"` or `"Name <a@b.com>"`. */
export type Address = string;

export interface Attachment {
  /**
   * Programs are refused - `.exe`, `.msi`, `.bat`, `.js`, `.vbs`, `.ps1`,
   * `.scr`, `.jar`, `.iso` and similar - with a `validation_error`.
   */
  filename: string;
  /** Base64. A `data:` URI prefix is accepted and stripped. */
  content: string;
  content_type?: string;
  /**
   * Embeds the attachment in the HTML rather than listing it as a download.
   *
   * Reference it with the same value: `content_id: "logo"` is reached by
   * `<img src="cid:logo">`. Angle brackets are accepted and stripped, so a
   * value copied from either the header or the URL works.
   */
  content_id?: string;
}

export interface SendEmailOptions {
  /** Must be an address on a verified domain. */
  from: Address;
  to: Address | Address[];
  subject: string;
  html?: string;
  text?: string;
  cc?: Address | Address[];
  /** Never appears in the delivered headers. */
  bcc?: Address | Address[];
  reply_to?: Address | Address[];
  headers?: Record<string, string>;
  /** String key/values, for filtering in the dashboard. */
  tags?: Record<string, string>;
  /** Up to 10 files, 10 MB decoded. Cannot be combined with `scheduled_at`. */
  attachments?: Attachment[];
  /** ISO 8601. A time in the past sends immediately. */
  scheduled_at?: string;
  /** Record opens with a tracking pixel. Off by default; needs an HTML body. */
  track_opens?: boolean;
  /** Record link clicks. Off by default; needs an HTML body. */
  track_clicks?: boolean;
  /**
   * Add one-click unsubscribe headers (RFC 8058) - required by Gmail and Yahoo
   * for bulk mail. A `{{unsubscribe_url}}` in html or text turns this on and is
   * replaced with the visible link. Single-recipient messages only.
   */
  list_unsubscribe?: boolean;
}

export interface SentEmail {
  id: string;
}

/**
 * Everything a message's timeline can contain.
 *
 * A superset of `WebhookEvent`: `queued` and `cancelled` happen entirely on our
 * side, so there is nothing to notify anybody about, but they are part of the
 * story when you read the message back. Same spelling either way.
 */
export type EmailEventType = WebhookEvent | "email.queued" | "email.cancelled";

export interface EmailEvent {
  /**
   * The same names webhooks use - "email.delivered", not "delivered".
   *
   * These were reported bare while `WebhookPayload.type` was prefixed, so
   * anyone consuming both had to keep a translation table. One vocabulary now.
   */
  type: EmailEventType;
  occurred_at: string;
}

export interface Email {
  id: string;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  reply_to: string[];
  subject: string;
  html: string | null;
  text: string | null;
  tags: Record<string, string> | null;
  status: EmailStatus;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  events: EmailEvent[];
}

export interface EmailListItem {
  id: string;
  to: string[];
  subject: string;
  status: EmailStatus;
  created_at: string;
}

/** One entry per message: the id, or the error that stopped it. */
export type BatchResult = { id: string } | { error: { type: string; message: string } };

export type DomainStatus = "not_started" | "pending" | "verified" | "failed";

export interface DnsRecord {
  type: "TXT" | "CNAME" | "MX";
  name: string;
  value: string;
  purpose: "spf" | "dkim" | "dmarc" | "return_path";
  verified: boolean;
}

export interface Domain {
  id: string;
  name: string;
  status: DomainStatus;
  records: DnsRecord[];
  created_at: string;
  verified_at?: string | null;
  last_checked_at?: string | null;
}

export type ApiKeyPermission = "sending" | "full_access";

export interface ApiKey {
  id: string;
  name: string;
  /** Masked to its prefix, except on create. */
  token: string;
  permission: ApiKeyPermission;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/** Only returned once, when the key is created. */
export interface CreatedApiKey extends Omit<ApiKey, "token"> {
  token: string;
}

export type WebhookEvent =
  | "email.scheduled" | "email.sent" | "email.delivered" | "email.delayed"
  | "email.bounced" | "email.complained" | "email.failed"
  | "email.opened" | "email.clicked" | "email.unsubscribed"
  | "email.received";

export interface WebhookEndpoint {
  id: string;
  url: string;
  description?: string | null;
  events: WebhookEvent[] | "all";
  enabled: boolean;
  last_delivery_at: string | null;
  last_status_code: number | null;
  created_at: string;
}

export interface CreatedWebhookEndpoint extends WebhookEndpoint {
  /** Shown once. Store it - you need it to verify incoming deliveries. */
  secret: string;
}

export interface LogEntry {
  id: string;
  method: string;
  endpoint: string;
  status_code: number;
  error_code: string | null;
  duration_ms: number;
  source: string;
  created_at: string;
  ip?: string | null;
  user_agent?: string | null;
  api_key_id?: string | null;
}

/**
 * The payload delivered to your webhook endpoint. Narrow on `type`:
 * `email.received` carries an inbound message, every other event a sent one.
 */
export type WebhookPayload = EmailWebhookPayload | EmailReceivedWebhookPayload;

export interface EmailReceivedWebhookPayload {
  type: "email.received";
  created_at: string;
  data: EmailReceivedData;
}

/** A delivery about mail you sent. */
export interface EmailWebhookPayload {
  type: Exclude<WebhookEvent, "email.received">;
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject: string;
    status: EmailStatus;
    tags?: Record<string, string>;
    scheduled_at?: string;

    /* ---- email.opened and email.clicked carry what actually happened ---- */

    /** The link that was followed. `email.clicked` only. */
    url?: string;
    /** When. Present on the event it belongs to. */
    opened_at?: string;
    clicked_at?: string;
    /**
     * Total so far for this message, machine fetches excluded - so a second
     * open is distinguishable from the first.
     */
    open_count?: number;
    click_count?: number;
    /**
     * The client that did it, where we have one. Not the recipient's IP: we
     * record that to tell a proxy from a person, and it is not ours to pass on.
     */
    user_agent?: string;
  };
}

/* ------------------------------------------------------------ receiving --- */

/**
 * Whether the From line is telling the truth, from SPF, DKIM and DMARC:
 * `verified` the sender's domain vouches for it; `failed` treat it as forged;
 * `unverified` the domain publishes nothing either way; `unchecked` there was
 * nothing to check. Check for `verified` before an automation acts on mail.
 */
export type SenderVerdict = "verified" | "failed" | "unverified" | "unchecked";

export interface InboundAuth {
  spf: string;
  dkim: string;
  dmarc: string;
  spf_domain?: string;
  dkim_domain?: string;
}

/** A received message in a list - metadata only. */
export interface InboundMessageSummary {
  id: string;
  from: string;
  /** The receiving address it arrived at. */
  to: string;
  subject: string;
  status: "received" | "spam";
  spam_score: number | null;
  size_bytes: number;
  received_at: string;
}

/** One received message, with its bodies. */
export interface InboundMessage {
  id: string;
  from: string;
  from_name?: string;
  to: string[];
  cc: string[];
  /** The receiving address it arrived at. */
  recipient: string;
  reply_to?: string;
  subject: string;
  text: string | null;
  html: string | null;
  headers?: Record<string, string>;
  /** Names, types and sizes. The bytes are never stored. */
  attachments: Array<{ filename: string; contentType: string; size: number }>;
  status: "received" | "spam";
  spam_status?: string;
  spam_score?: number;
  sender_verdict: SenderVerdict;
  /** Absent when the message was not checked. */
  auth?: InboundAuth;
  size_bytes: number;
  message_id?: string;
  received_at: string;
}

export interface InboundAddress {
  id: string;
  /** `support@sp.yourdomain.com`, or `*@sp.yourdomain.com` for a catch-all. */
  address: string;
  domain: string;
  host: string;
  local_part: string;
  /** `active` once the MX points at us and the mail server routes it. */
  status: "pending" | "active" | "failed";
  /** The MX record still to publish, while pending. */
  dns_record?: { type: "MX"; name: string; value: string; priority: number };
  error?: string;
  created_at: string;
}

export interface CreateInboundAddress {
  domain_id: string;
  /** The mailbox, or `*` for everything at the host. */
  local_part: string;
  /** Defaults to the domain's receiving host. */
  host?: string;
}

/** The `data` of an `email.received` webhook. */
export interface EmailReceivedData {
  inbound_id: string;
  to: string;
  from: string;
  from_name?: string;
  subject: string;
  message_id?: string;
  received_at: string;
  size_bytes: number;
  spam: boolean;
  sender_verdict: SenderVerdict;
  attachments: Array<{ filename: string; content_type: string; size: number }>;
  /** The first 500 characters of the text body. */
  text_preview?: string;
}

export interface Paginated<T> {
  data: T[];
  limit: number;
  offset: number;
}

export interface ListParams {
  limit?: number;
  offset?: number;
}
