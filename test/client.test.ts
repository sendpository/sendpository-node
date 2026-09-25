import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Sendpository, SendpositoryError, isValidWebhook, verifyWebhook } from "../src/index.js";

/** A fetch that replays the given responses in order and records each request. */
function fakeFetch(...responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status,
      headers: { "content-type": "application/json", ...r.headers },
    });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const header = (calls: Array<{ init: RequestInit }>, i: number, name: string) =>
  (calls[i]!.init.headers as Record<string, string>)[name];

const message = { from: "Acme <hi@mail.acme.test>", to: ["a@example.com"], subject: "Hi", html: "<p>Hi</p>" };

describe("emails.send", () => {
  it("returns the id", async () => {
    const { fetch } = fakeFetch({ status: 200, body: { id: "abc" } });
    const client = new Sendpository("sp_test", { fetch });
    await expect(client.emails.send(message)).resolves.toEqual({ id: "abc" });
  });

  it("uses one idempotency key across its own retries", async () => {
    const { fetch, calls } = fakeFetch(
      { status: 500, body: { error: { type: "internal_error", message: "boom" } } },
      { status: 200, body: { id: "abc" } },
    );
    const client = new Sendpository("sp_test", { fetch });
    await client.emails.send(message);
    expect(calls).toHaveLength(2);
    const key = header(calls, 0, "Idempotency-Key");
    expect(key).toMatch(/^sdk-/);
    expect(header(calls, 1, "Idempotency-Key")).toBe(key);
  });

  it("sends the caller's idempotency key unchanged", async () => {
    const { fetch, calls } = fakeFetch({ status: 200, body: { id: "abc" } });
    const client = new Sendpository("sp_test", { fetch });
    await client.emails.send(message, { idempotencyKey: "order-42" });
    expect(header(calls, 0, "Idempotency-Key")).toBe("order-42");
  });

  it("throws a typed error and does not retry a validation error", async () => {
    const { fetch, calls } = fakeFetch({
      status: 422,
      body: { error: { type: "validation_error", message: "bad address" } },
    });
    const client = new Sendpository("sp_test", { fetch });
    const err = await client.emails.send(message).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SendpositoryError);
    expect((err as SendpositoryError).type).toBe("validation_error");
    expect(calls).toHaveLength(1);
  });

  it("retries a rate limit", async () => {
    const { fetch, calls } = fakeFetch(
      { status: 429, body: { error: { type: "rate_limit_exceeded", message: "slow" } } },
      { status: 200, body: { id: "abc" } },
    );
    const client = new Sendpository("sp_test", { fetch });
    await client.emails.send(message);
    expect(calls).toHaveLength(2);
  });
});

describe("emails.sendBatch", () => {
  it("does not retry a 5xx, which may already have sent", async () => {
    const { fetch, calls } = fakeFetch({ status: 502, body: { error: { type: "internal_error", message: "x" } } });
    const client = new Sendpository("sp_test", { fetch });
    await expect(client.emails.sendBatch([message])).rejects.toBeInstanceOf(SendpositoryError);
    expect(calls).toHaveLength(1);
  });
});

describe("verifyWebhook", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ type: "email.delivered", created_at: "2026-09-25T00:00:00Z", data: { email_id: "x" } });
  const sign = (t: number, b = body) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${b}`).digest("hex")}`;
  const now = () => Math.floor(Date.now() / 1000);

  it("accepts a valid signature and returns the event", () => {
    expect(verifyWebhook({ body, signature: sign(now()), secret }).type).toBe("email.delivered");
  });

  it("rejects a tampered body", () => {
    expect(isValidWebhook({ body: body.replace("delivered", "bounced"), signature: sign(now()), secret })).toBe(false);
  });

  it("rejects an old timestamp", () => {
    expect(isValidWebhook({ body, signature: sign(now() - 600), secret })).toBe(false);
  });

  it("rejects a malformed header", () => {
    expect(isValidWebhook({ body, signature: "nonsense", secret })).toBe(false);
  });
});
