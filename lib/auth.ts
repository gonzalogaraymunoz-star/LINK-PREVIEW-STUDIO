import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./db.js";

/**
 * LINK Preview Studio — Direct Access mode.
 *
 * The browser workspace does not require a user login.
 * Server secrets remain server-side. MCP keeps its own LINK_MCP_TOKEN protection.
 *
 * IMPORTANT: anyone who can reach the public Studio URL can use Studio browser actions.
 * Put the Vercel project behind Deployment Protection if private URL-level access is required later.
 */
export async function requireMember(_req: VercelRequest, _res: VercelResponse) {
  return {
    db: getDb(),
    user: { id: "direct-studio", email: "Acceso directo" },
    member: { user_id: "direct-studio", role: "owner", status: "active" },
    token: ""
  };
}

export async function requireEditor(req: VercelRequest, res: VercelResponse) {
  return requireMember(req, res);
}

export function mcpAuthorized(req: VercelRequest) {
  const required = (process.env.LINK_MCP_TOKEN || "").trim();
  const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";

  // Production MCP remains closed unless LINK_MCP_TOKEN is configured.
  if (!required) return !isProduction;

  const rawHeader = req.headers.authorization;
  const raw = Array.isArray(rawHeader) ? rawHeader[0] || "" : rawHeader || "";
  const bearer = raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";

  const customHeader = req.headers["x-link-mcp-token"];
  const custom = Array.isArray(customHeader) ? customHeader[0] || "" : String(customHeader || "");

  const queryTokenRaw = req.query?.mcp_token;
  const queryToken = Array.isArray(queryTokenRaw)
    ? String(queryTokenRaw[0] || "")
    : String(queryTokenRaw || "");

  return bearer === required || custom === required || queryToken === required;
}
