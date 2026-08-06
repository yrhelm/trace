// domains.js
// Two jobs:
//   1) getDomain(hostname) -> registrable domain (eTLD+1), so "a.b.tracker.co.uk" -> "tracker.co.uk"
//   2) classify(domain)    -> { org, category }, a friendly label for the story
//
// HONEST LIMITS (read before you trust this):
//   - getDomain uses a small hand-rolled public-suffix set, not the full Public
//     Suffix List. It's right for the common cases and wrong for exotic TLDs.
//     The correct upgrade is to bundle the real PSL. Flagged, not hidden.
//   - classify() is only as good as the SEED list below. That's the same lesson
//     as the fraud pipeline: detection is only as good as its data. The upgrade
//     path is to fold in a public tracker list (DuckDuckGo Tracker Radar,
//     EasyPrivacy). For v1 the seed covers the players you'll actually see.

// Multi-label public suffixes we care about. Everything else -> last 2 labels.
const MULTI_SUFFIXES = new Set([
  "co.uk", "org.uk", "gov.uk", "ac.uk", "co.jp", "co.kr", "co.in", "co.nz",
  "co.za", "com.au", "net.au", "org.au", "com.br", "com.mx", "com.sg",
  "com.hk", "com.tw", "com.cn", "com.tr", "com.ar", "com.pl"
]);

export function getDomain(hostname) {
  if (!hostname) return null;
  hostname = hostname.toLowerCase().replace(/\.$/, "");
  // IP address? just return it as-is.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return hostname;
  const parts = hostname.split(".");
  if (parts.length <= 2) return hostname;
  const lastTwo = parts.slice(-2).join(".");
  const lastThree = parts.slice(-3).join(".");
  if (MULTI_SUFFIXES.has(lastTwo)) return lastThree;
  return lastTwo;
}

export function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// domain (eTLD+1) -> { org, category }
// category drives color: "ad" | "analytics" | "social" | "cdn" | "other"
const SEED = {
  // Google
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
  // Meta
  "facebook.com": ["Meta", "social"],
  "facebook.net": ["Meta", "social"],
  "fbcdn.net": ["Meta", "social"],
  "instagram.com": ["Meta", "social"],
  // Amazon
  "amazon-adsystem.com": ["Amazon", "ad"],
  "amazonaws.com": ["Amazon", "cdn"],
  "media-amazon.com": ["Amazon", "cdn"],
  // The Trade Desk (say hi)
  "adsrvr.org": ["The Trade Desk", "ad"],
  // Criteo
  "criteo.com": ["Criteo", "ad"],
  "criteo.net": ["Criteo", "ad"],
  // Microsoft / Xandr
  "adnxs.com": ["Xandr (Microsoft)", "ad"],
  "bing.com": ["Microsoft", "analytics"],
  "clarity.ms": ["Microsoft Clarity", "analytics"],
  "licdn.com": ["LinkedIn", "social"],
  "linkedin.com": ["LinkedIn", "social"],
  // SSPs / exchanges
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
  // Content recommendation
  "taboola.com": ["Taboola", "ad"],
  "outbrain.com": ["Outbrain", "ad"],
  // Analytics / measurement
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
  // Social / other
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
  // ID / data
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

export function classify(domain) {
  if (!domain) return { org: "unknown", category: "other" };
  const hit = SEED[domain];
  if (hit) return { org: hit[0], category: hit[1] };
  return { org: domain, category: "other" };
}
