import type { NextRequest } from "next/server";

/**
 * Strip hop-by-hop and potentially confusing headers when proxying cross-origin.
 * Sending the frontend's Host to the backend can break TLS/SNI routing and cause timeouts.
 */
const STRIP_REQUEST = new Set([
  "host",
  "connection",
  "transfer-encoding",
  "content-length",
  "accept-encoding", // let fetch decide
  "sec-fetch-mode",
  "sec-fetch-dest",
  "sec-fetch-site",
  "upgrade-insecure-requests",
]);

export function filteredRequestHeaders(req: NextRequest): Headers {
  const h = new Headers();
  req.headers.forEach((v, k) => {
    const key = k.toLowerCase();
    if (!STRIP_REQUEST.has(key)) h.set(k, v);
  });
  // Ensure JSON for our POSTs unless caller overrides
  if (!h.has("content-type")) h.set("content-type", "application/json");
  return h;
}

const STRIP_RESPONSE = ["connection", "transfer-encoding", "content-encoding"];

export function filteredResponseHeaders(upstream: Response): Headers {
  const h = new Headers(upstream.headers);
  STRIP_RESPONSE.forEach((k) => h.delete(k));
  return h;
}
