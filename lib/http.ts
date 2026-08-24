import type { VercelRequest } from "@vercel/node";

export function parseBody(req: VercelRequest): Record<string, any> {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body || "{}"); }
    catch { return {}; }
  }
  return req.body as Record<string, any>;
}

export function queryValue(req: VercelRequest, key: string) {
  const value = req.query[key];
  if (Array.isArray(value)) return String(value[0] || "");
  return String(value || "");
}

export function noStore(res: any) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
}
