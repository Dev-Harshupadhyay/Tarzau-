// Netlify Function: Telegram activity bot for Tarazu.
// The bot token stays on the server; the browser only sends diagnostic fields
// which are rendered into a compact, readable Telegram alert.

const TELEGRAM_API = "https://api.telegram.org";
const SITE_URL = "https://tarzau.netlify.app";
const MAX_BODY_BYTES = 12_000;
const IP_CACHE_TTL = 30 * 60 * 1000;
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

function b(value) {
  return `<b>${escapeHtml(value)}</b>`;
}

function code(value) {
  return `<code>${escapeHtml(value)}</code>`;
}

function clean(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max) || "Unknown";
}

function optional(value, max) {
  const text = clean(value, max);
  return text === "Unknown" ? "" : text;
}

// Production site, its Netlify deploy previews, and local dev are allowed.
function isOriginAllowed(origin) {
  if (!origin) return true;
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

// ISP + approximate location from the public IP. ipwho.is needs no API key.
async function lookupNetwork(ip) {
  const fallback = {
    ip: ip || "Unknown", isp: "IP lookup unavailable", org: "",
    asn: "", city: "", region: "", country: ""
  };
  if (!ip || isPrivateIp(ip)) return { ...fallback, isp: "Local / private IP" };

  const cached = ipCache.get(ip);
  if (cached && Date.now() - cached.at < IP_CACHE_TTL) return cached.data;

  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,connection,city,region,country`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(2500)
    });
    if (!response.ok) return fallback;
    const data = await response.json();
    if (data.success === false) return fallback;
    const connection = data.connection || {};
    const result = {
      ip,
      isp: clean(connection.isp || connection.org || "Unknown ISP", 90),
      org: clean(connection.org || "", 90),
      asn: clean(connection.asn || "", 40),
      city: clean(data.city || "", 60),
      region: clean(data.region || "", 60),
      country: clean(data.country || "", 60)
    };
    if (ipCache.size > 500) ipCache.delete(ipCache.keys().next().value);
    ipCache.set(ip, { at: Date.now(), data: result });
    return result;
  } catch {
    return fallback;
  }
}

function tree(rows) {
  const items = rows.filter((row) => row !== null && row !== "");
  return items.map((row, index) => `${index === items.length - 1 ? "└" : "├"} ${row}`);
}

function deviceEmoji(device) {
  if (/tablet/i.test(device)) return "📟";
  if (/mobile/i.test(device)) return "📱";
  return "🖥️";
}

function osEmoji(os) {
  if (/windows/i.test(os)) return "🪟";
  if (/android/i.test(os)) return "🤖";
  if (/ios|mac/i.test(os)) return "🍎";
  if (/chrome\s*os|cros/i.test(os)) return "💻";
  if (/linux/i.test(os)) return "🐧";
  return "💻";
}

function buildMessage({ eventType, tool, detail, query, result, client, network }) {
  const time = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "medium"
  });

  const who = [client.device, deviceEmoji(client.device), client.browser, network.ip]
    .filter(Boolean).join(" · ");
  const searchRows = [];
  if (eventType === "tool") {
    searchRows.push(`<b>Tool:</b> ${b(tool)}`);
    if (query) searchRows.push(`<b>Search:</b> ${code(query)}`);
    const finalResult = result || detail;
    if (finalResult) searchRows.push(`<b>Answer:</b> ${b(finalResult)}`);
    searchRows.push(`<b>By:</b> ${b(who)}`);
  } else {
    const page = client.page && client.page !== "Unknown" ? client.page : "/";
    searchRows.push(`<b>Page:</b> ${b(page)}`);
    searchRows.push(`<b>Status:</b> ${b(detail || "Landing page loaded")}`);
    searchRows.push(`<b>By:</b> ${b(who)}`);
  }

  const location = [network.city, network.region, network.country].filter(Boolean).join(", ");
  const networkRows = [
    `<b>IP:</b> ${code(network.ip)}`,
    `<b>ISP:</b> ${b(network.isp)}`,
    location ? `<b>Where:</b> ${b(location)}` : null,
    `<b>Net:</b> ${b(client.connection)}`
  ];

  const deviceRows = [
    `<b>Device:</b> ${b(client.device + " " + deviceEmoji(client.device))}`,
    `<b>OS:</b> ${b(client.os + " " + osEmoji(client.os))}`,
    `<b>Browser:</b> ${b(client.browser)}`,
    `<b>Screen:</b> ${b(client.screen)} (viewport ${b(client.viewport)})`,
    `<b>Battery:</b> 🔋 ${b(client.battery)}`,
    `<b>Timezone:</b> ${b(client.timezone)}`,
    `<b>Language:</b> ${b(client.language)}`,
    `<b>Theme:</b> ${b(client.theme)} · <b>Online:</b> ${b(client.online ? "Yes" : "No")}`,
    client.referrer && client.referrer !== "Unknown" ? `<b>Referrer:</b> ${b(client.referrer)}` : null
  ];

  return [
    `⚡ <b>TARAZU · ${eventType === "tool" ? "TOOL USED" : "NEW VISITOR"}</b>`,
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    "🔍 <b>WHAT WAS SEARCHED</b>",
    ...tree(searchRows),
    "",
    "📍 <b>LOCATION &amp; NETWORK</b>",
    ...tree(networkRows),
    "",
    "📱 <b>DEVICE DETAILS</b>",
    ...tree(deviceRows),
    "",
    `🇮🇳 <b>IST:</b> ${b(time)}`,
    "━━━━ ━━━━━━━━━━━━━━━━",
    "<b>Tarazu Bot</b> · built for Harsh ✨"
  ].join("\n").slice(0, 3800);
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
  const tool = optional(payload.tool, 80);
  const detail = optional(payload.detail, 260);
  const query = optional(payload.query, 220);
  const result = optional(payload.result, 220);
  const client = normaliseClient(payload.client);
  const network = await lookupNetwork(clientIp(event));
  const text = buildMessage({ eventType, tool, detail, query, result, client, network });

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
