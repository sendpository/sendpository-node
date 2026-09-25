import { HttpClient, type ClientOptions } from "./http.js";
import { ApiKeys } from "./resources/api-keys.js";
import { Domains } from "./resources/domains.js";
import { Emails } from "./resources/emails.js";
import { Inbound } from "./resources/inbound.js";
import { Logs } from "./resources/logs.js";
import { Webhooks } from "./resources/webhooks.js";

/**
 * The Sendpository client.
 *
 * @example
 * import { Sendpository } from "sendpository";
 *
 * const sendpository = new Sendpository(process.env.SENDPOSITORY_API_KEY);
 *
 * await sendpository.emails.send({
 *   from: "Acme <hello@mail.yourdomain.com>",
 *   to: ["customer@example.com"],
 *   subject: "Your code is 481920",
 *   html: "<p>It expires in 10 minutes.</p>",
 * });
 */
export class Sendpository {
  readonly emails: Emails;
  readonly domains: Domains;
  readonly apiKeys: ApiKeys;
  readonly webhooks: Webhooks;
  readonly logs: Logs;
  /** Mail received at your receiving addresses, and the addresses themselves. */
  readonly inbound: Inbound;

  constructor(apiKey?: string, options: Omit<ClientOptions, "apiKey"> = {}) {
    // Falling back to the environment keeps keys out of source, which is where
    // they end up when the constructor demands a literal.
    const key = apiKey ?? process.env.SENDPOSITORY_API_KEY;
    if (!key) {
      throw new Error(
        "Missing API key. Pass it to `new Sendpository(key)` or set SENDPOSITORY_API_KEY.",
      );
    }

    const http = new HttpClient({ apiKey: key, ...options });

    this.emails = new Emails(http);
    this.domains = new Domains(http);
    this.apiKeys = new ApiKeys(http);
    this.webhooks = new Webhooks(http);
    this.logs = new Logs(http);
    this.inbound = new Inbound(http);
  }
}

export default Sendpository;

export { SendpositoryError, type SendpositoryErrorType } from "./errors.js";
export { verifyWebhook, isValidWebhook, SignatureVerificationError, type VerifyOptions } from "./verify.js";
export type { ClientOptions } from "./http.js";
export type * from "./types.js";
