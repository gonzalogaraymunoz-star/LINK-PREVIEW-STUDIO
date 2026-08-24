import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb, getPublicAuthClient } from "./db.js";

const ACCESS_COOKIE = "link_access";
const REFRESH_COOKIE = "link_refresh";

function isSecure() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
}

function cookieString(name: string, value: string, maxAge: number) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`
  ];
  if (isSecure()) parts.push("Secure");
  return parts.join("; ");
}

function clearCookie(name: string) {
  return cookieString(name, "", 0);
}

function parseCookies(req: VercelRequest) {
  const header = String(req.headers.cookie || "");
  const out: Record<string, string> = {};
  header.split(";").forEach(part => {
    const index = part.indexOf("=");
    if (index < 0) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  });
  return out;
}

function bearerToken(req: VercelRequest) {
  const rawHeader = req.headers.authorization;
  const raw = Array.isArray(rawHeader) ? rawHeader[0] || "" : rawHeader || "";
  return raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";
}

export function setSessionCookies(res: VercelResponse, session: any) {
  const accessTtl = Number(session?.expires_in || 3600);
  const refreshTtl = 60 * 60 * 24 * 30;
  const cookies = [
    cookieString(ACCESS_COOKIE, session.access_token, accessTtl),
    cookieString(REFRESH_COOKIE, session.refresh_token, refreshTtl)
  ];
  res.setHeader("Set-Cookie", cookies);
}

export function clearSessionCookies(res: VercelResponse) {
  res.setHeader("Set-Cookie", [clearCookie(ACCESS_COOKIE), clearCookie(REFRESH_COOKIE)]);
}

export async function ensureMember(db: any, user: any) {
  let memberResult = await db.from("app_members")
    .select("user_id,role,status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (memberResult.error) throw memberResult.error;
  let member = memberResult.data;

  if (!member) {
    const ownerEmail = (process.env.LINK_OWNER_EMAIL || "").trim().toLowerCase();
    const currentEmail = String(user.email || "").trim().toLowerCase();
    const countResult = await db.from("app_members").select("user_id", { count: "exact", head: true });
    if (countResult.error) throw countResult.error;

    if ((countResult.count || 0) === 0 && ownerEmail && currentEmail === ownerEmail) {
      const inserted = await db.from("app_members")
        .insert({ user_id: user.id, role: "owner", status: "active" })
        .select("user_id,role,status")
        .single();
      if (inserted.error) throw inserted.error;
      member = inserted.data;
    }
  }

  if (!member || member.status !== "active") return null;
  return member;
}

async function userFromToken(token: string) {
  const db = getDb();
  const result = await db.auth.getUser(token);
  if (result.error || !result.data?.user) return null;
  return { db, user: result.data.user, token };
}

async function refreshFromCookie(req: VercelRequest, res: VercelResponse) {
  const cookies = parseCookies(req);
  const refreshToken = cookies[REFRESH_COOKIE];
  if (!refreshToken) return null;

  const authClient = getPublicAuthClient();
  const refreshed = await authClient.auth.refreshSession({ refresh_token: refreshToken });
  if (refreshed.error || !refreshed.data?.session || !refreshed.data?.user) {
    clearSessionCookies(res);
    return null;
  }
  setSessionCookies(res, refreshed.data.session);
  return { user: refreshed.data.user, token: refreshed.data.session.access_token };
}

export async function requireMember(req: VercelRequest, res: VercelResponse) {
  const cookies = parseCookies(req);
  const token = bearerToken(req) || cookies[ACCESS_COOKIE] || "";
  let resolved = token ? await userFromToken(token) : null;

  if (!resolved) {
    const refreshed = await refreshFromCookie(req, res);
    if (refreshed) resolved = { db: getDb(), ...refreshed };
  }

  if (!resolved) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }

  try {
    const member = await ensureMember(resolved.db, resolved.user);
    if (!member) {
      res.status(403).json({ error: "This account is not authorized for LINK Preview Studio." });
      return null;
    }
    return { ...resolved, member };
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Could not verify membership" });
    return null;
  }
}

export async function requireEditor(req: VercelRequest, res: VercelResponse) {
  const auth = await requireMember(req, res);
  if (!auth) return null;
  if (!["owner", "editor"].includes(auth.member.role)) {
    res.status(403).json({ error: "Write permission required" });
    return null;
  }
  return auth;
}

export function mcpAuthorized(req: VercelRequest) {
  const required = (process.env.LINK_MCP_TOKEN || "").trim();
  const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
  if (!required) return !isProduction;

  const rawHeader = req.headers.authorization;
  const raw = Array.isArray(rawHeader) ? rawHeader[0] || "" : rawHeader || "";
  const bearer = raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";
  const customHeader = req.headers["x-link-mcp-token"];
  const custom = Array.isArray(customHeader) ? customHeader[0] || "" : String(customHeader || "");
  const queryTokenRaw = req.query?.mcp_token;
  const queryToken = Array.isArray(queryTokenRaw) ? String(queryTokenRaw[0] || "") : String(queryTokenRaw || "");
  return bearer === required || custom === required || queryToken === required;
}
