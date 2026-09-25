import type { HttpClient } from "../http.js";
import type { ListParams, LogEntry, Paginated } from "../types.js";

/** All of these need a key with `full_access`. */
export class Logs {
  constructor(private readonly http: HttpClient) {}

  list(params: ListParams & { status?: "2xx" | "4xx" | "5xx"; endpoint?: string } = {}) {
    return this.http.request<Paginated<LogEntry>>("GET", "/logs", { query: { ...params } });
  }

  get(id: string) {
    return this.http.request<LogEntry>("GET", `/logs/${encodeURIComponent(id)}`);
  }
}
