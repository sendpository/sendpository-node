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
       * Whether an ambiguous failure - a 5xx, a timeout, a network error, or a
       * 2xx whose body couldn't be read - may be retried. The work may already
       * have happened, so a retry is only safe when repeating it can't do it
       * twice. Defaults to true for reads (GET) and for requests carrying an
       * idempotency key (the server de-duplicates those), false for everything
       * else. Rate limits are retried regardless: a 429 is refused before
       * anything runs.
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
    // Set once, outside the loop, so every attempt carries the same key.
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

    const safeToRepeat =
      opts.retryAmbiguous ?? (method.toUpperCase() === "GET" || Boolean(opts.idempotencyKey));

    for (let attempt = 0; ; attempt++) {
      let failure: SendpositoryError;
      let ambiguous: boolean;

      let res: Response | null = null;
      try {
        res = await this.fetchImpl(url.toString(), {
          method,
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: AbortSignal.timeout(this.timeout),
        });
      } catch (err) {
        // No response at all: refused, reset, or timed out. The request may
        // still have reached the server and run.
        failure = new SendpositoryError({
          type: "connection_error",
          message: err instanceof Error ? err.message : "Network request failed",
          status: 0,
        });
        ambiguous = true;
      }

      if (res) {
        if (res.ok) {
          if (res.status === 204) return undefined as T;
          try {
            return (await res.json()) as T;
          } catch {
            // It succeeded, but we can't say with what - not a network error.
            failure = new SendpositoryError({
              type: "internal_error",
              message: `The request succeeded (${res.status}) but its response could not be read.`,
              status: res.status,
            });
            ambiguous = true;
          }
        } else {
          failure = await errorFrom(res);
          ambiguous = res.status >= 500;
        }
      }

      const retry =
        attempt < this.maxRetries &&
        (failure!.type === "rate_limit_exceeded" || (ambiguous! && safeToRepeat));
      if (!retry) throw failure!;
      // Honour Retry-After exactly; retrying sooner just burns the budget.
      await sleep(failure!.retryAfter ? failure!.retryAfter * 1000 : backoff(attempt));
    }
  }
}

/**
 * An error from a non-2xx response. The API always answers with a typed JSON
 * error; anything else came from something in between (a proxy, a wrong base
 * URL, a platform limit), so the type is read from the status instead of
 * being assumed to be ours - a 404 page is not an internal error to retry.
 */
async function errorFrom(res: Response) {
  const payload = (await res.json().catch(() => null)) as { error?: { type?: string; message?: string } } | null;
  return new SendpositoryError({
    type: (payload?.error?.type as SendpositoryErrorType | undefined) ?? typeForStatus(res.status),
    message: payload?.error?.message ?? `Request failed with status ${res.status}`,
    status: res.status,
    retryAfter: Number(res.headers.get("retry-after")) || undefined,
  });
}

function typeForStatus(status: number): SendpositoryErrorType {
  if (status === 429) return "rate_limit_exceeded";
  if (status >= 500) return "internal_error";
  if (status === 401) return "authentication_error";
  if (status === 403) return "permission_denied";
  if (status === 404) return "not_found";
  return "validation_error";
}

/** Exponential backoff with jitter, so retries don't arrive in lockstep. */
const backoff = (attempt: number) =>
  Math.min(8_000, 2 ** attempt * 500) + Math.random() * 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
