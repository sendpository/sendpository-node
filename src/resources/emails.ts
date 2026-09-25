import type { HttpClient } from "../http.js";
import type {
  BatchResult, Email, EmailListItem, SendEmailOptions, SentEmail,
} from "../types.js";

export class Emails {
  constructor(private readonly http: HttpClient) {}

  /**
   * Sends one email.
   *
   * Pass `idempotencyKey` on anything you might retry - replaying the same key
   * returns the original id instead of sending a second copy, which is what
   * you want when an OTP request times out.
   *
   * Without one, the client makes up a key for this call, so its own
   * automatic retries can never send twice. Your key is still better: it also
   * covers your job being retried, which a per-call key can't.
   */
  send(options: SendEmailOptions, opts: { idempotencyKey?: string } = {}) {
    return this.http.request<SentEmail>("POST", "/emails", {
      body: options,
      idempotencyKey: opts.idempotencyKey ?? `sdk-${randomId()}`,
    });
  }

  /**
   * Sends up to 100 messages in one request.
   *
   * Each succeeds or fails on its own, so check every entry - the request
   * returns 200 even when some messages failed.
   */
  async sendBatch(messages: SendEmailOptions[]) {
    if (messages.length > 100) {
      throw new Error("A batch accepts at most 100 messages.");
    }
    const res = await this.http.request<{ data: BatchResult[] }>("POST", "/emails/batch", {
      body: messages,
      // The batch endpoint has no idempotency key yet, so a timeout is not
      // retried - it may already have sent. Check with emails.list() instead.
      retryAmbiguous: false,
    });
    return res.data;
  }

  /** Current status and the full delivery timeline. */
  get(id: string) {
    return this.http.request<Email>("GET", `/emails/${encodeURIComponent(id)}`);
  }

  /**
   * Recent messages, newest first.
   *
   * Paged rather than capped: without an offset, anything older than the most
   * recent page is unreachable through the API even though the dashboard can
   * see it.
   */
  async list(params?: {
    limit?: number;
    offset?: number;
    status?: string;
    /**
     * ISO 8601, or a Date. Narrows to messages created in a window, so
     * "the last 24 hours" is one call rather than paging backwards until the
     * timestamps fall out of range.
     */
    created_after?: string | Date;
    created_before?: string | Date;
  }) {
    const query = new URLSearchParams();
    const iso = (v: string | Date) => (v instanceof Date ? v.toISOString() : v);
    if (params?.limit !== undefined) query.set("limit", String(params.limit));
    if (params?.offset !== undefined) query.set("offset", String(params.offset));
    if (params?.status) query.set("status", params.status);
    if (params?.created_after) query.set("created_after", iso(params.created_after));
    if (params?.created_before) query.set("created_before", iso(params.created_before));

    const suffix = query.size > 0 ? `?${query}` : "";
    const res = await this.http.request<{
      data: EmailListItem[];
      limit?: number;
      offset?: number;
      /** Everything matching the filter, not just this page. */
      total?: number;
    }>("GET", `/emails${suffix}`);

    /*
     * The page, not just its rows.
     *
     * This used to return `res.data` and drop the rest, so a caller could not
     * tell 25 results from 25-of-4,000 without paging to the end and counting.
     * Breaking, and deliberately so - a monitoring dashboard cannot be built on
     * a list that will not say how long it is.
     */
    return {
      data: res.data,
      total: res.total ?? res.data.length,
      limit: res.limit ?? res.data.length,
      offset: res.offset ?? 0,
    };
  }

  /** Stops a scheduled message. Only works while it is still `scheduled`. */
  cancel(id: string) {
    return this.http.request<{ id: string; status: "cancelled" }>(
      "POST",
      `/emails/${encodeURIComponent(id)}/cancel`,
    );
  }
}

/** A random id for per-call idempotency keys; crypto.randomUUID where the runtime has it. */
function randomId() {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}
