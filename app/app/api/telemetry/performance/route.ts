import { parsePerformanceBatch } from "@/lib/performance-schema";

let windowStart = 0;
let batches = 0;
const MAX_BYTES = 4096;
const empty = (status = 204) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      // Host/protocol survive the trusted reverse proxy even when Next's
      // internal URL uses its container address.
      const expected = new URL(request.url);
      const host = request.headers.get("host");
      const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
      if (host) expected.host = host;
      if (protocol === "http" || protocol === "https") expected.protocol = protocol + ":";
      if (new URL(origin).origin !== expected.origin) return empty(403);
    } catch { return empty(403); }
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) return empty(415);
  if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); batches = 0; }
  // Per-process ingress/log budget. No storage of visitor IP or identity.
  if (++batches > 120) return empty(429);
  const reader = request.body?.getReader();
  if (!reader) return empty(400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); return empty(413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const metrics = parsePerformanceBatch(JSON.parse(new TextDecoder().decode(bytes)));
    if (!metrics) return empty(400);
    console.info(JSON.stringify({ event: "oren.performance", metrics }));
    return empty();
  } catch {
    return empty(400);
  } finally {
    reader.releaseLock();
  }
}
