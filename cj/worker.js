/**
 * CJ — Zeabur 域名白名单网关（逻辑与 somavelee Cloudflare Worker 一致）
 */

const DEFAULT_INSTANCE = 'ex_workcamp';
const DEFAULT_WHITELIST_URL = 'http://us1.myec2.com/ext/bai.js';

/** @type {Set<string>} */
let whitelistSet = new Set();
/** @type {Promise<void> | null} */
let refreshPromise = null;

const BOT_UA_TOKENS = [
  'GPTBot', 'ChatGPT-User', 'OAI-SearchBot',
  'ClaudeBot', 'Claude-Web', 'Claude-SearchBot', 'anthropic-ai',
  'Google-Extended', 'GoogleOther', 'Google-CloudVertexBot', 'Gemini-Deep-Research',
  'Applebot-Extended',
  'PerplexityBot', 'Perplexity-User',
  'Bytespider', 'CCBot', 'cohere-ai', 'Diffbot', 'YouBot', 'AI2Bot', 'Amazonbot',
  'Meta-ExternalAgent', 'Meta-ExternalFetcher', 'FacebookBot', 'meta-externalagent',
  'MistralAI-User', 'DeepSeekBot', 'HuggingFaceFetcher', 'ImagesiftBot', 'Timpibot',
  'omgili', 'omgilibot', 'img2dataset',
  'Googlebot', 'Googlebot-Image', 'Googlebot-Video', 'Googlebot-News', 'Storebot-Google',
  'Mediapartners-Google', 'AdsBot-Google', 'Bingbot', 'BingPreview', 'msnbot',
  'Slurp', 'DuckDuckBot', 'Baiduspider', 'YandexBot', 'YandexImages', 'Sogou', 'Exabot',
  'Applebot', 'PetalBot', 'SeekportBot', 'MojeekBot', 'SeznamBot', 'Qwantify',
  'SemrushBot', 'AhrefsBot', 'MJ12bot', 'DotBot', 'rogerbot', 'Screaming Frog',
  'facebot', 'Twitterbot', 'LinkedInBot', 'WhatsApp', 'TelegramBot', 'Discordbot',
  'Pinterestbot', 'Slackbot', 'Slack-ImgProxy', 'Embedly', 'vkShare', 'W3C_Validator',
  'ia_archiver',
];

const AUTOMATION_UA_PATTERNS = [
  /^curl\//i,
  /^Wget\//i,
  /python-requests/i,
  /httpx\//i,
  /aiohttp\//i,
  /Go-http-client/i,
  /^Java\//i,
  /libwww-perl/i,
  /Scrapy\//i,
  /okhttp\//i,
  /PostmanRuntime/i,
  /Insomnia\//i,
  /^php\//i,
  /^Ruby\//i,
];

const BROWSER_FINGERPRINT = /Mozilla\/5\.0/i;
const BROWSER_VERSION =
  /(?:Chrome|Firefox|Safari|Edg|OPR|SamsungBrowser|CriOS|FxiOS|Version)\//i;
const GENERIC_BOT_NAME =
  /\b[A-Z][a-zA-Z0-9_-]*(?:bot|Bot|spider|Spider|crawler|Crawler)\b/;

function getEnv() {
  return {
    WHITELIST_URL: process.env.WHITELIST_URL || DEFAULT_WHITELIST_URL,
    BOT_UA_EXTRA: process.env.BOT_UA_EXTRA || '',
  };
}

function hitResponse() {
  return new Response(JSON.stringify({ hit: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parseExtraBotTokens(extra) {
  if (!extra?.trim()) {
    return [];
  }
  return extra.split('!').map((t) => t.trim()).filter(Boolean);
}

function matchesKnownBotToken(ua, extraTokens) {
  const lower = ua.toLowerCase();
  for (const token of BOT_UA_TOKENS) {
    if (lower.includes(token.toLowerCase())) {
      return true;
    }
  }
  for (const token of extraTokens) {
    if (lower.includes(token.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function looksLikeBrowser(ua) {
  return BROWSER_FINGERPRINT.test(ua) && BROWSER_VERSION.test(ua);
}

function matchesAutomation(ua) {
  return AUTOMATION_UA_PATTERNS.some((pattern) => pattern.test(ua));
}

function matchesGenericBotName(ua) {
  return GENERIC_BOT_NAME.test(ua);
}

function isBotOrAi(userAgent, env) {
  const ua = userAgent ?? '';

  if (ua.length < 10) {
    return true;
  }

  const extraTokens = parseExtraBotTokens(env.BOT_UA_EXTRA);
  if (matchesKnownBotToken(ua, extraTokens)) {
    return true;
  }

  if (looksLikeBrowser(ua)) {
    return false;
  }

  if (matchesAutomation(ua)) {
    return true;
  }

  if (matchesGenericBotName(ua)) {
    return true;
  }

  return false;
}

function parseListedDomain(entry) {
  let listedDomain = entry.trim().toLowerCase();
  listedDomain = listedDomain.replace(/[@#$%&\[\]{}]/g, '');
  listedDomain = listedDomain.replace('^', '.com');
  return listedDomain;
}

function parseWhitelist(text) {
  const hostnames = new Set();
  for (const entry of text.split('!')) {
    const hostname = parseListedDomain(entry);
    if (hostname) {
      hostnames.add(hostname);
    }
  }
  return hostnames;
}

function domainMatchesListed(domain, listedDomain) {
  const dotDomain = `.${listedDomain}`;
  const idx = domain.indexOf(dotDomain);
  return (
    domain === listedDomain ||
    (idx > -1 && idx + listedDomain.length + 1 === domain.length)
  );
}

function domainCandidates(hostname) {
  const domain = hostname.toLowerCase();
  if (domain.startsWith('www.')) {
    return [domain, domain.slice(4)];
  }
  return [domain];
}

function isWhitelisted(hostname, whitelist) {
  for (const domain of domainCandidates(hostname)) {
    for (const listedDomain of whitelist) {
      if (domainMatchesListed(domain, listedDomain)) {
        return true;
      }
    }
  }
  return false;
}

function resolveInstanceId(rawInstance) {
  const trimmed = rawInstance?.trim();
  if (!trimmed || /[|&=#]/.test(trimmed)) {
    return DEFAULT_INSTANCE;
  }
  return `ex_${trimmed}`;
}

function extractHostname(encodedUrl) {
  try {
    const decoded = decodeURIComponent(encodedUrl);
    const normalized = /^https?:\/\//i.test(decoded) ? decoded : `https://${decoded}`;
    return new URL(normalized).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export async function refreshWhitelist() {
  const env = getEnv();
  const response = await fetch(env.WHITELIST_URL);
  if (!response.ok) {
    throw new Error(`Whitelist fetch failed: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  whitelistSet = parseWhitelist(text);
}

function ensureWhitelist() {
  if (!refreshPromise) {
    refreshPromise = refreshWhitelist().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export default {
  async fetch(request) {
    const env = getEnv();

    if (isBotOrAi(request.headers.get('User-Agent'), env)) {
      return hitResponse();
    }

    if (whitelistSet.size === 0) {
      await ensureWhitelist();
    }

    const { searchParams } = new URL(request.url);
    const encodedUrl = searchParams.get('u');

    if (!encodedUrl) {
      return new Response(JSON.stringify({ error: 'missing u parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const hostname = extractHostname(encodedUrl);
    if (!hostname) {
      return new Response(JSON.stringify({ error: 'invalid url' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (isWhitelisted(hostname, whitelistSet)) {
      const instanceId = resolveInstanceId(searchParams.get('i'));
      const redirectTarget =
        `https://www.trendupdeal.com/redirect.php?ver=ex-0.3|${instanceId}&url=${encodedUrl}`;
      return Response.redirect(redirectTarget, 302);
    }

    return hitResponse();
  },
};
