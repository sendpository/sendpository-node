import type { HttpClient } from "../http.js";
import type {
  CreatedWebhookEndpoint, ListParams, Paginated, WebhookEndpoint, WebhookEvent,
} from "../types.js";

/** All of these need a key with `full_access`. */
export class Webhooks {
  constructor(private readonly http: HttpClient) {}

  /**
   * Registers an endpoint. The signing secret is returned once - store it, you
   * need it to verify every incoming delivery.
   *
   * Omit `events` to receive everything.
   */
  create(options: { url: string; description?: string; events?: WebhookEvent[] }) {
    return this.http.request<CreatedWebhookEndpoint>("POST", "/webhooks", { body: options });
  }

  list(params: ListParams = {}) {
    return this.http.request<Paginated<WebhookEndpoint>>("GET", "/webhooks", {
      query: { ...params },
    });
  }

  delete(id: string) {
    return this.http.request<{ id: string; deleted: true }>(
      "DELETE",
      `/webhooks/${encodeURIComponent(id)}`,
    );
  }
}
