# Tarazu — Smart Shopkeeper Tools

Static site with a server-side Telegram notification bot.

## What the bot sends

On a page visit or after any calculator produces a result, `index.html` posts a small JSON payload to `/.netlify/functions/visitor-ping`. The Netlify Function:

1. Keeps the Telegram bot token on the server (never in browser code).
2. Looks up the visitor's ISP from the request IP via `ipwho.is` (cached 30 min, no API key).
3. Builds a tree-style Telegram alert with:
   - `SEARCH & RESULT` — which tool was used, the inputs entered and the final answer,
   - `LOCATION & NETWORK` — IP, ISP, approximate city/region/country and browser connection,
   - `DEVICE DETAILS` — device, OS, browser, screen/viewport, battery level and charging state,
   - language, timezone, theme, referrer, IST timestamp and an "Open Tarazu" button.

Browsers that block the Battery Status API report `Not exposed by browser`; IP lookups that fail report `IP lookup unavailable`. Notifications are throttled in the browser: one visit alert per 10 minutes, one alert per tool per 45 seconds (per tab session).

## Setup

Set these environment variables in Netlify (Site configuration → Environment variables), then redeploy:

| Variable | Example | Purpose |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | `123456:AA...` | Token from [@BotFather](https://t.me/BotFather); required |
| `TELEGRAM_CHAT_ID` | `@pmharsh` | Destination chat/channel; defaults to `@pmharsh` |
| `ALLOWED_ORIGINS` | `https://mysite.example` | Optional extra origins, comma-separated |

The bot must be a member of the target channel if `TELEGRAM_CHAT_ID` is a channel. To test locally, run `netlify dev` and set the same variables in a `.env` file.

## Files

- `index.html` — calculators, visitor diagnostics collector and throttled ping.
- `netlify/functions/visitor-ping.js` — origin check, ISP lookup, message formatting, Telegram delivery.
- `tests/visitor-ping.test.js` — dependency-free tests using Node's built-in test runner.

## Tests

```bash
node --test tests/*.test.js
```

No third-party packages are required.
