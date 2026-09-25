import type { HttpClient } from "../http.js";
import type { ApiKey, ApiKeyPermission, CreatedApiKey, ListParams, Paginated } from "../types.js";

/** All of these need a key with `full_access`. */
export class ApiKeys {
  constructor(private readonly http: HttpClient) {}

  /**
   * Mints a key. The plaintext token comes back once, here - only a hash is
   * stored, so it cannot be recovered later, only rotated.
   */
  create(options: { name: string; permission?: ApiKeyPermission }) {
    return this.http.request<CreatedApiKey>("POST", "/api-keys", { body: options });
  }

  list(params: ListParams = {}) {
    return this.http.request<Paginated<ApiKey>>("GET", "/api-keys", { query: { ...params } });
  }

  get(id: string) {
    return this.http.request<ApiKey>("GET", `/api-keys/${encodeURIComponent(id)}`);
  }

  /** The name is all that's mutable - a token never changes. */
  update(id: string, options: { name: string }) {
    return this.http.request<ApiKey>("PATCH", `/api-keys/${encodeURIComponent(id)}`, {
      body: options,
    });
  }

  /** Revokes rather than deletes. A key cannot revoke itself. */
  revoke(id: string) {
    return this.http.request<{ id: string; revoked: true }>(
      "DELETE",
      `/api-keys/${encodeURIComponent(id)}`,
    );
  }
}
