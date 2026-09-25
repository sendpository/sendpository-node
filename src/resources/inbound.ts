import type { HttpClient } from "../http.js";
import type {
  CreateInboundAddress,
  InboundAddress,
  InboundMessage,
  InboundMessageSummary,
  ListParams,
  Paginated,
} from "../types.js";

/** Receiving addresses. All of these need a key with `full_access`. */
export class InboundAddresses {
  constructor(private readonly http: HttpClient) {}

  async list() {
    const res = await this.http.request<{ data: InboundAddress[] }>("GET", "/inbound/addresses");
    return res.data;
  }

  /**
   * Starts receiving at an address on a verified domain. `status` is
   * `pending` until the host's MX points at us - `dns_record` says what to
   * publish - and `active` once mail is routed.
   */
  create(input: CreateInboundAddress) {
    return this.http.request<InboundAddress>("POST", "/inbound/addresses", { body: input });
  }

  /** Stops receiving. Messages already received are kept. */
  delete(id: string) {
    return this.http.request<{ id: string; address: string; deleted: true }>(
      "DELETE",
      `/inbound/addresses/${encodeURIComponent(id)}`,
    );
  }
}

/**
 * Mail that arrived at your receiving addresses. Needs a key with
 * `full_access`: reading someone's incoming mail is a different power from
 * sending it.
 */
export class Inbound {
  readonly addresses: InboundAddresses;

  constructor(private readonly http: HttpClient) {
    this.addresses = new InboundAddresses(http);
  }

  /** Newest first. Metadata only - fetch one message for its bodies. */
  list(
    params: ListParams & {
      status?: "received" | "spam";
      /** Only mail that arrived at this receiving address. */
      address?: string;
      /** ISO 8601. */
      received_after?: string;
      received_before?: string;
    } = {},
  ) {
    return this.http.request<Paginated<InboundMessageSummary> & { total: number }>("GET", "/inbound", {
      query: { ...params },
    });
  }

  /** One message, with its text and HTML bodies and the sender check. */
  get(id: string) {
    return this.http.request<InboundMessage>("GET", `/inbound/${encodeURIComponent(id)}`);
  }
}
