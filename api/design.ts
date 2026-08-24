import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireEditor, requireMember } from "../lib/auth.js";
import { parseBody, queryValue, noStore } from "../lib/http.js";
import { logActivity } from "../lib/activity.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const op = queryValue(req, "op") || "get";

  if (req.method === "GET") {
    const auth = await requireMember(req, res);
    if (!auth) return;
    const { db } = auth;

    try {
      if (op === "list") {
        const limit = Math.max(1, Math.min(Number(queryValue(req, "limit") || 100), 200));
        const q = await db.from("design_previews")
          .select("id,title,slug,client_id,project_id,request_id,template_id,creation_type,status,current_version,created_at,updated_at,metadata")
          .order("updated_at", { ascending: false }).limit(limit);
        if (q.error) throw q.error;
        noStore(res);
        return res.status(200).json({ designs: q.data || [] });
      }

      if (op === "versions") {
        const id = queryValue(req, "id");
        if (!id) return res.status(400).json({ error: "Design id is required" });
        const q = await db.from("design_versions")
          .select("id,design_id,version_number,change_summary,source,metadata,created_at")
          .eq("design_id", id).order("version_number", { ascending: false });
        if (q.error) throw q.error;
        noStore(res);
        return res.status(200).json({ versions: q.data || [] });
      }

      const id = queryValue(req, "id");
      if (!id) return res.status(400).json({ error: "Design id is required" });
      const q = await db.from("design_previews")
        .select("id,title,slug,html,client_id,project_id,request_id,template_id,creation_type,status,current_version,metadata,created_at,updated_at")
        .eq("id", id).maybeSingle();
      if (q.error) throw q.error;
      if (!q.data) return res.status(404).json({ error: "Design not found" });
      noStore(res);
      return res.status(200).json(q.data);
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || "Could not load design" });
    }
  }

  if (req.method === "POST") {
    const auth = await requireEditor(req, res);
    if (!auth) return;
    const input = parseBody(req);
    const action = String(input.action || "");
    const { db, user } = auth;
    const actor = `user:${user.id}`;

    try {
      if (action === "restore_version") {
        const designId = String(input.design_id || "");
        const versionNumber = Number(input.version_number || 0);
        if (!designId || versionNumber < 1) return res.status(400).json({ error: "design_id and version_number are required" });

        const [design, oldVersion] = await Promise.all([
          db.from("design_previews").select("id,title,current_version,project_id,request_id").eq("id", designId).maybeSingle(),
          db.from("design_versions").select("id,html,version_number").eq("design_id", designId).eq("version_number", versionNumber).maybeSingle()
        ]);
        if (design.error) throw design.error;
        if (oldVersion.error) throw oldVersion.error;
        if (!design.data || !oldVersion.data) return res.status(404).json({ error: "Design or version not found" });

        const nextVersion = Number(design.data.current_version || 1) + 1;
        const inserted = await db.from("design_versions").insert({
          design_id: designId,
          version_number: nextVersion,
          html: oldVersion.data.html,
          change_summary: `Restored from version ${versionNumber}`,
          source: "studio-restore"
        }).select("id").single();
        if (inserted.error) throw inserted.error;

        const updated = await db.from("design_previews").update({
          html: oldVersion.data.html,
          current_version: nextVersion,
          updated_at: new Date().toISOString()
        }).eq("id", designId).select("id,title,current_version,updated_at").single();
        if (updated.error) throw updated.error;

        await logActivity(db, { project_id: design.data.project_id, design_id: designId, request_id: design.data.request_id, action: "version_restored", actor, details: { from_version: versionNumber, new_version: nextVersion } });
        return res.status(200).json({ design: updated.data, version_id: inserted.data.id });
      }

      if (action === "status") {
        const allowed = ["draft", "published", "archived"];
        if (!input.design_id || !allowed.includes(input.status)) return res.status(400).json({ error: "Invalid design status" });
        const updated = await db.from("design_previews").update({ status: input.status, updated_at: new Date().toISOString() })
          .eq("id", input.design_id).select("id,title,status,project_id,request_id").single();
        if (updated.error) throw updated.error;
        await logActivity(db, { project_id: updated.data.project_id, design_id: updated.data.id, request_id: updated.data.request_id, action: "creation_status_changed", actor, details: { status: input.status } });
        return res.status(200).json({ design: updated.data });
      }

      if (action === "add_reference") {
        const designId = String(input.design_id || "");
        if (!designId) return res.status(400).json({ error: "design_id is required" });
        const design = await db.from("design_previews").select("id,title,client_id,template_id").eq("id", designId).maybeSingle();
        if (design.error) throw design.error;
        if (!design.data) return res.status(404).json({ error: "Design not found" });
        const created = await db.from("design_references").insert({
          client_id: design.data.client_id || null,
          template_id: design.data.template_id || null,
          design_id: designId,
          name: input.name || design.data.title,
          reference_type: input.reference_type || "approved_creation",
          metadata: input.metadata || {}
        }).select("*").single();
        if (created.error) throw created.error;
        return res.status(201).json({ reference: created.data });
      }

      return res.status(400).json({ error: "Unsupported design action" });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || "Design operation failed" });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
