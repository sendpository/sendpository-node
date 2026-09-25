import { SendpositoryError, type SendpositoryErrorType } from "./errors.js";

export interface ClientOptions {
  /** Your API key. Keep it on a server - never ship one to a browser. */
  apiKey: string;
  /** Override for self-hosted installs. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Default 30s. */
  timeout?: number;
  /**
   * How many times to retry a retryable failure. Default 2.
   *
   * Only rate limits, 5xx and network errors are retried - never a validation
   * error, which would fail identically every time.
   */
  maxRetries?: number;
  fetch?: typeof globalThis.fetch;
}

const DEFAULT_BASE = "https://api.sendpository.com/v1";

/** Replaced with the package version at build time (tsup.config.ts). */
declare const __SDK_VERSION__: string;
const VERSION = typeof __SDK_VERSION__ === "string" ? __SDK_VERSION__ : "dev";

export class HttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: ClientOptions) {
    if (!options?.apiKey) {
      throw new Error("A Sendpository API key is required. Pass { apiKey } or set SENDPOSITORY_API_KEY.");
    }

    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
    this.timeout = options.timeout ?? 30_000;
    this.maxRetries = Math.max(0, options.maxRetries ?? 2);
    this.fetchImpl = options.fetch ?? globalThis.fetch;

    if (typeof this.fetchImpl !== "function") {
      throw new Error("No fetch implementation found. Use Node 18+, or pass { fetch }.");
    }
  }

  async request<T>(
    method: string,
    path: string,
    opts: {
      body?: unknown;
      query?: Record<string, unknown>;
      idempotencyKey?: string;
      /**
       * False for requests the server can't de-duplicate. A timeout or 5xx is
       * ambiguous - the work may already have happened - so retrying one of
       * those could do it twice. Rate limits are still retried: a 429 is
       * refused before anything runs.
       */
      retryAmbiguous?: boolean;
    } = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      "User-Agent": `sendpository-node/${VERSION}`,
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

    let lastError: SendpositoryError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await this.fetchImpl(url.toString(), {
          method,
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: AbortSignal.timeout(this.timeout),
        });

        if (res.ok) {
          if (res.status === 204) return undefined as T;
          return (await res.json()) as T;
        }

        const payload = (await res.json().catch(() => null)) as
          | { error?: { type?: string; message?: string } }
          | null;

        const error = new SendpositoryError({
          type: (payload?.error?.type as SendpositoryErrorType) ?? "internal_error",
          message: payload?.error?.message ?? `Request failed with status ${res.status}`,
          status: res.status,
          retryAfter: Number(res.headers.get("retry-after")) || undefined,
        });

        const ambiguous = error.status >= 500;
        if (!error.isRetryable || attempt === this.maxRetries || (ambiguous && opts.retryAmbiguous === false)) {
          throw error;
        }
        lastError = error;
        // Honour Retry-After exactly; retrying sooner just burns the budget.
        await sleep(error.retryAfter ? error.retryAfter * 1000 : backoff(attempt));
      } catch (err) {
        // Thrown above only once the decision not to retry has been made.
        if (err instanceof SendpositoryError) throw err;

        const wrapped = new SendpositoryError({
          type: "connection_error",
          message: err instanceof Error ? err.message : "Network request failed",
          status: 0,
        });
        if (attempt === this.maxRetries || opts.retryAmbiguous === false) throw wrapped;
        lastError = wrapped;
        await sleep(backoff(attempt));
      }
    }

    throw lastError ?? new SendpositoryError({
      type: "internal_error",
      message: "Request failed",
      status: 0,
    });
  }
}

/** Exponential backoff with jitter, so retries don't arrive in lockstep. */
const backoff = (attempt: number) =>
  Math.min(8_000, 2 ** attempt * 500) + Math.random() * 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
