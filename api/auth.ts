import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb, baseUrl } from "../lib/db.js";
import { noStore, queryValue } from "../lib/http.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const op = queryValue(req, "op") || "session";

  if (req.method === "GET" && op === "health") {
    try {
      const db = getDb();
      const probe = await db.from("projects").select("id", { count: "exact", head: true });
      return res.status(probe.error ? 503 : 200).json({
        ok: !probe.error,
        app: "LINK Preview Studio",
        version: "3.0.1-direct",
        access_mode: "direct",
        supabase: !probe.error,
        base_url: baseUrl() || null
      });
    } catch (error: any) {
      return res.status(503).json({ ok: false, error: error?.message || "Health check failed" });
    }
  }

  if (req.method === "GET" && op === "session") {
    noStore(res);
    return res.status(200).json({
      user: { id: "direct-studio", email: "Acceso directo" },
      member: { user_id: "direct-studio", role: "owner", status: "active" },
      access_mode: "direct"
    });
  }

  if (req.method === "POST" && (op === "login" || op === "logout")) {
    noStore(res);
    return res.status(200).json({
      ok: true,
      access_mode: "direct",
      message: "Browser authentication is disabled."
    });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Unsupported auth operation" });
}
