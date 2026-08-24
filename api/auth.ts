import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb, getPublicAuthClient, baseUrl } from "../lib/db.js";
import { clearSessionCookies, ensureMember, requireMember, setSessionCookies } from "../lib/auth.js";
import { parseBody, queryValue, noStore } from "../lib/http.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const op = queryValue(req, "op") || "session";

  if (req.method === "GET" && op === "health") {
    try {
      const db = getDb();
      const probe = await db.from("projects").select("id", { count: "exact", head: true });
      return res.status(probe.error ? 503 : 200).json({
        ok: !probe.error,
        app: "LINK Preview Studio",
        version: "3.0.0",
        supabase: !probe.error,
        base_url: baseUrl() || null
      });
    } catch (error: any) {
      return res.status(503).json({ ok: false, error: error?.message || "Health check failed" });
    }
  }

  if (req.method === "POST" && op === "login") {
    const input = parseBody(req);
    const email = String(input.email || "").trim().toLowerCase();
    const password = String(input.password || "");
    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

    const client = getPublicAuthClient();
    const result = await client.auth.signInWithPassword({ email, password });
    if (result.error || !result.data?.session || !result.data?.user) {
      return res.status(401).json({ error: "Correo o contraseña incorrectos." });
    }

    try {
      const member = await ensureMember(getDb(), result.data.user);
      if (!member) {
        clearSessionCookies(res);
        return res.status(403).json({ error: "Esta cuenta existe, pero no está autorizada para LINK Preview Studio." });
      }
      setSessionCookies(res, result.data.session);
      noStore(res);
      return res.status(200).json({
        user: { id: result.data.user.id, email: result.data.user.email },
        member
      });
    } catch (error: any) {
      clearSessionCookies(res);
      return res.status(500).json({ error: error?.message || "Could not authorize account" });
    }
  }

  if (req.method === "POST" && op === "logout") {
    clearSessionCookies(res);
    noStore(res);
    return res.status(200).json({ ok: true });
  }

  if (req.method === "GET" && op === "session") {
    const auth = await requireMember(req, res);
    if (!auth) return;
    noStore(res);
    return res.status(200).json({
      user: { id: auth.user.id, email: auth.user.email },
      member: auth.member
    });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Unsupported auth operation" });
}
