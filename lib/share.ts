import { createHash, randomBytes } from "node:crypto";
import { baseUrl } from "./db.js";

export type SharePurpose = "pdf" | "html" | "preview";

export function hashShareToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createShareLink(
  db: any,
  designId: string,
  purpose: SharePurpose,
  ttlMinutes = 60,
  createdBy = "link-preview-studio"
) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashShareToken(token);
  const ttl = Math.max(5, Math.min(Number(ttlMinutes) || 60, 1440));
  const expiresAt = new Date(Date.now() + ttl * 60_000).toISOString();

  const inserted = await db.from("share_links").insert({
    design_id: designId,
    purpose,
    token_hash: tokenHash,
    expires_at: expiresAt,
    created_by: createdBy
  }).select("id,expires_at").single();
  if (inserted.error) throw inserted.error;

  const base = baseUrl();
  const params = `id=${encodeURIComponent(designId)}&token=${encodeURIComponent(token)}`;
  let path: string;
  if (purpose === "pdf") path = `/api/pdf?${params}`;
  else if (purpose === "html") path = `/api/files?op=html&${params}&download=1`;
  else path = `/api/files?op=html&${params}`;

  return {
    url: base ? `${base}${path}` : path,
    expires_at: inserted.data.expires_at,
    purpose
  };
}

export async function verifyShareToken(
  db: any,
  designId: string,
  token: string,
  allowedPurposes: SharePurpose[]
) {
  if (!token) return false;
  const tokenHash = hashShareToken(token);
  const result = await db.from("share_links")
    .select("id,purpose,expires_at")
    .eq("design_id", designId)
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (result.error || !result.data) return false;
  if (!allowedPurposes.includes(result.data.purpose as SharePurpose)) return false;
  return new Date(result.data.expires_at).getTime() > Date.now();
}
