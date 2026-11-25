// Netlify Function: keeps the Telegram bot token on the server.
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: { Allow: "POST" }, body: "Method Not Allowed" };
  }

  // Accept browser requests only from the production site.
  const origin = event.headers.origin || event.headers.Origin || "";
  if (origin !== "https://tarzau.netlify.app") {
    return { statusCode: 403, body: "Forbidden" };
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID || "@pmharsh";
  if (!token) {
    return { statusCode: 500, body: "Server is not configured" };
  }

  const timestamp = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata"
  });

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: `🔔 Tarazu visitor!\\n${timestamp}`
      })
    });

    if (!response.ok) {
      return { statusCode: 502, body: "Notification delivery failed" };
    }

    return { statusCode: 200, body: "OK" };
  } catch {
    return { statusCode: 502, body: "Notification delivery failed" };
  }
};
