import { createClient } from "@supabase/supabase-js";

const DEFAULT_SUPABASE_URL = "https://zgbnjlrxzvzpigmwidsp.supabase.co";
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_RE_eqhBaLeaUMHuBjLUY2Q_OZNBm9_A";

export function supabaseUrl() {
  return (process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, "");
}

export function publishableKey() {
  return process.env.SUPABASE_PUBLISHABLE_KEY || DEFAULT_PUBLISHABLE_KEY;
}

export function getDb() {
  const url = supabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export function getPublicAuthClient() {
  return createClient(supabaseUrl(), publishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export function baseUrl() {
  const configured = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  const vercel = (process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || "").trim();
  return vercel ? `https://${vercel.replace(/^https?:\/\//, "").replace(/\/$/, "")}` : "";
}

export function previewUrls(id: string) {
  const base = baseUrl();
  const studio = `/?design=${encodeURIComponent(id)}`;
  const preview = `/preview?id=${encodeURIComponent(id)}`;
  return {
    studio_url: base ? `${base}${studio}` : studio,
    preview_url: base ? `${base}${preview}` : preview
  };
}

export function slugify(input: string) {
  return String(input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "item";
}
