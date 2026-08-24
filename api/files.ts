import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb, slugify } from "../lib/db.js";
import { requireMember } from "../lib/auth.js";
import { createShareLink, verifyShareToken, type SharePurpose } from "../lib/share.js";
import { parseBody, queryValue, noStore } from "../lib/http.js";

async function canReadDesign(req: VercelRequest, res: VercelResponse, designId: string, token: string, purposes: SharePurpose[]) {
  const db = getDb();
  if (token) {
    const ok = await verifyShareToken(db, designId, token, purposes);
    if (!ok) { res.status(403).json({ error: "Invalid or expired share link" }); return null; }
    return { db, shared: true };
  }
  const auth = await requireMember(req, res);
  if (!auth) return null;
  return { db: auth.db, shared: false };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const op = queryValue(req, "op") || "content";

  if (req.method === "GET" && op === "content") {
    const id = queryValue(req, "id");
    const token = queryValue(req, "token");
    if (!id) return res.status(400).json({ error: "Design id is required" });
    const access = await canReadDesign(req, res, id, token, ["preview", "html"]);
    if (!access) return;

    const design = await access.db.from("design_previews").select("id,title,html,current_version,updated_at").eq("id", id).maybeSingle();
    if (design.error) return res.status(500).json({ error: design.error.message });
    if (!design.data) return res.status(404).json({ error: "Design not found" });
    noStore(res);
    return res.status(200).json(design.data);
  }

  if (req.method === "GET" && op === "html") {
    const id = queryValue(req, "id");
    const token = queryValue(req, "token");
    if (!id) return res.status(400).json({ error: "Design id is required" });
    const access = await canReadDesign(req, res, id, token, ["html"]);
    if (!access) return;

    const design = await access.db.from("design_previews").select("id,title,html,current_version").eq("id", id).maybeSingle();
    if (design.error) return res.status(500).json({ error: design.error.message });
    if (!design.data) return res.status(404).json({ error: "Design not found" });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${slugify(design.data.title)}.html"`);
    noStore(res);
    return res.status(200).send(design.data.html);
  }

  if (req.method === "POST" && op === "share") {
    const auth = await requireMember(req, res);
    if (!auth) return;
    const input = parseBody(req);
    const designId = String(input.design_id || "");
    const purpose = String(input.purpose || "preview") as SharePurpose;
    const ttl = Number(input.ttl_minutes || 60);
    if (!designId || !["preview", "html", "pdf"].includes(purpose)) return res.status(400).json({ error: "Invalid share request" });

    const exists = await auth.db.from("design_previews").select("id,title").eq("id", designId).maybeSingle();
    if (exists.error) return res.status(500).json({ error: exists.error.message });
    if (!exists.data) return res.status(404).json({ error: "Design not found" });

    try {
      const link = await createShareLink(auth.db, designId, purpose, ttl, `user:${auth.user.id}`);
      return res.status(201).json({ design: exists.data, share: link });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || "Could not create share link" });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Unsupported files operation" });
}
