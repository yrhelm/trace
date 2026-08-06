// optout.js
// Turns "here's who watched you" into "here's how to push back."
//
// HONEST FRAMING baked in: this extension cannot delete anything or force a
// company to act. It can (a) point you at the mechanisms that actually have
// teeth, and (b) draft the request for you. Each option below is tagged with how
// much weight it really carries, because "opt out" ranges from legally binding to
// friction-laden theater.
//
// Maintenance note: deep-links and the law change. The NAI's cookie/email opt-out
// tool shut down in Sept 2025, for example. Curated portals are a data-freshness
// surface — same lesson as the tracker list: only as good as its upkeep. Anything
// not curated falls back to a search link, so we never ship a dead button.

// Cross-industry / universal opt-out hubs, best-first. (GPC is handled as a live
// in-extension control in the prevention section, not just a link.)
export const UNIVERSAL = [
  {
    id: "daa",
    title: "Opt out across the industry (DAA WebChoices)",
    teeth: "industry self-regulation",
    url: "https://optout.aboutads.info/",
    blurb: "Opts you out of interest-based advertising from hundreds of participating companies at once, including cookie and newer non-cookie IDs. Self-regulatory, not law \u2014 but it's the widest single lever, and many of the companies below honor it."
  },
  {
    id: "eu",
    title: "Europe: Your Online Choices",
    teeth: "for EU/EEA users",
    url: "https://www.youronlinechoices.com/",
    blurb: "The EU equivalent opt-out hub. If you're in the EU/UK, your GDPR erasure and access rights are stronger \u2014 the per-company request below is your real weapon."
  },
  {
    id: "ca",
    title: "Canada: AdChoices",
    teeth: "for Canadian users",
    url: "https://youradchoices.ca/choices",
    blurb: "The Canadian industry opt-out hub."
  }
];

// Curated per-company portals. Verified or high-confidence entry points only.
// Everything else uses the search fallback so no link is ever dead.
const PORTALS = {
  "The Trade Desk": { url: "https://www.adsrvr.org/", email: "privacy@thetradedesk.com",
    note: "Their opt-out is stored as a cookie \u2014 clearing cookies deletes the opt-out too. Email is the route for actual deletion." },
  "Google":  { url: "https://myadcenter.google.com/", note: "My Ad Center controls ad personalization; use myaccount.google.com/data-and-privacy for access/deletion." },
  "Meta":    { url: "https://www.facebook.com/off_facebook_activity", note: "Off-Facebook Activity shows and clears exactly this cross-site tracking." },
  "Amazon":  { url: "https://www.amazon.com/adprefs" },
  "Criteo":  { url: "https://www.criteo.com/privacy/" },
  "Xandr (Microsoft)": { url: "https://www.xandr.com/privacy/platform-privacy-policy/" },
  "Microsoft": { url: "https://account.microsoft.com/privacy" },
  "LinkedIn": { url: "https://www.linkedin.com/mypreferences/d/categories/privacy" },
  "Adobe":   { url: "https://www.adobe.com/privacy/opt-out.html" },
  "Oracle BlueKai": { url: "https://datacloudoptout.oracle.com/" },
  "LiveRamp": { url: "https://liveramp.com/opt_out/", email: "privacy@liveramp.com" },
  "Taboola": { url: "https://www.taboola.com/policies/opt-out" },
  "Outbrain": { url: "https://my.outbrain.com/recommendations-settings/home" },
  "X (Twitter)": { url: "https://x.com/settings/your_twitter_data" },
  "TikTok":  { url: "https://www.tiktok.com/legal/report/privacy" },
  "Comscore": { url: "https://www.comscore.com/About/Privacy-Policy" }
};

export function portalFor(org) {
  const hit = PORTALS[org];
  if (hit) return { org, ...hit, curated: true };
  return {
    org,
    url: "https://www.google.com/search?q=" + encodeURIComponent(org + " opt out delete my personal data privacy request"),
    curated: false,
    note: "No verified portal on file \u2014 this searches for their data-request page. The drafted request works by email or in their web form."
  };
}

// Draft an access + opt-out + erasure request. Jurisdiction-flexible on purpose:
// it cites the major regimes and lets the recipient apply what fits.
export function buildRequest(org, signals) {
  const subject = "Data access, opt-out, and erasure request";
  const idLine = signals && signals.id
    ? "\nYour records for me likely include a persistent advertising identifier (a cookie ID, device ID, or hashed identifier), which your systems set or received while I browsed. Please include that identifier and any profile linked to it.\n"
    : "";
  const body =
"To the Privacy / Data Protection team at " + org + ",\n\n" +
"I am an individual whose personal data your company has processed through online advertising technology. I am exercising my data-protection rights.\n" +
idLine +
"\nI request that you:\n" +
"1. Confirm whether you hold personal data about me, my browser, or my device.\n" +
"2. Provide access to that data (right of access).\n" +
"3. Delete it and stop further processing (right to erasure / deletion).\n" +
"4. Opt me out of the sale or sharing of my personal data and of targeted, cross-context behavioral advertising.\n\n" +
"I make this request under the privacy laws that apply to me, which may include the EU/UK GDPR (Articles 15 and 17), the California Consumer Privacy Act as amended by the CPRA, and equivalent US state privacy laws.\n\n" +
"If you need information to locate my records, tell me precisely what you require. The absence of an account or login is not a lawful basis to refuse. Please respond within the statutory timeframe (generally 30\u201345 days).\n\n" +
"[ Your name ]\n[ Your email \u2014 and any identifiers you choose to share ]";
  return { subject, body };
}
