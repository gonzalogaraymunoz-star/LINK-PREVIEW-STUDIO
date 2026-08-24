import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireEditor, requireMember } from "../lib/auth.js";
import { parseBody, noStore } from "../lib/http.js";
import { slugify } from "../lib/db.js";
import { ensureSegment } from "../lib/workspace.js";
import { logActivity } from "../lib/activity.js";

async function loadWorkspace(db: any) {
  const [
    segments, clients, profiles, projects, designs, templates, requests,
    briefs, commitments, deliverables, integrations, references, activity
  ] = await Promise.all([
    db.from("segments").select("id,name,slug,description,metadata").order("name"),
    db.from("clients").select("id,name,slug,segment_id,status,metadata,created_at,updated_at").eq("status", "active").order("name"),
    db.from("client_profiles").select("client_id,brand_dna,communication_rules,business_rules,default_outputs,metadata,updated_at"),
    db.from("projects").select("id,name,slug,description,client_id,segment_id,parent_id,kind,phase,sort_order,status,metadata,created_at,updated_at").eq("status", "active").order("sort_order").order("name"),
    db.from("design_previews").select("id,title,slug,client_id,project_id,request_id,template_id,creation_type,status,current_version,updated_at,created_at,metadata").order("updated_at", { ascending: false }),
    db.from("templates").select("id,name,slug,segment_id,creation_type,output_types,status,metadata,updated_at").eq("status", "active").order("name"),
    db.from("requests").select("id,client_id,project_id,title,summary,problem_statement,desired_outcome,request_type,source,priority,status,metadata,created_at,updated_at").order("updated_at", { ascending: false }),
    db.from("project_briefs").select("project_id,problem_statement,objective,solution_summary,deliverable_scope,effort_level,repeatable,automation_potential,commercial_notes,evolution_notes,metadata,updated_at"),
    db.from("commitments").select("id,project_id,request_id,title,description,status,due_at,sort_order,source,metadata,created_at,updated_at").order("sort_order").order("created_at"),
    db.from("deliverables").select("id,project_id,request_id,design_id,version_id,title,deliverable_type,status,external_url,delivered_at,metadata,created_at,updated_at").order("updated_at", { ascending: false }),
    db.from("project_integrations").select("id,project_id,provider,label,external_id,url,environment,status,metadata,last_checked_at,created_at,updated_at").order("provider"),
    db.from("design_references").select("id,client_id,template_id,design_id,name,reference_type,metadata,created_at").order("created_at", { ascending: false }),
    db.from("activity_log").select("id,project_id,preview_id,design_id,request_id,action,actor,details,created_at").order("created_at", { ascending: false }).limit(120)
  ]);

  const all = [segments, clients, profiles, projects, designs, templates, requests, briefs, commitments, deliverables, integrations, references, activity];
  const error = all.map((x: any) => x.error).find(Boolean);
  if (error) throw error;

  const projectRows = projects.data || [];
  const requestRows = requests.data || [];
  const commitmentRows = commitments.data || [];
  const deliverableRows = deliverables.data || [];

  return {
    segments: segments.data || [],
    clients: clients.data || [],
    profiles: profiles.data || [],
    projects: projectRows,
    designs: designs.data || [],
    templates: templates.data || [],
    requests: requestRows,
    briefs: briefs.data || [],
    commitments: commitmentRows,
    deliverables: deliverableRows,
    integrations: integrations.data || [],
    references: references.data || [],
    activity: activity.data || [],
    stats: {
      clients: (clients.data || []).length,
      projects: projectRows.filter((p: any) => p.kind === "project").length,
      open_requests: requestRows.filter((r: any) => !["delivered", "closed"].includes(r.status)).length,
      creations: (designs.data || []).length,
      pending_commitments: commitmentRows.filter((c: any) => !["done", "cancelled"].includes(c.status)).length,
      ready_deliverables: deliverableRows.filter((d: any) => d.status === "ready").length
    }
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    const auth = await requireMember(req, res);
    if (!auth) return;
    try {
      const workspace = await loadWorkspace(auth.db);
      noStore(res);
      return res.status(200).json(workspace);
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || "Could not load workspace" });
    }
  }

  if (req.method === "POST") {
    const auth = await requireEditor(req, res);
    if (!auth) return;
    const input = parseBody(req);
    const action = String(input.action || "");
    const { db, user } = auth;

    try {
      if (action === "create_client") {
        const name = String(input.name || "").trim();
        if (!name) return res.status(400).json({ error: "Client name is required" });
        const segmentId = input.segment_id || await ensureSegment(db, input.segment_name || null);
        const baseSlug = slugify(name);
        let slug = baseSlug;
        const existing = await db.from("clients").select("id").eq("slug", slug).maybeSingle();
        if (existing.error) throw existing.error;
        if (existing.data) slug = `${baseSlug}-${Date.now().toString(36).slice(-5)}`;

        const client = await db.from("clients").insert({
          name, slug, segment_id: segmentId || null,
          metadata: { source: "studio-ui" }
        }).select("id,name,slug,segment_id,status,metadata").single();
        if (client.error) throw client.error;

        const profile = await db.from("client_profiles").insert({ client_id: client.data.id });
        if (profile.error) throw profile.error;

        const root = await db.from("projects").insert({
          name,
          slug: `${slug}-workspace`,
          client_id: client.data.id,
          segment_id: segmentId || null,
          kind: "client_root",
          phase: "discovery",
          metadata: { source: "studio-ui" }
        }).select("id,name,slug,client_id,segment_id,kind,phase").single();
        if (root.error) throw root.error;

        await logActivity(db, { project_id: root.data.id, action: "client_created", actor: `user:${user.id}`, details: { client_id: client.data.id, name } });
        return res.status(201).json({ client: client.data, project: root.data });
      }

      if (action === "create_project") {
        const name = String(input.name || "").trim();
        if (!name) return res.status(400).json({ error: "Project name is required" });
        const clientId = input.client_id || null;
        let segmentId = input.segment_id || null;
        let parentId = input.parent_id || null;

        if (clientId) {
          const client = await db.from("clients").select("id,segment_id").eq("id", clientId).maybeSingle();
          if (client.error) throw client.error;
          if (!client.data) return res.status(404).json({ error: "Client not found" });
          segmentId = segmentId || client.data.segment_id || null;
          if (!parentId) {
            const root = await db.from("projects").select("id")
              .eq("client_id", clientId).eq("kind", "client_root").eq("status", "active")
              .limit(1).maybeSingle();
            if (root.error) throw root.error;
            parentId = root.data?.id || null;
          }
        }

        const project = await db.from("projects").insert({
          name,
          slug: `${slugify(name)}-${Date.now().toString(36).slice(-5)}`,
          description: input.description || null,
          client_id: clientId,
          segment_id: segmentId,
          parent_id: parentId,
          kind: "project",
          phase: input.phase || "discovery",
          metadata: { source: "studio-ui" }
        }).select("id,name,slug,client_id,segment_id,parent_id,kind,phase,description").single();
        if (project.error) throw project.error;
        await logActivity(db, { project_id: project.data.id, action: "project_created", actor: `user:${user.id}`, details: { name } });
        return res.status(201).json({ project: project.data });
      }

      if (action === "move_design") {
        const designId = String(input.design_id || "");
        const projectId = String(input.project_id || "");
        if (!designId || !projectId) return res.status(400).json({ error: "design_id and project_id are required" });
        const project = await db.from("projects").select("id,client_id").eq("id", projectId).maybeSingle();
        if (project.error) throw project.error;
        if (!project.data) return res.status(404).json({ error: "Project not found" });
        const updated = await db.from("design_previews").update({
          project_id: project.data.id,
          client_id: project.data.client_id || null,
          updated_at: new Date().toISOString()
        }).eq("id", designId).select("id,title,project_id,client_id,updated_at").single();
        if (updated.error) throw updated.error;
        await logActivity(db, { project_id: projectId, design_id: designId, action: "creation_moved", actor: `user:${user.id}` });
        return res.status(200).json({ design: updated.data });
      }

      if (action === "update_client_profile") {
        const clientId = String(input.client_id || "");
        if (!clientId) return res.status(400).json({ error: "client_id is required" });
        const patch: Record<string, any> = { updated_at: new Date().toISOString() };
        for (const key of ["brand_dna", "communication_rules", "business_rules", "default_outputs", "metadata"]) {
          if (input[key] !== undefined) patch[key] = input[key];
        }
        const profile = await db.from("client_profiles").upsert({ client_id: clientId, ...patch }, { onConflict: "client_id" }).select("*").single();
        if (profile.error) throw profile.error;
        return res.status(200).json({ profile: profile.data });
      }

      return res.status(400).json({ error: "Unsupported workspace action" });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || "Workspace operation failed" });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
