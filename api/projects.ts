import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireEditor, requireMember } from "../lib/auth.js";
import { parseBody, queryValue, noStore } from "../lib/http.js";
import { logActivity } from "../lib/activity.js";

async function project360(db: any, id: string) {
  const project = await db.from("projects").select("*").eq("id", id).maybeSingle();
  if (project.error) throw project.error;
  if (!project.data) return null;

  const [client, profile, brief, requests, designs, commitments, deliverables, integrations, references, activity] = await Promise.all([
    project.data.client_id ? db.from("clients").select("*").eq("id", project.data.client_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    project.data.client_id ? db.from("client_profiles").select("*").eq("client_id", project.data.client_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    db.from("project_briefs").select("*").eq("project_id", id).maybeSingle(),
    db.from("requests").select("*").eq("project_id", id).order("updated_at", { ascending: false }),
    db.from("design_previews").select("id,title,slug,client_id,project_id,request_id,template_id,creation_type,status,current_version,metadata,created_at,updated_at").eq("project_id", id).order("updated_at", { ascending: false }),
    db.from("commitments").select("*").eq("project_id", id).order("sort_order").order("created_at"),
    db.from("deliverables").select("*").eq("project_id", id).order("updated_at", { ascending: false }),
    db.from("project_integrations").select("*").eq("project_id", id).order("provider"),
    project.data.client_id ? db.from("design_references").select("*").eq("client_id", project.data.client_id).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    db.from("activity_log").select("id,project_id,design_id,request_id,action,actor,details,created_at").eq("project_id", id).order("created_at", { ascending: false }).limit(100)
  ]);

  const all = [client, profile, brief, requests, designs, commitments, deliverables, integrations, references, activity];
  const error = all.map((x: any) => x.error).find(Boolean);
  if (error) throw error;

  return {
    project: project.data,
    client: client.data || null,
    profile: profile.data || null,
    brief: brief.data || null,
    requests: requests.data || [],
    designs: designs.data || [],
    commitments: commitments.data || [],
    deliverables: deliverables.data || [],
    integrations: integrations.data || [],
    references: references.data || [],
    activity: activity.data || []
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    const auth = await requireMember(req, res);
    if (!auth) return;
    const id = queryValue(req, "id");
    if (!id) return res.status(400).json({ error: "Project id is required" });
    try {
      const data = await project360(auth.db, id);
      if (!data) return res.status(404).json({ error: "Project not found" });
      noStore(res);
      return res.status(200).json(data);
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || "Could not load project" });
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
      if (action === "commitment_status") {
        const allowed = ["pending", "in_progress", "done", "cancelled"];
        if (!input.id || !allowed.includes(input.status)) return res.status(400).json({ error: "Invalid commitment update" });
        const updated = await db.from("commitments").update({ status: input.status, updated_at: new Date().toISOString() })
          .eq("id", input.id).select("*").single();
        if (updated.error) throw updated.error;
        await logActivity(db, { project_id: updated.data.project_id, request_id: updated.data.request_id, action: "commitment_status_changed", actor, details: { commitment_id: input.id, status: input.status } });
        return res.status(200).json({ commitment: updated.data });
      }

      if (action === "request_status") {
        const allowed = ["captured","understanding","proposed","designing","review","approved","in_production","delivered","evolving","closed"];
        if (!input.id || !allowed.includes(input.status)) return res.status(400).json({ error: "Invalid request update" });
        const updated = await db.from("requests").update({ status: input.status, updated_at: new Date().toISOString() })
          .eq("id", input.id).select("*").single();
        if (updated.error) throw updated.error;
        await logActivity(db, { project_id: updated.data.project_id, request_id: updated.data.id, action: "request_status_changed", actor, details: { status: input.status } });
        return res.status(200).json({ request: updated.data });
      }

      if (action === "project_phase") {
        if (!input.id || !input.phase) return res.status(400).json({ error: "Project and phase are required" });
        const updated = await db.from("projects").update({ phase: String(input.phase), updated_at: new Date().toISOString() })
          .eq("id", input.id).select("*").single();
        if (updated.error) throw updated.error;
        await logActivity(db, { project_id: updated.data.id, action: "project_phase_changed", actor, details: { phase: input.phase } });
        return res.status(200).json({ project: updated.data });
      }

      if (action === "upsert_brief") {
        const projectId = String(input.project_id || "");
        if (!projectId) return res.status(400).json({ error: "project_id is required" });
        const payload: Record<string, any> = { project_id: projectId, updated_at: new Date().toISOString() };
        for (const key of ["problem_statement","objective","solution_summary","deliverable_scope","effort_level","repeatable","automation_potential","commercial_notes","evolution_notes","metadata"]) {
          if (input[key] !== undefined) payload[key] = input[key];
        }
        const updated = await db.from("project_briefs").upsert(payload, { onConflict: "project_id" }).select("*").single();
        if (updated.error) throw updated.error;
        await logActivity(db, { project_id: projectId, action: "project_brief_updated", actor });
        return res.status(200).json({ brief: updated.data });
      }

      if (action === "add_commitment") {
        const projectId = String(input.project_id || "");
        const title = String(input.title || "").trim();
        if (!projectId || !title) return res.status(400).json({ error: "project_id and title are required" });
        const created = await db.from("commitments").insert({
          project_id: projectId,
          request_id: input.request_id || null,
          title,
          description: input.description || null,
          status: input.status || "pending",
          due_at: input.due_at || null,
          sort_order: Number(input.sort_order || 0),
          source: input.source || "studio"
        }).select("*").single();
        if (created.error) throw created.error;
        await logActivity(db, { project_id: projectId, request_id: created.data.request_id, action: "commitment_added", actor, details: { commitment_id: created.data.id, title } });
        return res.status(201).json({ commitment: created.data });
      }

      if (action === "register_deliverable") {
        const projectId = String(input.project_id || "");
        const title = String(input.title || "").trim();
        if (!projectId || !title) return res.status(400).json({ error: "project_id and title are required" });
        const status = input.status || "draft";
        const created = await db.from("deliverables").insert({
          project_id: projectId,
          request_id: input.request_id || null,
          design_id: input.design_id || null,
          version_id: input.version_id || null,
          title,
          deliverable_type: input.deliverable_type || "link",
          status,
          external_url: input.external_url || null,
          delivered_at: status === "delivered" ? new Date().toISOString() : null,
          metadata: input.metadata || {}
        }).select("*").single();
        if (created.error) throw created.error;
        await logActivity(db, { project_id: projectId, design_id: created.data.design_id, request_id: created.data.request_id, action: "deliverable_registered", actor, details: { deliverable_id: created.data.id, title, status } });
        return res.status(201).json({ deliverable: created.data });
      }

      if (action === "deliverable_status") {
        const allowed = ["draft", "ready", "delivered", "archived"];
        if (!input.id || !allowed.includes(input.status)) return res.status(400).json({ error: "Invalid deliverable update" });
        const patch: Record<string, any> = { status: input.status, updated_at: new Date().toISOString() };
        if (input.status === "delivered") patch.delivered_at = new Date().toISOString();
        const updated = await db.from("deliverables").update(patch).eq("id", input.id).select("*").single();
        if (updated.error) throw updated.error;
        await logActivity(db, { project_id: updated.data.project_id, design_id: updated.data.design_id, request_id: updated.data.request_id, action: "deliverable_status_changed", actor, details: { status: input.status } });
        return res.status(200).json({ deliverable: updated.data });
      }

      if (action === "set_integration") {
        const projectId = String(input.project_id || "");
        const provider = String(input.provider || "");
        const label = String(input.label || "").trim();
        if (!projectId || !provider || !label) return res.status(400).json({ error: "project_id, provider and label are required" });
        const updated = await db.from("project_integrations").upsert({
          project_id: projectId,
          provider,
          label,
          external_id: input.external_id || null,
          url: input.url || null,
          environment: input.environment || null,
          status: input.status || "connected",
          metadata: input.metadata || {},
          last_checked_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, { onConflict: "project_id,provider,label" }).select("*").single();
        if (updated.error) throw updated.error;
        await logActivity(db, { project_id: projectId, action: "integration_updated", actor, details: { provider, label, status: updated.data.status } });
        return res.status(200).json({ integration: updated.data });
      }

      return res.status(400).json({ error: "Unsupported project action" });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || "Project operation failed" });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
