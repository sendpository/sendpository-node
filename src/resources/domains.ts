import type { HttpClient } from "../http.js";
import type { Domain } from "../types.js";

export class Domains {
  constructor(private readonly http: HttpClient) {}

  /** Adds a domain and returns the DNS records to publish. */
  create(name: string) {
    return this.http.request<Domain>("POST", "/domains", { body: { name } });
  }

  async list() {
    const res = await this.http.request<{ data: Domain[] }>("GET", "/domains");
    return res.data;
  }

  get(id: string) {
    return this.http.request<Domain>("GET", `/domains/${encodeURIComponent(id)}`);
  }

  /**
   * Re-checks DNS now. Nothing is cached, so it is safe to poll - every call
   * is a fresh lookup. `status` turns `verified` once SPF and DKIM resolve.
   */
  verify(id: string) {
    return this.http.request<Domain>("POST", `/domains/${encodeURIComponent(id)}/verify`);
  }

  /** Requires a full-access key. Sending from the domain stops immediately. */
  delete(id: string) {
    return this.http.request<{ id: string; deleted: true }>(
      "DELETE",
      `/domains/${encodeURIComponent(id)}`,
    );
  }
}
