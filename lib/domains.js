// domains.js
// Two jobs:
//   1) getDomain(hostname) -> registrable domain (eTLD+1)
//   2) classify(domain)    -> { org, category, fingerprinting }
//
// v0.8 change: attribution is now backed by DuckDuckGo Tracker Radar
// (data/trackers.json, ~24k domains) loaded at startup, with the curated SEED
// below taking precedence. This fixes the old "only as good as the seed" limit:
// e.g. hsadspixel.net now resolves to HubSpot instead of falling through.
//
// REMAINING HONEST LIMIT: getDomain still uses a small hand-rolled public-suffix
// set, not the full Public Suffix List. Right for common cases, wrong for exotic
// TLDs. Upgrade path: bundle the real PSL.

const MULTI_SUFFIXES = new Set([
  "co.uk", "org.uk", "gov.uk", "ac.uk", "co.jp", "co.kr", "co.in", "co.nz",
  "co.za", "com.au", "net.au", "org.au", "com.br", "com.mx", "com.sg",
  "com.hk", "com.tw", "com.cn", "com.tr", "com.ar", "com.pl"
]);

export function getDomain(hostname) {
  if (!hostname) return null;
  hostname = hostname.toLowerCase().replace(/\.$/, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return hostname;
  const parts = hostname.split(".");
  if (parts.length <= 2) return hostname;
  const lastTwo = parts.slice(-2).join(".");
  const lastThree = parts.slice(-3).join(".");
  if (MULTI_SUFFIXES.has(lastTwo)) return lastThree;
  return lastTwo;
}

export function hostnameFromUrl(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

// Curated overrides — these win over Tracker Radar for wording/edge cases.
const SEED = {
  "google.com": ["Google", "ad"],
  "doubleclick.net": ["Google", "ad"],
  "googlesyndication.com": ["Google", "ad"],
  "googleadservices.com": ["Google", "ad"],
  "googletagmanager.com": ["Google", "analytics"],
  "googletagservices.com": ["Google", "ad"],
  "google-analytics.com": ["Google", "analytics"],
  "2mdn.net": ["Google", "ad"],
  "gstatic.com": ["Google", "cdn"],
  "app-measurement.com": ["Google", "analytics"],
  "facebook.com": ["Meta", "social"],
  "facebook.net": ["Meta", "social"],
  "fbcdn.net": ["Meta", "social"],
  "instagram.com": ["Meta", "social"],
  "amazon-adsystem.com": ["Amazon", "ad"],
  "amazonaws.com": ["Amazon", "cdn"],
  "media-amazon.com": ["Amazon", "cdn"],
  "adsrvr.org": ["The Trade Desk", "ad"],
  "criteo.com": ["Criteo", "ad"],
  "criteo.net": ["Criteo", "ad"],
  "adnxs.com": ["Xandr (Microsoft)", "ad"],
  "bing.com": ["Microsoft", "analytics"],
  "clarity.ms": ["Microsoft Clarity", "analytics"],
  "licdn.com": ["LinkedIn", "social"],
  "linkedin.com": ["LinkedIn", "social"],
  "pubmatic.com": ["PubMatic", "ad"],
  "rubiconproject.com": ["Magnite", "ad"],
  "casalemedia.com": ["Index Exchange", "ad"],
  "indexww.com": ["Index Exchange", "ad"],
  "openx.net": ["OpenX", "ad"],
  "smartadserver.com": ["Equativ", "ad"],
  "3lift.com": ["TripleLift", "ad"],
  "sharethrough.com": ["Sharethrough", "ad"],
  "sonobi.com": ["Sonobi", "ad"],
  "yieldmo.com": ["Yieldmo", "ad"],
  "taboola.com": ["Taboola", "ad"],
  "outbrain.com": ["Outbrain", "ad"],
  "scorecardresearch.com": ["Comscore", "analytics"],
  "quantserve.com": ["Quantcast", "analytics"],
  "hotjar.com": ["Hotjar", "analytics"],
  "segment.com": ["Segment", "analytics"],
  "segment.io": ["Segment", "analytics"],
  "mixpanel.com": ["Mixpanel", "analytics"],
  "amplitude.com": ["Amplitude", "analytics"],
  "chartbeat.com": ["Chartbeat", "analytics"],
  "newrelic.com": ["New Relic", "analytics"],
  "branch.io": ["Branch", "analytics"],
  "adobedtm.com": ["Adobe", "analytics"],
  "demdex.net": ["Adobe Audience Manager", "ad"],
  "omtrdc.net": ["Adobe Analytics", "analytics"],
  "twitter.com": ["X (Twitter)", "social"],
  "x.com": ["X (Twitter)", "social"],
  "t.co": ["X (Twitter)", "social"],
  "tiktok.com": ["TikTok", "social"],
  "ttwstatic.com": ["TikTok", "social"],
  "snapchat.com": ["Snap", "social"],
  "sc-static.net": ["Snap", "social"],
  "pinterest.com": ["Pinterest", "social"],
  "pinimg.com": ["Pinterest", "social"],
  "reddit.com": ["Reddit", "social"],
  "redditstatic.com": ["Reddit", "social"],
  "liveramp.com": ["LiveRamp", "ad"],
  "rlcdn.com": ["LiveRamp", "ad"],
  "bluekai.com": ["Oracle BlueKai", "ad"],
  "agkn.com": ["Neustar", "ad"],
  "crwdcntrl.net": ["Lotame", "ad"],
  "id5-sync.com": ["ID5", "ad"],
  "yahoo.com": ["Yahoo", "ad"],
  "cloudflare.com": ["Cloudflare", "cdn"],
  "cloudfront.net": ["Amazon CloudFront", "cdn"],
  "akamaihd.net": ["Akamai", "cdn"],
  "jsdelivr.net": ["jsDelivr", "cdn"],
  "cookielaw.org": ["OneTrust", "other"],
  "onetrust.com": ["OneTrust", "other"]
};

// Tracker Radar map, loaded once at startup. Shape: { domain: [org, cat, fp?] }.
let RADAR = null;

export async function loadTrackerData() {
  if (RADAR) return RADAR;
  try {
    const url = chrome.runtime.getURL("data/trackers.json");
    const data = await (await fetch(url)).json();
    RADAR = data.map || data; // tolerate {map:{...}} or a bare map
  } catch (e) {
    RADAR = {}; // fall back to SEED-only if the file is missing
  }
  return RADAR;
}

// domain (eTLD+1) -> { org, category, fingerprinting }
//
// SEED wins on wording (org + category); the fingerprinting bit always comes
// from Radar. Keeping them separate matters: nearly every SEED domain is also
// in Radar with fp=1, so letting SEED answer that question too would blank the
// flag on exactly the biggest trackers (doubleclick, criteo, facebook...).
export function classify(domain) {
  if (!domain) return { org: "unknown", category: "other", fingerprinting: false };
  const r = RADAR && RADAR[domain];
  const fingerprinting = !!(r && r[2] === 1);
  const seed = SEED[domain];
  if (seed) return { org: seed[0], category: seed[1], fingerprinting };
  if (r) return { org: r[0], category: r[1], fingerprinting };
  return { org: domain, category: "other", fingerprinting: false };
}
