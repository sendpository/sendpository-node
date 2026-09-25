import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookPayload } from "./types.js";

/**
 * Verifies that a webhook really came from Sendpository.
 *
 * Your endpoint is a public URL - without this, anyone who finds it can tell
 * your application that an email bounced.
 *
 * Pass the **raw request body**, exactly as received. Parsing the JSON and
 * re-serialising it changes the bytes and the signature will not match.
 */
export class SignatureVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignatureVerificationError";
  }
}

export interface VerifyOptions {
  /** Reject anything older than this, in seconds. Default 300. */
  toleranceSeconds?: number;
}

/**
 * Returns the parsed payload, or throws.
 *
 * @example
 * export async function POST(req: Request) {
 *   const event = verifyWebhook({
 *     body: await req.text(),
 *     signature: req.headers.get("sendpository-signature") ?? "",
 *     secret: process.env.SENDPOSITORY_WEBHOOK_SECRET!,
 *   });
 *   // event is typed
 * }
 */
export function verifyWebhook(input: {
  body: string;
  signature: string;
  secret: string;
  options?: VerifyOptions;
}): WebhookPayload {
  const { body, signature, secret } = input;
  const tolerance = input.options?.toleranceSeconds ?? 300;

  if (!secret) throw new SignatureVerificationError("A webhook signing secret is required.");
  if (!signature) throw new SignatureVerificationError("Missing Sendpository-Signature header.");

  // Header looks like: t=1788026132,v1=4f3a9c...
  const parts: Record<string, string> = {};
  for (const piece of signature.split(",")) {
    const i = piece.indexOf("=");
    if (i > 0) parts[piece.slice(0, i).trim()] = piece.slice(i + 1).trim();
  }

  const timestamp = Number(parts.t);
  const provided = parts.v1;

  if (!timestamp || !provided) {
    throw new SignatureVerificationError("Signature header is malformed.");
  }

  // The timestamp is inside the signed payload, so a captured delivery cannot
  // be replayed against you later.
  const age = Math.abs(Date.now() / 1000 - timestamp);
  if (age > tolerance) {
    throw new SignatureVerificationError(
      `Signature timestamp is ${Math.round(age)}s old, outside the ${tolerance}s tolerance.`,
    );
  }

  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  // Constant time - a plain === leaks how much of the signature matched.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new SignatureVerificationError("Signature does not match.");
  }

  return JSON.parse(body) as WebhookPayload;
}

/** Boolean form, for when you'd rather branch than catch. */
export function isValidWebhook(input: {
  body: string;
  signature: string;
  secret: string;
  options?: VerifyOptions;
}): boolean {
  try {
    verifyWebhook(input);
    return true;
  } catch {
    return false;
  }
}
