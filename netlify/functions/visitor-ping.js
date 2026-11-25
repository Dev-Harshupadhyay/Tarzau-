// Netlify Function: Telegram activity bot for Tarazu.
// The bot token stays on the server; the browser only sends anonymous-ish
// diagnostic fields that are rendered into a readable Telegram message.

const TELEGRAM_API = "https://api.telegram.org";
const SITE_URL = "https://tarzau.netlify.app";
const MAX_BODY_BYTES = 12_000;
const IP_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const ipCache = new Map();

const RESPONSE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

function json(statusCode, payload) {
  return { statusCode, headers: RESPONSE_HEADERS, body: JSON.stringify(payload) };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
}

function clean(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max) || "Unknown";
}

// Only the production site, its Netlify deploy previews, and local dev are allowed.
function isOriginAllowed(origin) {
  if (!origin) return true; // non-browser callers (health checks, tests)
  const extra = (process.env.ALLOWED_ORIGINS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (extra.includes(origin)) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return /^https:\/\/([\w-]+--)?tarzau\.netlify\.app$/.test(origin);
}

function clientIp(event) {
  const headers = event.headers || {};
  const forwarded = headers["x-forwarded-for"] || headers["X-Forwarded-For"] || "";
  const first = String(forwarded).split(",")[0].trim();
  const netlify = headers["x-nf-client-connection-ip"] || headers["X-Nf-Client-Connection-IP"] || "";
  const ip = first || String(netlify).trim();
  return /^[\w:.]+$/.test(ip) ? ip.slice(0, 64) : "";
}

function isPrivateIp(ip) {
  return /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|^localhost)/.test(ip)
    || !ip.includes(".") && !ip.includes(":");
}

// ISP is derived from the visitor's public IP. ipwho.is is free and needs no key.
async function lookupNetwork(ip) {
  const fallback = { isp: "IP lookup unavailable", org: "", asn: "", city: "", country: "" };
  if (!ip || isPrivateIp(ip)) return { ...fallback, isp: "Local / private IP" };

  const cached = ipCache.get(ip);
  if (cached && Date.now() - cached.at < IP_CACHE_TTL) return cached.data;

  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,connection,city,country`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(2500)
    });
    if (!response.ok) return fallback;
    const data = await response.json();
    if (data.success === false) return fallback;
    const connection = data.connection || {};
    const result = {
      isp: clean(connection.isp || connection.org || "Unknown ISP", 90),
      org: clean(connection.org || "", 90),
      asn: clean(connection.asn || "", 40),
      city: clean(data.city || "", 60),
      country: clean(data.country || "", 60)
    };
    if (ipCache.size > 500) ipCache.delete(ipCache.keys().next().value);
    ipCache.set(ip, { at: Date.now(), data: result });
    return result;
  } catch {
    return fallback;
  }
}

function buildMessage({ eventType, tool, detail, client, network }) {
  const time = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "medium"
  });

  const lines = [
    "🔔 TARAZU · LIVE ACTIVITY",
    "",
    eventType === "tool"
      ? "🛠️ <b>Kisi ne Tarazu ka tool use kiya!</b>"
      : "👋 <b>Ek naya visitor Tarazu par aaya!</b>",
    "",
    "🧰 <b>WHAT HAPPENED</b>",
    `• Tool: <b>${escapeHtml(tool)}</b>`,
    detail ? `• Input / result: ${escapeHtml(detail)}` : null,
    `• Time (IST): ${escapeHtml(time)}`,
    "",
    "🌐 <b>NETWORK</b>",
    `• ISP: ${escapeHtml(network.isp)}`,
    network.asn && network.asn !== "Unknown" ? `• ASN: ${escapeHtml(network.asn)}` : null,
    network.city || network.country
      ? `• Location (IP based): ${escapeHtml([network.city, network.country].filter(Boolean).join(", "))}`
      : null,
    `• Browser network: ${escapeHtml(client.connection)}`,
    "",
    "📱 <b>DEVICE &amp; BROWSER</b>",
    `• Browser: ${escapeHtml(client.browser)} on ${escapeHtml(client.os)}`,
    `• Device: ${escapeHtml(client.device)} · ${escapeHtml(client.screen)} screen · ${escapeHtml(client.viewport)} viewport`,
    `• Battery: ${escapeHtml(client.battery)}`,
    `• Language: ${escapeHtml(client.language)} · Timezone: ${escapeHtml(client.timezone)}`,
    `• Theme: ${escapeHtml(client.theme)} · Online: ${client.online ? "Yes" : "No"}`,
    `• Referrer: ${escapeHtml(client.referrer)}`,
    client.page && client.page !== "Unknown" ? `• Page: ${escapeHtml(client.page)}` : null,
    "",
    "————————————",
    "Tarazu Bot · built for Harsh ✨"
  ];

  return lines.filter((line) => line !== null).join("\n").slice(0, 3800);
}

function normaliseClient(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    browser: clean(source.browser, 90),
    os: clean(source.os, 90),
    device: clean(source.device, 30),
    screen: clean(source.screen, 40),
    viewport: clean(source.viewport, 40),
    language: clean(source.language, 60),
    timezone: clean(source.timezone, 60),
    theme: clean(source.theme, 20),
    online: source.online === true,
    connection: clean(source.connection, 120),
    battery: clean(source.battery, 120),
    referrer: clean(source.referrer, 180),
    page: clean(source.page, 180)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: { ...RESPONSE_HEADERS, Allow: "POST" },
      body: ""
    };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: { ...RESPONSE_HEADERS, Allow: "POST" }, body: "Method Not Allowed" };
  }
  if (!isOriginAllowed(event.headers?.origin || event.headers?.Origin || "")) {
    return json(403, { ok: false, error: "Forbidden" });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID || "@pmharsh";
  if (!token) return json(500, { ok: false, error: "Server is not configured" });

  const raw = event.body || "";
  if (raw.length > MAX_BODY_BYTES) return json(413, { ok: false, error: "Payload too large" });

  let payload;
  try {
    payload = JSON.parse(event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw);
  } catch {
    return json(400, { ok: false, error: "Invalid JSON" });
  }
  if (!payload || typeof payload !== "object") {
    return json(400, { ok: false, error: "Invalid payload" });
  }

  const eventType = payload.event === "tool" ? "tool" : "visit";
  const tool = clean(payload.tool, 80);
  const detail = clean(payload.detail, 260);
  const client = normaliseClient(payload.client);
  const network = await lookupNetwork(clientIp(event));
  const text = buildMessage({ eventType, tool, detail, client, network });

  try {
    const response = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[{ text: "Open Tarazu ↗", url: SITE_URL }]]
        }
      }),
      signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) {
      console.error("Telegram delivery failed with status", response.status);
      return json(502, { ok: false, error: "Notification delivery failed" });
    }
    return json(200, { ok: true });
  } catch (error) {
    console.error("Telegram delivery failed:", error?.message || "unknown error");
    return json(502, { ok: false, error: "Notification delivery failed" });
  }
};

// Exported for unit tests only.
exports._test = { buildMessage, escapeHtml, isOriginAllowed, lookupNetwork, ipCache };
