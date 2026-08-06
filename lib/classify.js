// classify.js
// Turns a request into a set of SIGNAL FLAGS (what the tracker learned) and,
// at aggregate time, a re-identifiability estimate.
//
// DESIGN RULE, on purpose: we detect signal *types* and throw the raw values
// away. We never store your cookie value, your ID, or the page URL. Storing that
// would make this privacy tool the richest tracking database on your machine —
// the exact thing it's built to expose. So: classify, then forget. This is the
// same data-minimization move as keeping security off the hot path: capture the
// finding, not the payload.
//
// The re-id number is an ESTIMATE, and labeled as one everywhere it shows. It
// uses rough per-signal entropy (EFF Panopticlick-style). It is directional, not
// a promise.

// Rough entropy (bits) each passive signal contributes to a browser fingerprint.
export const ENTROPY = { ua: 10.0, screen: 4.83, tz: 3.04, lang: 2.0, referrer: 2.0, geo: 20.0 };

// Human labels + whether the signal is an identity signal (adds to re-id) or a
// privacy signal (reveals something, but isn't about uniqueness).
export const SIGNAL_META = {
  id:       { label: "Durable ID \u2014 they can tag you",   kind: "identity", weight: 5 },
  geo:      { label: "Approximate location",                kind: "identity", weight: 4 },
  ua:       { label: "Device & browser",                    kind: "identity", weight: 2 },
  screen:   { label: "Screen size",                         kind: "identity", weight: 2 },
  tz:       { label: "Time zone",                           kind: "identity", weight: 2 },
  lang:     { label: "Language",                            kind: "identity", weight: 1 },
  page:     { label: "The page you were reading",           kind: "privacy",  weight: 4 },
  referrer: { label: "Where you came from",                 kind: "privacy",  weight: 3 },
  consent:  { label: "Your consent string",                 kind: "privacy",  weight: 1 }
};

const ID_PARAMS = new Set([
  "uid","uuid","userid","user_id","tid","cid","gid","did","duid","vid","visitorid",
  "uid2","fbp","_fbp","fbc","_fbc","ga","_ga","gclid","dclid","ljt_readerid","idfa","aaid","ifa"
]);
const SCREEN_PARAMS = new Set(["sw","sh","w","h","res","screen","sr","vp","scr","width","height"]);
const TZ_PARAMS = new Set(["tz","timezone","tzoffset","tz_offset","gmt"]);
const LANG_PARAMS = new Set(["lang","language","hl","locale","lg"]);
const CONSENT_PARAMS = new Set(["gdpr","gdpr_consent","us_privacy","usprivacy","gpp","gpp_sid","consent","cmp"]);
const PAGE_PARAMS = new Set(["url","u","ref","referrer","referer","page","loc","dl","dr","cur_url","location"]);
const GEO_PARAMS = new Set(["lat","lon","lng","latitude","longitude","geo","gps"]);
const KNOWN_ID_COOKIES = new Set(["_ga","_gid","_fbp","_fbc","fr","uid","uuid","idfa","personalization_id","ljt_readerid"]);

function shannonBits(s) {
  const freq = {};
  for (const ch of s) freq[ch] = (freq[ch] || 0) + 1;
  let h = 0;
  for (const k in freq) { const p = freq[k] / s.length; h -= p * Math.log2(p); }
  return h; // bits per char
}

export function looksLikeId(v) {
  if (!v || v.length < 12) return false;
  if (/^[0-9]+$/.test(v) && v.length < 15) return false; // short numbers = not an ID
  if (/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(v)) return true; // uuid
  if (/^[0-9a-f]{16,}$/i.test(v)) return true;          // long hex
  if (/^[A-Za-z0-9_\-+/]{20,}={0,2}$/.test(v) && shannonBits(v) >= 3.2) return true; // base64-ish, high entropy
  return v.length >= 16 && shannonBits(v) >= 3.5;
}

function paramToSignal(key, value) {
  const k = key.toLowerCase();
  if (ID_PARAMS.has(k) || looksLikeId(value)) return "id";
  if (SCREEN_PARAMS.has(k)) return "screen";
  if (TZ_PARAMS.has(k)) return "tz";
  if (LANG_PARAMS.has(k)) return "lang";
  if (CONSENT_PARAMS.has(k)) return "consent";
  if (GEO_PARAMS.has(k)) return "geo";
  if (PAGE_PARAMS.has(k) && /https?%3|https?:|\.[a-z]{2,}/i.test(value || "")) return "page";
  return null;
}

// --- public: extract signal flags from the pieces of one request ---

export function signalsFromUrl(url) {
  const out = new Set();
  let u;
  try { u = new URL(url); } catch { return out; }
  u.searchParams.forEach((value, key) => {
    const s = paramToSignal(key, value);
    if (s) out.add(s);
  });
  return out;
}

export function signalsFromHeaders(headers) {
  const out = new Set();
  if (!headers) return out;
  for (const h of headers) {
    const name = (h.name || "").toLowerCase();
    const val = h.value || "";
    if (name === "user-agent") out.add("ua");
    else if (name === "accept-language") out.add("lang");
    else if (name === "referer") { out.add("referrer"); out.add("page"); }
    else if (name === "cookie") {
      for (const part of val.split(/;\s*/)) {
        const eq = part.indexOf("=");
        if (eq < 0) continue;
        const cname = part.slice(0, eq);
        const cval = part.slice(eq + 1);
        if (KNOWN_ID_COOKIES.has(cname) || looksLikeId(cval)) { out.add("id"); break; }
      }
    }
  }
  return out;
}

export function signalsFromBody(requestBody) {
  const out = new Set();
  if (!requestBody) return out;
  if (requestBody.formData) {
    for (const key in requestBody.formData) {
      const vals = requestBody.formData[key] || [];
      const s = paramToSignal(key, vals[0]);
      if (s) out.add(s);
    }
  }
  if (requestBody.raw && requestBody.raw[0] && requestBody.raw[0].bytes) {
    try {
      const txt = new TextDecoder("utf-8").decode(requestBody.raw[0].bytes).slice(0, 4000);
      // urlencoded pairs
      for (const pair of txt.split(/[&\n]/)) {
        const eq = pair.indexOf("=");
        if (eq > 0) { const s = paramToSignal(pair.slice(0, eq), decodeURIComponent(pair.slice(eq + 1))); if (s) out.add(s); }
      }
      // JSON-ish keys
      const m = txt.match(/"([a-z_]+)"\s*:\s*"([^"]{6,})"/gi) || [];
      for (const kv of m) {
        const mm = kv.match(/"([a-z_]+)"\s*:\s*"([^"]+)"/i);
        if (mm) { const s = paramToSignal(mm[1], mm[2]); if (s) out.add(s); }
      }
    } catch { /* opaque / binary body -> we simply learn nothing, honestly */ }
  }
  return out;
}

// merge helper: OR signal-set b into flags object a
export function mergeSignals(a, set) {
  for (const s of set) a[s] = true;
  return a;
}

// --- public: aggregate re-id estimate for a set of signal flags ---
export function reidEstimate(flags) {
  const hasId = !!flags.id;
  let bits = 0;
  for (const k in flags) if (flags[k] && ENTROPY[k]) bits += ENTROPY[k];
  const oneInN = Math.min(Math.round(Math.pow(2, bits)), 8.1e9);
  return { hasId, bits: Math.round(bits * 10) / 10, oneInN };
}

export function formatOneIn(n) {
  if (n >= 1e9) return "1 in billions";
  if (n >= 1e6) return "1 in ~" + (n / 1e6).toFixed(1).replace(/\.0$/, "") + " million";
  if (n >= 1e3) return "1 in ~" + Math.round(n / 1e3) + "k";
  return "1 in ~" + n;
}
