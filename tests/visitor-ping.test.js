const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const functionModule = require('../netlify/functions/visitor-ping');

const ORIGIN = 'https://tarzau.netlify.app';
const originalFetch = global.fetch;
const originalToken = process.env.TELEGRAM_BOT_TOKEN;
const originalChat = process.env.TELEGRAM_CHAT_ID;

let calls = [];

function stubFetch({ ipLookupFails = false } = {}) {
  calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (String(url).includes('ipwho.is')) {
      if (ipLookupFails) throw new Error('network down');
      return new Response(JSON.stringify({
        success: true,
        connection: { isp: 'Reliance Jio', org: 'RJIL', asn: 'AS55836' },
        city: 'Delhi', region: 'Delhi', country: 'IN'
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{"ok":true}', { status: 200 });
  };
}

function makeEvent(overrides = {}) {
  return {
    httpMethod: 'POST',
    headers: { origin: ORIGIN, 'x-forwarded-for': '49.36.10.25, 10.0.0.1' },
    body: JSON.stringify({
      event: 'tool',
      tool: 'Weight Calculator',
      query: '₹40/kg price · ₹15 budget',
      result: '375 g',
      detail: '375 g · 9.38 g per ₹1',
      client: {
        browser: 'Chrome 131', os: 'Linux', device: 'Desktop',
        screen: '1920×1080', viewport: '1920×900', language: 'en-US',
        timezone: 'America/New_York', theme: 'light', online: true,
        connection: 'WIFI · 50 Mbps down · 20 ms RTT',
        battery: '72% · charging ⚡', referrer: 'Direct / none', page: '/'
      }
    }),
    isBase64Encoded: false,
    ...overrides
  };
}

function telegramCall() {
  const call = calls.find((c) => String(c.url).includes('api.telegram.org'));
  assert.ok(call, 'expected a Telegram API request');
  return { url: call.url, payload: JSON.parse(call.options.body) };
}

afterEach(() => {
  global.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = originalToken;
  if (originalChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
  else process.env.TELEGRAM_CHAT_ID = originalChat;
  functionModule._test.ipCache.clear();
});

test('sends the tree-style alert with search, result, IP, ISP, device and battery', async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.TELEGRAM_CHAT_ID = '@tester';
  stubFetch();

  const result = await functionModule.handler(makeEvent());

  assert.equal(result.statusCode, 200);
  const { url, payload } = telegramCall();
  assert.match(url, /\/bottest-token\/sendMessage$/);
  assert.equal(payload.chat_id, '@tester');
  assert.equal(payload.parse_mode, 'HTML');
  for (const expected of [
    '⚡ TARAZU · TOOL USED',
    'SEARCH &amp; RESULT',
    '├ Tool: <b>Weight Calculator</b>',
    '├ Search: ₹40/kg price · ₹15 budget',
    '└ Result: <b>375 g</b>',
    '📍 <b>LOCATION &amp; NETWORK</b>',
    '├ IP: 49.36.10.25',
    '├ ISP: Reliance Jio',
    '├ Location: Delhi, Delhi, IN',
    '📱 <b>DEVICE DETAILS</b>',
    '├ Device: Desktop 🖥️',
    '├ OS: Linux 🐧',
    '├ Browser: Chrome 131',
    '├ Battery: 🔋 72% · charging ⚡'
  ]) {
    assert.ok(payload.text.includes(expected), `message should contain: ${expected}`);
  }
  assert.match(payload.text, /🇮🇳 IST: <b>/);
  assert.equal(payload.reply_markup.inline_keyboard[0][0].text, 'Open Tarazu ↗');
});

test('falls back gracefully when IP lookup fails', async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  stubFetch({ ipLookupFails: true });

  const result = await functionModule.handler(makeEvent());

  assert.equal(result.statusCode, 200);
  assert.match(telegramCall().payload.text, /ISP: IP lookup unavailable/);
});

test('escapes user-controlled text and never leaks the token into the message', async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'super-secret-token';
  stubFetch();

  const event = makeEvent();
  const body = JSON.parse(event.body);
  body.result = '<script>alert("x")</script> & more';
  event.body = JSON.stringify(body);
  await functionModule.handler(event);

  const text = telegramCall().payload.text;
  assert.ok(text.includes('&lt;script&gt;'));
  assert.ok(!text.includes('<script>'));
  assert.ok(!text.includes('super-secret-token'));
});

test('rejects unsupported methods, foreign origins and missing config', async () => {
  stubFetch();
  assert.equal((await functionModule.handler({ ...makeEvent(), httpMethod: 'GET' })).statusCode, 405);
  assert.equal((await functionModule.handler({
    ...makeEvent(), headers: { ...makeEvent().headers, origin: 'https://evil.example' }
  })).statusCode, 403);

  delete process.env.TELEGRAM_BOT_TOKEN;
  assert.equal((await functionModule.handler(makeEvent())).statusCode, 500);
  assert.equal(calls.length, 0, 'no outbound requests for rejected calls');
});

test('accepts preview and localhost origins', () => {
  const allowed = functionModule._test.isOriginAllowed;
  assert.equal(allowed('https://deploy-preview-12--tarzau.netlify.app'), true);
  assert.equal(allowed('http://localhost:8888'), true);
  assert.equal(allowed('https://someone-else.netlify.app'), false);
});
