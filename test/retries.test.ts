import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sendpository, SendpositoryError } from "../src/index.js";

/**
 * When may the client retry? A failure is either
 *
 *   refused     - a 429: the server turned it away before doing anything
 *   ambiguous   - a 5xx, a timeout, a network error, or a 2xx whose body
 *                 couldn't be read: the work may or may not have happened
 *   definite    - any other 4xx: it will fail the same way every time
 *
 * and an operation is either safe to repeat (a read, or a write the server
 * de-duplicates by idempotency key) or not. Refused is always retried,
 * definite never, and ambiguous only when repeating is safe - otherwise a
 * retry could create a second API key, a second webhook or a second batch of
 * email. This file checks every operation against every failure.
 */

type Step =
  | { status: number; json?: unknown; raw?: string; headers?: Record<string, string> }
  | { throws: Error };

function scripted(...steps: Step[]) {
  const calls: Array<{ method: string; url: string; headers: Record<string, string> }> = [];
  const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ method: String(init.method), url, headers: init.headers as Record<string, string> });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)]!;
    if ("throws" in step) throw step.throws;
    const body = step.raw ?? (step.json === undefined ? null : JSON.stringify(step.json));
    return new Response(body, { status: step.status, headers: { "content-type": "application/json", ...step.headers } });
  });
  return { fetch: fetchFn as unknown as typeof fetch, calls };
}

const OK: Step = { status: 200, json: { id: "ok", data: [{ id: "ok" }], limit: 25, offset: 0, total: 1 } };
const timeout = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
const msg = { from: "a@b.test", to: ["c@d.test"], subject: "s", text: "t" };

type Client = Sendpository;
const OPERATIONS: Array<{ name: string; safe: boolean; run: (c: Client) => Promise<unknown> }> = [
  { name: "emails.get (GET)", safe: true, run: (c) => c.emails.get("e1") },
  { name: "emails.list (GET)", safe: true, run: (c) => c.emails.list() },
  { name: "domains.list (GET)", safe: true, run: (c) => c.domains.list() },
  { name: "emails.send, generated key", safe: true, run: (c) => c.emails.send(msg) },
  { name: "emails.send, caller's key", safe: true, run: (c) => c.emails.send(msg, { idempotencyKey: "otp-42" }) },
  { name: "emails.sendBatch", safe: false, run: (c) => c.emails.sendBatch([msg, msg]) },
  { name: "emails.cancel", safe: false, run: (c) => c.emails.cancel("e1") },
  { name: "apiKeys.create", safe: false, run: (c) => c.apiKeys.create({ name: "ci" }) },
  { name: "apiKeys.update (PATCH)", safe: false, run: (c) => c.apiKeys.update("k1", { name: "x" }) },
  { name: "apiKeys.revoke (DELETE)", safe: false, run: (c) => c.apiKeys.revoke("k1") },
  { name: "webhooks.create", safe: false, run: (c) => c.webhooks.create({ url: "https://x.test/h" }) },
  { name: "domains.create", safe: false, run: (c) => c.domains.create("mail.x.test") },
  { name: "domains.verify", safe: false, run: (c) => c.domains.verify("d1") },
];

const FAILURES: Array<{ name: string; step: Step; kind: "refused" | "ambiguous" | "definite"; type: string }> = [
  { name: "429 with Retry-After", kind: "refused", type: "rate_limit_exceeded",
    step: { status: 429, json: { error: { type: "rate_limit_exceeded", message: "slow" } }, headers: { "retry-after": "2" } } },
  { name: "429 without a JSON body", kind: "refused", type: "rate_limit_exceeded", step: { status: 429, raw: "Too Many Requests" } },
  { name: "500 JSON", kind: "ambiguous", type: "internal_error",
    step: { status: 500, json: { error: { type: "internal_error", message: "boom" } } } },
  { name: "502 HTML from a proxy", kind: "ambiguous", type: "internal_error", step: { status: 502, raw: "<html>Bad gateway</html>" } },
  { name: "503", kind: "ambiguous", type: "internal_error", step: { status: 503, raw: "" } },
  { name: "network error", kind: "ambiguous", type: "connection_error", step: { throws: new TypeError("fetch failed") } },
  { name: "timeout", kind: "ambiguous", type: "connection_error", step: { throws: timeout() } },
  { name: "200 with an unreadable body", kind: "ambiguous", type: "internal_error", step: { status: 200, raw: "<html>" } },
  { name: "422 validation", kind: "definite", type: "validation_error",
    step: { status: 422, json: { error: { type: "validation_error", message: "bad" } } } },
  { name: "401", kind: "definite", type: "authentication_error",
    step: { status: 401, json: { error: { type: "authentication_error", message: "no" } } } },
  { name: "402 quota", kind: "definite", type: "quota_exceeded",
    step: { status: 402, json: { error: { type: "quota_exceeded", message: "full" } } } },
  { name: "404 HTML (wrong base URL)", kind: "definite", type: "not_found", step: { status: 404, raw: "<html>Not found</html>" } },
  { name: "413 from the platform", kind: "definite", type: "validation_error", step: { status: 413, raw: "Payload too large" } },
];

/** Runs a call to completion with fake timers, whatever backoff it sleeps through. */
async function settle<T>(promise: Promise<T>) {
  const outcome = promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  await vi.runAllTimersAsync();
  return outcome;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("retry matrix: every operation against every failure", () => {
  for (const op of OPERATIONS) {
    describe(op.name, () => {
      for (const f of FAILURES) {
        const retried = f.kind === "refused" || (f.kind === "ambiguous" && op.safe);
        it(`${f.name} -> ${retried ? "retried, then succeeds" : `not retried, ${f.type}`}`, async () => {
          const { fetch, calls } = scripted(f.step, OK);
          const client = new Sendpository("sp_test", { fetch });
          const result = await settle(op.run(client));

          if (retried) {
            expect(result.ok).toBe(true);
            expect(calls).toHaveLength(2);
          } else {
            expect(result.ok).toBe(false);
            expect(calls).toHaveLength(1);
            const error = (result as { error: unknown }).error;
            expect(error).toBeInstanceOf(SendpositoryError);
            expect((error as SendpositoryError).type).toBe(f.type);
          }
          // Whatever happened, every attempt of one call carries one key.
          const keys = new Set(calls.map((c) => c.headers["Idempotency-Key"]));
          expect(keys.size).toBe(1);
        });
      }
    });
  }
});

describe("idempotency keys", () => {
  it("a send without a key gets a generated one, the same on every attempt", async () => {
    const { fetch, calls } = scripted({ throws: timeout() }, { status: 503, raw: "" }, OK);
    await settle(new Sendpository("sp_test", { fetch }).emails.send(msg));
    expect(calls).toHaveLength(3);
    const keys = calls.map((c) => c.headers["Idempotency-Key"]);
    expect(keys[0]).toMatch(/^sdk-/);
    expect(new Set(keys).size).toBe(1);
  });

  it("two separate sends get different generated keys", async () => {
    const { fetch, calls } = scripted(OK);
    const client = new Sendpository("sp_test", { fetch });
    await settle(client.emails.send(msg));
    await settle(client.emails.send(msg));
    expect(calls[0]!.headers["Idempotency-Key"]).not.toBe(calls[1]!.headers["Idempotency-Key"]);
  });

  it("the caller's key is sent verbatim", async () => {
    const { fetch, calls } = scripted(OK);
    await settle(new Sendpository("sp_test", { fetch }).emails.send(msg, { idempotencyKey: "otp-user-7" }));
    expect(calls[0]!.headers["Idempotency-Key"]).toBe("otp-user-7");
  });

  it("only sends carry one - a batch has none to rely on", async () => {
    const { fetch, calls } = scripted(OK);
    await settle(new Sendpository("sp_test", { fetch }).emails.sendBatch([msg]));
    expect(calls[0]!.headers["Idempotency-Key"]).toBeUndefined();
  });
});

describe("limits and timing", () => {
  it("gives up after maxRetries and throws the last failure", async () => {
    const { fetch, calls } = scripted({ status: 500, json: { error: { type: "internal_error", message: "x" } } });
    const result = await settle(new Sendpository("sp_test", { fetch }).emails.get("e1"));
    expect(calls).toHaveLength(3); // 1 + 2 retries by default
    expect(result.ok).toBe(false);
    expect((result as { error: SendpositoryError }).error.type).toBe("internal_error");
  });

  it("a batch still retries a rate limit, and reports it with Retry-After when it runs out", async () => {
    const limited: Step = { status: 429, json: { error: { type: "rate_limit_exceeded", message: "x" } }, headers: { "retry-after": "1" } };
    const { fetch, calls } = scripted(limited);
    const result = await settle(new Sendpository("sp_test", { fetch }).emails.sendBatch([msg]));
    expect(calls).toHaveLength(3);
    const error = (result as { error: SendpositoryError }).error;
    expect(error.type).toBe("rate_limit_exceeded");
    expect(error.retryAfter).toBe(1);
  });

  it("maxRetries: 0 makes exactly one attempt", async () => {
    const { fetch, calls } = scripted({ throws: timeout() }, OK);
    const result = await settle(new Sendpository("sp_test", { fetch, maxRetries: 0 }).emails.get("e1"));
    expect(calls).toHaveLength(1);
    expect(result.ok).toBe(false);
  });

  it("maxRetries is honoured above the default", async () => {
    const { fetch, calls } = scripted({ status: 503, raw: "" });
    await settle(new Sendpository("sp_test", { fetch, maxRetries: 5 }).emails.get("e1"));
    expect(calls).toHaveLength(6);
  });

  it("waits exactly as long as Retry-After says", async () => {
    const { fetch, calls } = scripted(
      { status: 429, json: { error: { type: "rate_limit_exceeded", message: "x" } }, headers: { "retry-after": "2" } },
      OK,
    );
    const done = new Sendpository("sp_test", { fetch }).emails.get("e1");
    await vi.advanceTimersByTimeAsync(1999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    await expect(done).resolves.toBeTruthy();
  });

  it("an unreadable success says it succeeded, rather than blaming the network", async () => {
    const { fetch } = scripted({ status: 200, raw: "<html>" });
    const result = await settle(new Sendpository("sp_test", { fetch }).apiKeys.create({ name: "k" }));
    const error = (result as { error: SendpositoryError }).error;
    expect(error.type).toBe("internal_error");
    expect(error.message).toMatch(/succeeded/);
  });
});
