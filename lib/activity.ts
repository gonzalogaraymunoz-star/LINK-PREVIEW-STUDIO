export async function logActivity(db: any, input: {
  project_id?: string | null;
  design_id?: string | null;
  request_id?: string | null;
  action: string;
  actor?: string;
  details?: Record<string, any>;
}) {
  const result = await db.from("activity_log").insert({
    project_id: input.project_id || null,
    design_id: input.design_id || null,
    request_id: input.request_id || null,
    action: input.action,
    actor: input.actor || "link-preview-studio",
    details: input.details || {}
  });
  if (result.error) throw result.error;
}
