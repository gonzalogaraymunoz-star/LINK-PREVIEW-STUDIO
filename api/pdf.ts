import type { VercelRequest, VercelResponse } from "@vercel/node";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import net from "node:net";
import { getDb, slugify } from "../lib/db.js";
import { requireMember } from "../lib/auth.js";
import { verifyShareToken } from "../lib/share.js";
import { queryValue, noStore } from "../lib/http.js";

function privateIpv4(host: string) {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return a === 10 || a === 127 || a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127);
}

function blockedUrl(value: string) {
  try {
    const url = new URL(value);
    if (["data:", "blob:", "about:"].includes(url.protocol)) return false;
    if (!["http:", "https:"].includes(url.protocol)) return true;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (["localhost", "0.0.0.0", "::1", "169.254.169.254"].includes(host)) return true;
    if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) return true;
    if (net.isIP(host) === 4 && privateIpv4(host)) return true;
    if (net.isIP(host) === 6 && (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:"))) return true;
    return false;
  } catch {
    return true;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const id = queryValue(req, "id");
  const token = queryValue(req, "token");
  if (!id) return res.status(400).json({ error: "Preview id is required" });
  const db = getDb();

  if (token) {
    const ok = await verifyShareToken(db, id, token, ["pdf"]);
    if (!ok) return res.status(403).json({ error: "Invalid or expired share link" });
  } else {
    const auth = await requireMember(req, res);
    if (!auth) return;
  }

  const design = await db.from("design_previews")
    .select("id,title,html,current_version,updated_at")
    .eq("id", id).maybeSingle();
  if (design.error) return res.status(500).json({ error: design.error.message });
  if (!design.data) return res.status(404).json({ error: "Preview not found" });

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    chromium.setGraphicsMode = false;
    const args = await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" });
    browser = await puppeteer.launch({
      args,
      executablePath: await chromium.executablePath(),
      headless: "shell",
      defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 }
    });

    const page = await browser.newPage();
    await page.emulateMediaType("screen");
    await page.setRequestInterception(true);
    page.on("request", request => {
      if (blockedUrl(request.url())) request.abort();
      else request.continue();
    });

    await page.setContent(design.data.html, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 7_000 }).catch(() => {});
    await page.evaluate(async () => {
      if ("fonts" in document) await (document as Document & { fonts: FontFaceSet }).fonts.ready;
    }).catch(() => {});

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" }
    });

    const version = await db.from("design_versions").select("id")
      .eq("design_id", id).eq("version_number", design.data.current_version).maybeSingle();

    const record = await db.from("generation_files").insert({
      design_id: id,
      version_id: version.data?.id || null,
      file_type: "pdf",
      mime_type: "application/pdf",
      size_bytes: pdf.byteLength,
      metadata: { generated_on_demand: true, version_number: design.data.current_version }
    });
    if (record.error) console.warn("generation_files record failed", record.error.message);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${slugify(design.data.title)}.pdf"`);
    noStore(res);
    return res.status(200).send(Buffer.from(pdf));
  } catch (error: any) {
    console.error("PDF_RENDER_FAILED", error);
    return res.status(500).json({ error: "Could not render PDF", detail: error?.message || String(error) });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
