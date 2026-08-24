import { slugify } from "./db.js";

export async function ensureSegment(db: any, name?: string | null) {
  if (!name) return null;
  const slug = slugify(name);
  const existing = await db.from("segments").select("id").eq("slug", slug).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data.id;
  const created = await db.from("segments").insert({ name, slug }).select("id").single();
  if (created.error) throw created.error;
  return created.data.id;
}

export async function resolveWorkspace(db: any, input: {
  segment?: string;
  client?: string;
  project?: string;
  template_slug?: string;
}) {
  let segmentId: string | null = await ensureSegment(db, input.segment || null);
  let clientId: string | null = null;
  let projectId: string | null = null;
  let templateId: string | null = null;

  if (input.client) {
    const clientSlug = slugify(input.client);
    let client = await db.from("clients").select("id,segment_id,name,slug").eq("slug", clientSlug).maybeSingle();
    if (client.error) throw client.error;
    if (!client.data) {
      client = await db.from("clients").insert({
        name: input.client,
        slug: clientSlug,
        segment_id: segmentId,
        metadata: { source: "mcp-auto" }
      }).select("id,segment_id,name,slug").single();
      if (client.error) throw client.error;
      const profile = await db.from("client_profiles").insert({ client_id: client.data.id });
      if (profile.error) throw profile.error;
    }
    clientId = client.data.id;
    segmentId = segmentId || client.data.segment_id || null;
  }

  if (input.project) {
    let query = db.from("projects").select("id,client_id,segment_id").eq("name", input.project).eq("status", "active");
    if (clientId) query = query.eq("client_id", clientId);
    const existing = await query.limit(1).maybeSingle();
    if (existing.error) throw existing.error;

    if (existing.data) {
      projectId = existing.data.id;
      clientId = clientId || existing.data.client_id || null;
      segmentId = segmentId || existing.data.segment_id || null;
    } else {
      let parentId: string | null = null;
      if (clientId) {
        const root = await db.from("projects")
          .select("id")
          .eq("client_id", clientId)
          .eq("kind", "client_root")
          .eq("status", "active")
          .limit(1)
          .maybeSingle();
        if (root.error) throw root.error;
        parentId = root.data?.id || null;
      }
      const created = await db.from("projects").insert({
        name: input.project,
        slug: `${slugify(input.project)}-${Date.now().toString(36).slice(-6)}`,
        client_id: clientId,
        segment_id: segmentId,
        parent_id: parentId,
        kind: "project",
        phase: "discovery",
        metadata: { source: "mcp-auto" }
      }).select("id,client_id,segment_id").single();
      if (created.error) throw created.error;
      projectId = created.data.id;
      clientId = clientId || created.data.client_id || null;
      segmentId = segmentId || created.data.segment_id || null;
    }
  }

  if (!projectId && clientId) {
    const root = await db.from("projects")
      .select("id")
      .eq("client_id", clientId)
      .eq("kind", "client_root")
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (root.error) throw root.error;

    if (root.data) projectId = root.data.id;
    else {
      const client = await db.from("clients").select("name,slug").eq("id", clientId).single();
      if (client.error) throw client.error;
      const created = await db.from("projects").insert({
        name: client.data.name,
        slug: `${client.data.slug}-workspace-${Date.now().toString(36).slice(-4)}`,
        client_id: clientId,
        segment_id: segmentId,
        kind: "client_root",
        phase: "discovery",
        metadata: { source: "mcp-auto" }
      }).select("id").single();
      if (created.error) throw created.error;
      projectId = created.data.id;
    }
  }

  if (!projectId) {
    const inbox = await db.from("projects").select("id").eq("slug", "general").maybeSingle();
    if (inbox.error) throw inbox.error;
    if (!inbox.data) {
      const created = await db.from("projects").insert({
        name: "General",
        slug: "general",
        kind: "inbox",
        phase: "discovery",
        metadata: { system: true }
      }).select("id").single();
      if (created.error) throw created.error;
      projectId = created.data.id;
    } else projectId = inbox.data.id;
  }

  if (input.template_slug) {
    const template = await db.from("templates").select("id").eq("slug", slugify(input.template_slug)).maybeSingle();
    if (template.error) throw template.error;
    templateId = template.data?.id || null;
  }

  return { segmentId, clientId, projectId, templateId };
}

export async function findProject(db: any, input: { project_id?: string; client?: string; project?: string }) {
  if (input.project_id) {
    const q = await db.from("projects").select("*").eq("id", input.project_id).maybeSingle();
    if (q.error) throw q.error;
    return q.data || null;
  }
  if (!input.project) return null;
  let q = db.from("projects").select("*").eq("name", input.project).eq("status", "active");
  if (input.client) {
    const c = await db.from("clients").select("id").eq("slug", slugify(input.client)).maybeSingle();
    if (c.error) throw c.error;
    if (!c.data) return null;
    q = q.eq("client_id", c.data.id);
  }
  const found = await q.limit(1).maybeSingle();
  if (found.error) throw found.error;
  return found.data || null;
}
