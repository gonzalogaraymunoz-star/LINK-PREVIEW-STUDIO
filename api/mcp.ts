import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import * as z from "zod/v4";
import { randomUUID } from "node:crypto";
import { getDb, previewUrls, slugify } from "../lib/db.js";
import { resolveWorkspace, findProject, ensureSegment } from "../lib/workspace.js";
import { createShareLink } from "../lib/share.js";
import { logActivity } from "../lib/activity.js";
import { mcpAuthorized } from "../lib/auth.js";

const MAX_HTML = 400_000;

function makeServer() {
  const server = new McpServer(
    { name: "link-preview-studio", version: "3.0.0" },
    {
      instructions:
        "LINK Preview Studio is the operational creation workspace between conversation and production. Prefer reusing existing clients, projects, templates and approved references before creating new structures. Model work as Segment → Client → Project → Request → Creation → Version → File/Deliverable → Evolution. The user works mainly in ChatGPT; the Studio is the organized visual workspace, not a duplicate chat. Supabase is structured memory, GitHub formal source control and Vercel production."
    }
  );

  server.registerTool(
    "get_workspace_context",
    {
      title: "Get LINK workspace context",
      description: "Load active clients, projects, open requests, recent creations, templates and project integrations before deciding where new work belongs.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(100).optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    },
    async ({ limit = 30 }) => {
      const db = getDb();
      const [clients, projects, requests, designs, templates, integrations] = await Promise.all([
        db.from("clients").select("id,name,slug,segment_id,status,metadata").eq("status", "active").order("name"),
        db.from("projects").select("id,name,slug,description,client_id,segment_id,parent_id,kind,phase,status,metadata").eq("status", "active").order("name"),
        db.from("requests").select("id,client_id,project_id,title,summary,priority,status,request_type,updated_at").not("status", "in", "(closed,delivered)").order("updated_at", { ascending: false }).limit(limit),
        db.from("design_previews").select("id,title,client_id,project_id,request_id,creation_type,current_version,updated_at").order("updated_at", { ascending: false }).limit(limit),
        db.from("templates").select("id,name,slug,segment_id,creation_type,output_types,status").eq("status", "active").order("name"),
        db.from("project_integrations").select("project_id,provider,label,external_id,url,environment,status,last_checked_at").order("provider")
      ]);
      const error = [clients, projects, requests, designs, templates, integrations].map((x: any) => x.error).find(Boolean);
      if (error) throw error;
      const result = {
        clients: clients.data || [], projects: projects.data || [], requests: requests.data || [],
        designs: designs.data || [], templates: templates.data || [], integrations: integrations.data || []
      };
      return { structuredContent: result, content: [{ type: "text", text: `Loaded LINK workspace: ${result.clients.length} clients, ${result.projects.length} project nodes, ${result.requests.length} open requests.` }] };
    }
  );

  server.registerTool(
    "register_client_logic",
    {
      title: "Register client logic and DNA",
      description: "Create or reuse a client and persist its segment, brand DNA, communication rules, business rules and default output formats. Use this when the user teaches LINK how a client works.",
      inputSchema: z.object({
        client: z.string().min(1).max(120),
        segment: z.string().max(80).optional(),
        brand_dna: z.record(z.string(), z.any()).optional(),
        communication_rules: z.record(z.string(), z.any()).optional(),
        business_rules: z.record(z.string(), z.any()).optional(),
        default_outputs: z.array(z.string().max(40)).min(1).max(12).optional(),
        metadata: z.record(z.string(), z.any()).optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ client, segment, brand_dna = {}, communication_rules = {}, business_rules = {}, default_outputs = ["html", "pdf"], metadata = {} }) => {
      const db = getDb();
      const ids = await resolveWorkspace(db, { client, segment });
      if (!ids.clientId) throw new Error("Client could not be resolved");
      const profile = await db.from("client_profiles").upsert({
        client_id: ids.clientId,
        brand_dna,
        communication_rules,
        business_rules,
        default_outputs,
        metadata,
        updated_at: new Date().toISOString()
      }, { onConflict: "client_id" }).select("*").single();
      if (profile.error) throw profile.error;
      await logActivity(db, { project_id: ids.projectId, action: "client_logic_updated", actor: "mcp", details: { client, segment } });
      return { structuredContent: { client_id: ids.clientId, project_id: ids.projectId, profile: profile.data }, content: [{ type: "text", text: `Stored reusable client logic for "${client}".` }] };
    }
  );

  server.registerTool(
    "upsert_template",
    {
      title: "Create or update reusable template",
      description: "Persist a reusable creation template by segment and creation type, including structure, rules, design instructions and supported outputs.",
      inputSchema: z.object({
        name: z.string().min(1).max(140),
        slug: z.string().max(140).optional(),
        segment: z.string().max(80).optional(),
        creation_type: z.string().min(1).max(80),
        structure: z.record(z.string(), z.any()).optional(),
        rules: z.record(z.string(), z.any()).optional(),
        design: z.record(z.string(), z.any()).optional(),
        output_types: z.array(z.string().max(40)).min(1).max(12).optional(),
        metadata: z.record(z.string(), z.any()).optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ name, slug, segment, creation_type, structure = {}, rules = {}, design = {}, output_types = ["html", "pdf"], metadata = {} }) => {
      const db = getDb();
      const segmentId = await ensureSegment(db, segment || null);
      const templateSlug = slugify(slug || name);
      const q = await db.from("templates").upsert({
        name, slug: templateSlug, segment_id: segmentId, creation_type, structure, rules, design,
        output_types, status: "active", metadata, updated_at: new Date().toISOString()
      }, { onConflict: "slug" }).select("*").single();
      if (q.error) throw q.error;
      return { structuredContent: { template: q.data }, content: [{ type: "text", text: `Template "${name}" is ready for reuse.` }] };
    }
  );

  server.registerTool(
    "register_request",
    {
      title: "Register project request",
      description: "Persist the concrete client/project request that originates a piece of work. Reuse or create workspace context when enough information is supplied.",
      inputSchema: z.object({
        title: z.string().min(1).max(180),
        summary: z.string().max(1500).optional(),
        problem_statement: z.string().max(3000).optional(),
        desired_outcome: z.string().max(3000).optional(),
        request_type: z.string().max(80).optional(),
        priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
        status: z.enum(["captured","understanding","proposed","designing","review","approved","in_production","delivered","evolving","closed"]).optional(),
        segment: z.string().max(80).optional(), client: z.string().max(120).optional(), project: z.string().max(120).optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ title, summary, problem_statement, desired_outcome, request_type = "general", priority = "normal", status = "captured", segment, client, project }) => {
      const db = getDb();
      const ids = await resolveWorkspace(db, { segment, client, project });
      if (!ids.projectId) throw new Error("Project could not be resolved");
      const q = await db.from("requests").insert({
        client_id: ids.clientId, project_id: ids.projectId, title,
        summary: summary || null, problem_statement: problem_statement || null, desired_outcome: desired_outcome || null,
        request_type, source: "chatgpt", priority, status,
        metadata: { segment, client, project }
      }).select("*").single();
      if (q.error) throw q.error;
      await logActivity(db, { project_id: ids.projectId, request_id: q.data.id, action: "request_registered", actor: "mcp", details: { title, priority, status } });
      return { structuredContent: { request: q.data }, content: [{ type: "text", text: `Registered request "${title}".` }] };
    }
  );

  server.registerTool(
    "set_project_brief",
    {
      title: "Set project brief",
      description: "Persist the project's problem, objective, solution, scope, effort, repeatability, automation potential, commercial notes and evolution path.",
      inputSchema: z.object({
        project_id: z.string().uuid(),
        problem_statement: z.string().max(4000).optional(), objective: z.string().max(4000).optional(),
        solution_summary: z.string().max(4000).optional(), deliverable_scope: z.string().max(4000).optional(),
        effort_level: z.enum(["small","medium","large","xl"]).optional(), repeatable: z.boolean().optional(),
        automation_potential: z.string().max(3000).optional(), commercial_notes: z.string().max(3000).optional(), evolution_notes: z.string().max(3000).optional(),
        metadata: z.record(z.string(), z.any()).optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ project_id, ...rest }) => {
      const db = getDb();
      const q = await db.from("project_briefs").upsert({ project_id, ...rest, updated_at: new Date().toISOString() }, { onConflict: "project_id" }).select("*").single();
      if (q.error) throw q.error;
      await logActivity(db, { project_id, action: "project_brief_updated", actor: "mcp" });
      return { structuredContent: { brief: q.data }, content: [{ type: "text", text: "Project brief updated." }] };
    }
  );

  server.registerTool(
    "get_project_context",
    {
      title: "Get project 360 context",
      description: "Load complete working context: client DNA, brief, requests, creations, commitments, deliverables, integrations, references and activity.",
      inputSchema: z.object({
        project_id: z.string().uuid().optional(), client: z.string().max(120).optional(), project: z.string().max(120).optional()
      }).refine(v => Boolean(v.project_id || v.project), { message: "Provide project_id or project" }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    },
    async (input) => {
      const db = getDb();
      const project = await findProject(db, input);
      if (!project) return { structuredContent: { found: false }, content: [{ type: "text", text: "Project not found." }] };
      const [client, profile, brief, requests, designs, commitments, deliverables, integrations, references, activity] = await Promise.all([
        project.client_id ? db.from("clients").select("*").eq("id", project.client_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
        project.client_id ? db.from("client_profiles").select("*").eq("client_id", project.client_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
        db.from("project_briefs").select("*").eq("project_id", project.id).maybeSingle(),
        db.from("requests").select("*").eq("project_id", project.id).order("updated_at", { ascending: false }),
        db.from("design_previews").select("id,title,slug,request_id,creation_type,status,current_version,metadata,created_at,updated_at").eq("project_id", project.id).order("updated_at", { ascending: false }),
        db.from("commitments").select("*").eq("project_id", project.id).order("sort_order").order("created_at"),
        db.from("deliverables").select("*").eq("project_id", project.id).order("updated_at", { ascending: false }),
        db.from("project_integrations").select("*").eq("project_id", project.id).order("provider"),
        project.client_id ? db.from("design_references").select("*").eq("client_id", project.client_id).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
        db.from("activity_log").select("id,design_id,request_id,action,actor,details,created_at").eq("project_id", project.id).order("created_at", { ascending: false }).limit(60)
      ]);
      const error = [client, profile, brief, requests, designs, commitments, deliverables, integrations, references, activity].map((x: any) => x.error).find(Boolean);
      if (error) throw error;
      const context = {
        found: true, project, client: client.data || null, profile: profile.data || null, brief: brief.data || null,
        requests: requests.data || [], designs: designs.data || [], commitments: commitments.data || [], deliverables: deliverables.data || [],
        integrations: integrations.data || [], references: references.data || [], activity: activity.data || []
      };
      return { structuredContent: context, content: [{ type: "text", text: `Loaded project 360 for "${project.name}".` }] };
    }
  );

  server.registerTool(
    "create_preview",
    {
      title: "Create HTML preview",
      description: "Create a complete standalone HTML creation and file it into the correct client/project/request context when known.",
      inputSchema: z.object({
        title: z.string().min(1).max(120), html: z.string().min(20).max(MAX_HTML),
        segment: z.string().max(80).optional(), client: z.string().max(120).optional(), project: z.string().max(120).optional(),
        request_id: z.string().uuid().optional(), creation_type: z.string().max(80).optional(), template_slug: z.string().max(120).optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ title, html, segment, client, project, request_id, creation_type = "preview", template_slug }) => {
      const db = getDb();
      let ids = await resolveWorkspace(db, { segment, client, project, template_slug });
      let request: any = null;
      if (request_id) {
        const rq = await db.from("requests").select("id,client_id,project_id,title,status").eq("id", request_id).maybeSingle();
        if (rq.error) throw rq.error;
        if (!rq.data) throw new Error("Request not found");
        request = rq.data;
        ids = { ...ids, projectId: rq.data.project_id, clientId: rq.data.client_id || ids.clientId };
      }
      const id = randomUUID();
      const slug = `${slugify(title)}-${id.slice(0, 8)}`;
      const created = await db.from("design_previews").insert({
        id, title, slug, html, client_id: ids.clientId, project_id: ids.projectId, request_id: request?.id || null,
        template_id: ids.templateId, creation_type, current_version: 1, status: "draft",
        metadata: { segment, source: "mcp-v3" }
      }).select("id,title,slug,client_id,project_id,request_id,template_id,creation_type,current_version,created_at,updated_at").single();
      if (created.error) throw created.error;
      const version = await db.from("design_versions").insert({ design_id: id, version_number: 1, html, change_summary: "Initial creation", source: "mcp" }).select("id").single();
      if (version.error) throw version.error;
      await logActivity(db, { project_id: ids.projectId, design_id: id, request_id: request?.id || null, action: "creation_created", actor: "mcp", details: { title, creation_type, version: 1 } });
      const urls = previewUrls(id);
      return { structuredContent: { design: { ...created.data, version_id: version.data.id, ...urls } }, content: [{ type: "text", text: `Created "${title}" in LINK Preview Studio. Preview: ${urls.studio_url}` }] };
    }
  );

  server.registerTool(
    "get_preview",
    {
      title: "Get HTML preview",
      description: "Load the complete active HTML and metadata before modifying an existing creation.",
      inputSchema: z.object({ id: z.string().uuid() }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    },
    async ({ id }) => {
      const db = getDb();
      const q = await db.from("design_previews").select("id,title,slug,html,client_id,project_id,request_id,template_id,creation_type,status,current_version,metadata,created_at,updated_at").eq("id", id).maybeSingle();
      if (q.error) throw q.error;
      if (!q.data) return { structuredContent: { found: false, id }, content: [{ type: "text", text: `No preview found for id ${id}.` }] };
      return { structuredContent: { found: true, design: { ...q.data, ...previewUrls(id) } }, content: [{ type: "text", text: `Loaded "${q.data.title}", version ${q.data.current_version}.` }] };
    }
  );

  server.registerTool(
    "update_preview",
    {
      title: "Update HTML preview",
      description: "Update an existing creation after get_preview. Previous versions remain immutable and activity is recorded.",
      inputSchema: z.object({ id: z.string().uuid(), title: z.string().min(1).max(120).optional(), html: z.string().min(20).max(MAX_HTML), change_summary: z.string().max(500).optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ id, title, html, change_summary }) => {
      const db = getDb();
      const current = await db.from("design_previews").select("id,title,current_version,project_id,request_id").eq("id", id).maybeSingle();
      if (current.error) throw current.error;
      if (!current.data) return { structuredContent: { updated: false, id }, content: [{ type: "text", text: `No preview found for id ${id}.` }] };
      const nextVersion = Number(current.data.current_version || 1) + 1;
      const version = await db.from("design_versions").insert({
        design_id: id, version_number: nextVersion, html,
        change_summary: change_summary || "Updated from ChatGPT", source: "mcp"
      }).select("id").single();
      if (version.error) throw version.error;
      const patch: Record<string, any> = { html, current_version: nextVersion, updated_at: new Date().toISOString() };
      if (title) patch.title = title;
      const updated = await db.from("design_previews").update(patch).eq("id", id)
        .select("id,title,slug,client_id,project_id,request_id,template_id,creation_type,current_version,created_at,updated_at").single();
      if (updated.error) throw updated.error;
      await logActivity(db, { project_id: current.data.project_id, design_id: id, request_id: current.data.request_id, action: "creation_updated", actor: "mcp", details: { version: nextVersion, change_summary: change_summary || "Updated from ChatGPT" } });
      const urls = previewUrls(id);
      return { structuredContent: { updated: true, design: { ...updated.data, version_id: version.data.id, ...urls } }, content: [{ type: "text", text: `Updated "${updated.data.title}" to version ${nextVersion}. Preview: ${urls.studio_url}` }] };
    }
  );

  server.registerTool(
    "list_previews",
    {
      title: "List creations",
      description: "Find previous work with client/project/request classification.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(100).optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    },
    async ({ limit = 30 }) => {
      const db = getDb();
      const q = await db.from("design_previews").select("id,title,slug,client_id,project_id,request_id,creation_type,current_version,created_at,updated_at").order("updated_at", { ascending: false }).limit(limit);
      if (q.error) throw q.error;
      const designs = (q.data || []).map((d: any) => ({ ...d, ...previewUrls(d.id) }));
      return { structuredContent: { designs }, content: [{ type: "text", text: `Found ${designs.length} creations.` }] };
    }
  );

  server.registerTool(
    "add_commitment",
    {
      title: "Add project commitment",
      description: "Register a concrete obligation required to fulfill a project or request.",
      inputSchema: z.object({
        project_id: z.string().uuid(), request_id: z.string().uuid().optional(), title: z.string().min(1).max(180),
        description: z.string().max(1500).optional(), status: z.enum(["pending","in_progress","done","cancelled"]).optional(),
        due_at: z.string().datetime().optional(), sort_order: z.number().int().optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ project_id, request_id, title, description, status = "pending", due_at, sort_order = 0 }) => {
      const db = getDb();
      const q = await db.from("commitments").insert({ project_id, request_id: request_id || null, title, description: description || null, status, due_at: due_at || null, sort_order, source: "chatgpt" }).select("*").single();
      if (q.error) throw q.error;
      await logActivity(db, { project_id, request_id, action: "commitment_added", actor: "mcp", details: { commitment_id: q.data.id, title, status } });
      return { structuredContent: { commitment: q.data }, content: [{ type: "text", text: `Added commitment "${title}".` }] };
    }
  );

  server.registerTool(
    "register_deliverable",
    {
      title: "Register deliverable",
      description: "Record a formal deliverable and optionally link it to a request, creation, version and external URL.",
      inputSchema: z.object({
        project_id: z.string().uuid(), title: z.string().min(1).max(180), request_id: z.string().uuid().optional(),
        design_id: z.string().uuid().optional(), version_id: z.string().uuid().optional(), deliverable_type: z.string().max(80).optional(),
        status: z.enum(["draft","ready","delivered","archived"]).optional(), external_url: z.string().url().optional(), metadata: z.record(z.string(), z.any()).optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ project_id, title, request_id, design_id, version_id, deliverable_type = "link", status = "draft", external_url, metadata = {} }) => {
      const db = getDb();
      const q = await db.from("deliverables").insert({
        project_id, request_id: request_id || null, design_id: design_id || null, version_id: version_id || null,
        title, deliverable_type, status, external_url: external_url || null,
        delivered_at: status === "delivered" ? new Date().toISOString() : null, metadata
      }).select("*").single();
      if (q.error) throw q.error;
      await logActivity(db, { project_id, design_id, request_id, action: "deliverable_registered", actor: "mcp", details: { deliverable_id: q.data.id, title, status } });
      return { structuredContent: { deliverable: q.data }, content: [{ type: "text", text: `Registered deliverable "${title}".` }] };
    }
  );

  server.registerTool(
    "set_project_integration",
    {
      title: "Set project integration",
      description: "Record or update a project's connection to Supabase, GitHub, Vercel, Drive, Gmail, Calendar, Attio or another provider.",
      inputSchema: z.object({
        project_id: z.string().uuid(), provider: z.enum(["supabase","github","vercel","drive","gmail","calendar","attio","other"]),
        label: z.string().min(1).max(160), external_id: z.string().max(300).optional(), url: z.string().url().optional(), environment: z.string().max(80).optional(),
        status: z.enum(["connected","warning","error","disconnected"]).optional(), metadata: z.record(z.string(), z.any()).optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ project_id, provider, label, external_id, url, environment, status = "connected", metadata = {} }) => {
      const db = getDb();
      const q = await db.from("project_integrations").upsert({
        project_id, provider, label, external_id: external_id || null, url: url || null, environment: environment || null,
        status, metadata, last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString()
      }, { onConflict: "project_id,provider,label" }).select("*").single();
      if (q.error) throw q.error;
      await logActivity(db, { project_id, action: "integration_updated", actor: "mcp", details: { provider, label, status } });
      return { structuredContent: { integration: q.data }, content: [{ type: "text", text: `Updated ${provider} integration "${label}" (${status}).` }] };
    }
  );

  server.registerTool(
    "get_client_context",
    {
      title: "Get client creation context",
      description: "Load client DNA, communication/business rules, projects and approved references before generating work.",
      inputSchema: z.object({ client: z.string().min(1).max(120) }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    },
    async ({ client }) => {
      const db = getDb();
      const found = await db.from("clients").select("id,name,slug,segment_id,status,metadata").eq("slug", slugify(client)).maybeSingle();
      if (found.error) throw found.error;
      if (!found.data) return { structuredContent: { found: false, client }, content: [{ type: "text", text: `Client "${client}" is not registered.` }] };
      const [profile, projects, refs] = await Promise.all([
        db.from("client_profiles").select("*").eq("client_id", found.data.id).maybeSingle(),
        db.from("projects").select("id,name,slug,parent_id,kind,phase,metadata").eq("client_id", found.data.id).eq("status", "active"),
        db.from("design_references").select("id,name,reference_type,template_id,design_id,metadata").eq("client_id", found.data.id)
      ]);
      const error = [profile, projects, refs].map((x: any) => x.error).find(Boolean);
      if (error) throw error;
      return { structuredContent: { found: true, client: found.data, profile: profile.data || null, projects: projects.data || [], references: refs.data || [] }, content: [{ type: "text", text: `Loaded creation context for "${found.data.name}".` }] };
    }
  );

  server.registerTool(
    "get_template",
    {
      title: "Get creation template",
      description: "Load a reusable template definition with structure, rules and design instructions.",
      inputSchema: z.object({ slug: z.string().min(1).max(120) }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    },
    async ({ slug }) => {
      const db = getDb();
      const q = await db.from("templates").select("*").eq("slug", slugify(slug)).maybeSingle();
      if (q.error) throw q.error;
      if (!q.data) return { structuredContent: { found: false, slug }, content: [{ type: "text", text: `Template "${slug}" was not found.` }] };
      return { structuredContent: { found: true, template: q.data }, content: [{ type: "text", text: `Loaded template "${q.data.name}".` }] };
    }
  );

  server.registerTool(
    "register_design_reference",
    {
      title: "Register approved design reference",
      description: "Mark an existing creation as an approved reference/mold for its client and/or template so future generations can reuse its visual logic.",
      inputSchema: z.object({
        design_id: z.string().uuid(), name: z.string().max(160).optional(),
        reference_type: z.string().max(80).optional(), metadata: z.record(z.string(), z.any()).optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ design_id, name, reference_type = "approved_creation", metadata = {} }) => {
      const db = getDb();
      const design = await db.from("design_previews").select("id,title,client_id,template_id").eq("id", design_id).maybeSingle();
      if (design.error) throw design.error;
      if (!design.data) throw new Error("Design not found");
      const q = await db.from("design_references").insert({
        client_id: design.data.client_id || null, template_id: design.data.template_id || null, design_id,
        name: name || design.data.title, reference_type, metadata
      }).select("*").single();
      if (q.error) throw q.error;
      return { structuredContent: { reference: q.data }, content: [{ type: "text", text: `Registered "${q.data.name}" as a reusable design reference.` }] };
    }
  );

  server.registerTool(
    "export_preview_pdf",
    {
      title: "Export preview as PDF",
      description: "Create a temporary signed PDF download link that works outside the private Studio.",
      inputSchema: z.object({ id: z.string().uuid(), ttl_minutes: z.number().int().min(5).max(1440).optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    },
    async ({ id, ttl_minutes = 60 }) => {
      const db = getDb();
      const q = await db.from("design_previews").select("id,title,current_version,updated_at").eq("id", id).maybeSingle();
      if (q.error) throw q.error;
      if (!q.data) return { structuredContent: { found: false, id }, content: [{ type: "text", text: `No preview found for id ${id}.` }] };
      const link = await createShareLink(db, id, "pdf", ttl_minutes, "mcp");
      return { structuredContent: { found: true, design: q.data, download: link }, content: [{ type: "text", text: `PDF ready for "${q.data.title}". ${link.url}` }] };
    }
  );

  server.registerTool(
    "create_share_link",
    {
      title: "Create external file link",
      description: "Create a temporary signed preview, HTML or PDF link without exposing the private Studio session.",
      inputSchema: z.object({ id: z.string().uuid(), purpose: z.enum(["preview","html","pdf"]), ttl_minutes: z.number().int().min(5).max(1440).optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    },
    async ({ id, purpose, ttl_minutes = 60 }) => {
      const db = getDb();
      const q = await db.from("design_previews").select("id,title").eq("id", id).maybeSingle();
      if (q.error) throw q.error;
      if (!q.data) return { structuredContent: { found: false, id }, content: [{ type: "text", text: `No preview found for id ${id}.` }] };
      const link = await createShareLink(db, id, purpose, ttl_minutes, "mcp");
      return { structuredContent: { found: true, design: q.data, share: link }, content: [{ type: "text", text: `Temporary ${purpose} link for "${q.data.title}": ${link.url}` }] };
    }
  );

  return server;
}

const mcp = createMcpHandler(() => makeServer());
const nodeHandler = toNodeHandler(mcp);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!mcpAuthorized(req)) return res.status(401).json({ error: "Unauthorized MCP request" });
  return nodeHandler(req as any, res as any, req.body);
}
