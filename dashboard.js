// dashboard.js (module) — reads the local log and tells the story.
// No network. Pure read of chrome.storage.local + render.
import { reidEstimate, formatOneIn, SIGNAL_META } from "./lib/classify.js";
import { UNIVERSAL, portalFor, buildRequest } from "./lib/optout.js";

const CATS = { ad: "ad network", analytics: "analytics", social: "social", cdn: "infrastructure", other: "other" };

function load() {
  chrome.storage.local.get({ visits: [], edges: {} }, (store) => {
    render(store.visits, Object.values(store.edges));
  });
}
const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDay = (ts) => new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

// Fingerprinting flag rides on the edge (set in background.js from Tracker
// Radar, which scores each domain 0-3 on how likely its scripts are probing
// browser APIs to identify you). We badge 2 and 3 only — see FP_THRESHOLD in
// lib/domains.js for why. `domains` is Map(trackerDomain -> score).
function fpBadge(domains) {
  if (!domains || !domains.size) return "";
  const list = [...domains.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([d, score]) => d + " (" + score + "/3)").join(", ");
  return '<span class="fp-badge" title="Probes your browser for a fingerprint — no cookie to clear. ' +
    'Tracker Radar likelihood: ' + esc(list) + '">fingerprints</span>';
}

/* ---------- Time to First Stranger ----------------------------------------
   For each visit: how long from page open until the first request to a
   third-party org that isn't infrastructure and that carried a durable ID.
   Pure reduction over flags and timestamps already in the graph — no new
   fields, no engine change.

   Three honest limits, all surfaced in the UI:
   1. edge.ts is first contact with that tracker on that visit; the `id` flag
      is OR'd across every request in that pairing. So the timestamp can
      slightly precede the request that actually carried the ID.
   2. A request firing is exposure, not proof the ID was received and logged.
   3. Synthetic visits (worker restarted, page-open time unknown — see
      resolveVisit in background.js) are excluded rather than guessed at.  */

const isSyntheticVisit = (id) => String(id).includes("@synth@");

// Heuristic for criterion (a), "not the first party". The engine already drops
// same-domain requests, but licdn.com on linkedin.com is still LinkedIn — not a
// stranger. Compares org name against the site's registrable name; conservative
// by design (msn.com vs Microsoft stays a stranger).
const normName = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
function sameParty(org, siteDomain) {
  const a = normName(org);
  const b = normName(String(siteDomain).split(".").slice(0, -1).join(""));
  if (!a || !b) return false;
  if (a === b) return true;
  return a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a));
}

function qualifies(e, siteDomain) {
  return !!(e.signals && e.signals.id) &&      // (c) carried a durable ID
    e.category !== "cdn" &&                    // (b) not known infrastructure
    !sameParty(e.org, siteDomain);             // (a) not the first party
}

function computeStrangers(visits, edges) {
  const byVisit = new Map();
  for (const e of edges) {
    if (!byVisit.has(e.visitId)) byVisit.set(e.visitId, []);
    byVisit.get(e.visitId).push(e);
  }

  const measured = [];   // visits we could time
  let skipped = 0;       // synthetic visits, excluded
  let noStranger = 0;    // measured, but nothing qualified

  for (const v of visits) {
    if (isSyntheticVisit(v.id)) { skipped++; continue; }
    const hits = (byVisit.get(v.id) || []).filter((e) => qualifies(e, v.domain));
    if (!hits.length) { noStranger++; measured.push({ visit: v, seconds: null }); continue; }
    const first = hits.reduce((a, b) => (b.ts < a.ts ? b : a));
    measured.push({
      visit: v,
      seconds: Math.max(0, (first.ts - v.ts) / 1000),   // clamp: in-flight requests can predate commit
      org: first.org,
      trackerDomain: first.trackerDomain
    });
  }

  const timed = measured.filter((m) => m.seconds !== null).sort((a, b) => a.seconds - b.seconds);
  const median = timed.length
    ? (timed.length % 2 ? timed[(timed.length - 1) / 2].seconds
      : (timed[timed.length / 2 - 1].seconds + timed[timed.length / 2].seconds) / 2)
    : null;

  // leaderboard is per site, keeping that site's fastest exposure
  const bySite = new Map();
  for (const m of timed) {
    const prev = bySite.get(m.visit.domain);
    if (!prev || m.seconds < prev.seconds) bySite.set(m.visit.domain, m);
  }

  return {
    measured, timed, median, noStranger, skipped,
    sites: [...bySite.values()].sort((a, b) => a.seconds - b.seconds)
  };
}

const fmtSecs = (s) => (s < 10 ? s.toFixed(1) : Math.round(s).toString()) + "s";

function renderStrangers(st) {
  const host = document.getElementById("tts");
  if (!host) return;

  const method =
    '<details class="tts-method"><summary>How this is measured</summary>' +
    "<p><b>Time to first ID-bearing request to a third-party org.</b> The clock starts when the " +
    "page commits and stops at the first request to a company that (1) isn’t the site you " +
    "opened, (2) isn’t classified as infrastructure/CDN, and (3) carried a durable ID — the " +
    "<code>id</code> flag from <code>lib/classify.js</code>.</p>" +
    "<p>A request firing means the ID was <em>sent</em>. It doesn’t confirm the receiving server " +
    "logged it or tied it to a profile. Treat this as exposure, not proof of collection.</p>" +
    "<p>The timestamp is first contact with that tracker on that visit, and the ID flag is pooled " +
    "across every request to it — so the true ID-bearing request can be marginally later than " +
    "the time shown." +
    (st.skipped ? " " + st.skipped + " visit" + (st.skipped === 1 ? " was" : "s were") +
      " left out: the service worker had restarted, so the page-open time wasn’t known." : "") +
    "</p></details>";

  if (!st.timed.length) {
    host.innerHTML = '<div class="tts-card"><p class="tts-big none">No stranger yet</p>' +
      '<p class="tts-sub">Across ' + st.measured.length + " measured visit" + (st.measured.length === 1 ? "" : "s") +
      ", no third-party company outside infrastructure carried a durable ID.</p>" + method + "</div>";
    return;
  }

  const fastest = st.timed[0];
  const shown = st.sites.slice(0, 10);
  const rows = shown.map((m, i) =>
    '<li class="tts-row' + (i === 0 ? " lead" : "") + '">' +
      '<span class="tts-rank">' + String(i + 1).padStart(2, "0") + "</span>" +
      '<span class="tts-site">' + esc(m.visit.domain) + "</span>" +
      '<span class="tts-org" title="' + esc(m.trackerDomain) + '">' + esc(m.org) + "</span>" +
      '<span class="tts-secs">' + fmtSecs(m.seconds) + "</span>" +
    "</li>").join("");

  host.innerHTML =
    '<div class="tts-card">' +
      '<div class="tts-top">' +
        '<div class="tts-stat">' +
          '<p class="tts-big">' + fmtSecs(st.median) + "</p>" +
          '<p class="tts-lab" title="Median across visits where an ID-bearing third-party request happened at all.">' +
            "median, across " + st.timed.length + " visit" + (st.timed.length === 1 ? "" : "s") + "</p>" +
        "</div>" +
        '<p class="tts-headline">On <b>' + esc(fastest.visit.domain) + "</b>, " +
          "<b>" + esc(fastest.org) + "</b> had a durable ID on you " +
          '<span class="tts-hot">' + fmtSecs(fastest.seconds) + "</span> after the page opened.</p>" +
      "</div>" +
      '<p class="tts-note">Precisely: time to first ID-bearing request to a third-party org.' +
        (st.noStranger ? " " + st.noStranger + " of " + st.measured.length +
          " measured visits never triggered one." : "") + "</p>" +
      '<ol class="tts-board">' + rows + "</ol>" +
      (st.sites.length > shown.length
        ? '<p class="tts-more">' + (st.sites.length - shown.length) + " more site" +
          (st.sites.length - shown.length === 1 ? "" : "s") + " ranked below these.</p>"
        : "") +
      method +
    "</div>";
}

/* ---------- Who can compare notes -----------------------------------------
   The report so far counts watchers one at a time. That undersells it: your
   profile isn't 47 separate slivers. Any two companies that each held a
   durable ID on you on the SAME page are one handshake away from merging what
   they saw — that's the technical precondition for profile stitching.

   Same qualifying test as Time to First Stranger (durable ID, not
   infrastructure, not the first party), so the two sections agree on who
   counts. Co-occurrence is opportunity, NOT evidence of a transaction — said
   plainly in the UI, because the honest version is damning enough.  */

function computeCorrelation(visits, edges) {
  const edgesByVisit = new Map();
  for (const e of edges) {
    if (!edgesByVisit.has(e.visitId)) edgesByVisit.set(e.visitId, []);
    edgesByVisit.get(e.visitId).push(e);
  }

  const pairs = new Map();          // "a␟b" -> { a, b, sites:Set, visits:number }
  const orgSites = new Map();       // org -> Set(site) where it held an ID
  let widest = null;                // the single visit with the most ID-holders

  for (const v of visits) {
    const here = new Set();
    for (const e of edgesByVisit.get(v.id) || []) if (qualifies(e, v.domain)) here.add(e.org);
    if (!here.size) continue;

    for (const org of here) {
      if (!orgSites.has(org)) orgSites.set(org, new Set());
      orgSites.get(org).add(v.domain);
    }
    if (!widest || here.size > widest.orgs.length) widest = { site: v.domain, ts: v.ts, orgs: [...here] };

    const list = [...here].sort();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const k = list[i] + "␟" + list[j];
        let p = pairs.get(k);
        if (!p) { p = { a: list[i], b: list[j], sites: new Set(), visits: 0 }; pairs.set(k, p); }
        p.sites.add(v.domain);
        p.visits += 1;
      }
    }
  }

  const ranked = [...pairs.values()]
    .sort((x, y) => y.sites.size - x.sites.size || y.visits - x.visits ||
      x.a.localeCompare(x.b) || x.a.localeCompare(y.a));

  // nodes for the arc diagram: the orgs with the most reach, most-connected first
  const degree = new Map();
  for (const p of ranked) {
    degree.set(p.a, (degree.get(p.a) || 0) + p.sites.size);
    degree.set(p.b, (degree.get(p.b) || 0) + p.sites.size);
  }
  const nodes = [...degree.entries()].sort((x, y) => y[1] - x[1]).map(([org]) => org);

  return { pairs: ranked, nodes, orgSites, widest, orgCount: orgSites.size };
}

function renderCorrelation(c) {
  const host = document.getElementById("stitch");
  if (!host) return;

  const method =
    '<details class="tts-method"><summary>What this does and doesn’t show</summary>' +
    "<p><b>Two companies appear together here when each one held a durable ID on you on the " +
    "same page.</b> Same test as the metric above: an <code>id</code> flag, not classified as " +
    "infrastructure, not the site you opened.</p>" +
    "<p><b>This is opportunity, not proof.</b> Co-occurrence means merging their two views of " +
    "you is technically possible — it is the precondition for stitching, and the thing the " +
    "ad-tech industry calls identity resolution. It is <em>not</em> evidence that these two " +
    "companies exchanged anything. Real syncing happens server-to-server, where no browser " +
    "extension can see it.</p>" +
    "<p>Trace shows you the doorway, not what walked through it.</p></details>";

  if (!c.pairs.length) {
    host.innerHTML = '<div class="tts-card"><p class="tts-big none">No overlap yet</p>' +
      '<p class="tts-sub">No two companies held a durable ID on you on the same page. That gets ' +
      "rarer the longer you browse.</p>" + method + "</div>";
    return;
  }

  const top = c.pairs[0];
  const shown = c.pairs.slice(0, 8);
  const rows = shown.map((p, i) =>
    '<li class="st-pair' + (i === 0 ? " lead" : "") + '">' +
      '<span class="sp-names"><b>' + esc(p.a) + "</b> <span class=\"sp-amp\">&amp;</span> <b>" + esc(p.b) + "</b></span>" +
      '<span class="sp-sites" title="' + esc([...p.sites].sort().join(", ")) + '">' +
        p.sites.size + (p.sites.size === 1 ? " shared site" : " shared sites") + "</span>" +
    "</li>").join("");

  host.innerHTML =
    '<div class="tts-card">' +
      '<div class="tts-top">' +
        '<div class="tts-stat"><p class="tts-big">' + c.pairs.length + "</p>" +
          '<p class="tts-lab" title="Unordered pairs of companies that each held a durable ID on you on at least one shared page.">' +
          "pairs able to compare notes</p></div>" +
        '<p class="tts-headline"><b>' + esc(top.a) + "</b> and <b>" + esc(top.b) + "</b> both held an ID " +
          "on you across <span class=\"tts-hot\">" + top.sites.size +
          (top.sites.size === 1 ? " site" : " sites") + "</span>. Between them, that’s one profile — not two.</p>" +
      "</div>" +
      (c.widest && c.widest.orgs.length > 1
        ? '<p class="tts-note">Densest single page: <b>' + esc(c.widest.site) + "</b> — " +
          c.widest.orgs.length + " companies each holding an ID on you at the same moment.</p>"
        : "") +
      buildArcs(c) +
      '<ol class="st-pairs">' + rows + "</ol>" +
      (c.pairs.length > shown.length
        ? '<p class="tts-more">' + (c.pairs.length - shown.length) + " further pair" +
          (c.pairs.length - shown.length === 1 ? "" : "s") + " not shown.</p>"
        : "") +
      method +
    "</div>";
}

// arc diagram: orgs on a baseline, an arc for every pair that shares a page.
// Arc weight = shared sites, so the thick arcs are the profiles most worth merging.
function buildArcs(c) {
  const nodes = c.nodes.slice(0, 9);
  if (nodes.length < 2) return "";
  const index = new Map(nodes.map((o, i) => [o, i]));
  const arcs = c.pairs.filter((p) => index.has(p.a) && index.has(p.b));
  if (!arcs.length) return "";

  const W = 880, baseline = 150, pad = 60;
  const step = (W - pad * 2) / Math.max(nodes.length - 1, 1);
  const xFor = (i) => pad + i * step;
  const maxShared = Math.max(...arcs.map((p) => p.sites.size));

  let paths = "";
  for (const p of arcs) {
    const i = index.get(p.a), j = index.get(p.b);
    const x1 = xFor(Math.min(i, j)), x2 = xFor(Math.max(i, j));
    const lift = Math.min(120, (x2 - x1) * 0.55 + 14);
    const strong = p.sites.size === maxShared;
    paths += '<path class="arc' + (strong ? " strong" : "") + '" d="M' + x1.toFixed(1) + " " + baseline +
      " Q " + ((x1 + x2) / 2).toFixed(1) + " " + (baseline - lift).toFixed(1) + " " + x2.toFixed(1) + " " + baseline +
      '" style="stroke-width:' + (0.8 + (p.sites.size / maxShared) * 2.6).toFixed(2) + '">' +
      "<title>" + esc(p.a) + " & " + esc(p.b) + " — both held an ID on you on " + p.sites.size +
      (p.sites.size === 1 ? " site" : " sites") + ": " + esc([...p.sites].sort().join(", ")) + "</title></path>";
  }

  let dots = "";
  nodes.forEach((org, i) => {
    const x = xFor(i), sites = c.orgSites.get(org);
    dots += '<circle class="arc-node" cx="' + x.toFixed(1) + '" cy="' + baseline + '" r="4.5">' +
      "<title>" + esc(org) + " — held an ID on you on " + sites.size +
      (sites.size === 1 ? " site" : " sites") + "</title></circle>" +
      '<text class="arc-label" x="' + x.toFixed(1) + '" y="' + (baseline + 16) +
      '" transform="rotate(32 ' + x.toFixed(1) + " " + (baseline + 16) + ')">' +
      esc(org.length > 18 ? org.slice(0, 17) + "…" : org) + "</text>";
  });

  return '<div class="arc-scroll"><svg class="arcs" viewBox="0 0 ' + W + ' 250" preserveAspectRatio="xMidYMin meet">' +
    '<line class="arc-base" x1="' + pad + '" y1="' + baseline + '" x2="' + (W - pad) + '" y2="' + baseline + '"/>' +
    paths + dots + "</svg></div>";
}

function render(visits, edges) {
  visits.sort((a, b) => a.ts - b.ts);
  if (visits.length === 0 || edges.length === 0) {
    document.querySelector(".wrap").innerHTML =
      '<div class="empty"><h2>Nothing to show yet.</h2>' +
      "<p>Browse a few sites, then open this again. Trace records who watches you as you go.</p></div>";
    return;
  }

  const siteCount = new Set(visits.map((v) => v.domain)).size;

  // aggregate per org: sites, hits, category, signal flags, which visits
  const byOrg = new Map();
  for (const e of edges) {
    let o = byOrg.get(e.org);
    if (!o) { o = { org: e.org, sites: new Set(), hits: 0, category: e.category, signals: {}, visitIds: new Set(), fpDomains: new Map() }; byOrg.set(e.org, o); }
    o.sites.add(e.pageDomain); o.hits += e.count; o.visitIds.add(e.visitId);
    if (e.fingerprinting) o.fpDomains.set(e.trackerDomain, e.fpScore || 2);
    if (e.signals) for (const k in e.signals) if (e.signals[k]) o.signals[k] = true;
  }
  const followers = [...byOrg.values()].sort((a, b) => b.sites.size - a.sites.size || b.hits - a.hits);

  const first = visits[0].ts, last = visits[visits.length - 1].ts;
  document.getElementById("range").textContent =
    fmtDay(first) === fmtDay(last) ? fmtDay(last) : fmtDay(first) + " \u2013 " + fmtDay(last);

  const strangers = computeStrangers(visits, edges);

  renderSummary(followers, siteCount, byOrg.size);
  renderHero(followers[0], siteCount, byOrg.size);
  renderGraph(visits, followers);
  renderStrangers(strangers);
  renderCorrelation(computeCorrelation(visits, edges));
  initChains(followers, edges);
  renderVisits(visits, edges, strangers);
  renderReid(followers);
  renderPrevention();
  renderActions(followers);
  renderWatchers(followers, siteCount);

  document.getElementById("clear").addEventListener("click", () => {
    if (confirm("Erase everything Trace has recorded on this device?"))
      chrome.storage.local.set({ visits: [], edges: {} }, load);
  });
}

/* ---------- executive summary scorecard ---------- */
function renderSummary(followers, siteCount, orgCount) {
  const host = document.getElementById("summary");
  if (!host) return;
  const tagged = followers.filter((f) => f.signals.id).length;
  const scored = followers.map((f) => ({ f, r: reidEstimate(f.signals) }))
    .sort((a, b) => (b.r.hasId - a.r.hasId) || (b.r.bits - a.r.bits));
  const worst = scored[0];
  const top = followers[0];
  const reidVal = worst && worst.r.hasId ? "Identified" : (worst ? formatOneIn(worst.r.oneInN).replace(/^1 in ~?/, "1:") : "\u2014");
  const reidCrit = worst && worst.r.hasId;

  const tile = (val, lab, opts) =>
    '<div class="tile' + (opts && opts.crit ? " crit" : "") + '">' +
    '<div class="t-val' + (opts && opts.mono ? " mono" : opts && opts.text ? "" : " mono") + '">' + val + "</div>" +
    '<div class="t-lab">' + lab + "</div></div>";

  host.innerHTML = '<div class="tiles">' +
    tile(orgCount, "companies observed", { mono: true }) +
    tile(tagged, "with a durable ID", { mono: true, crit: tagged > 0 }) +
    '<div class="tile"><div class="t-val t-sub">' + esc(top ? top.org : "\u2014") + '</div><div class="t-lab">broadest follower' + (top ? " \u00b7 " + top.sites.size + "/" + siteCount + " sites" : "") + "</div></div>" +
    tile(reidVal, "worst re-identifiability", { crit: reidCrit }) +
    "</div>";
}

/* ---------- hero: broadest follower ---------- */
function renderHero(top, siteCount, orgCount) {
  const seen = top.sites.size;
  document.getElementById("hero").innerHTML =
    '<p class="thesis"><b>' + esc(top.org) + "</b> saw you on " +
    '<span class="site-n">' + seen + " of " + siteCount + "</span> sites you visited.</p>" +
    '<p class="thesis-sub">' + orgCount + " companies watched at least once. Here's the one that followed you furthest.</p>" +
    buildHub(top.org, [...top.sites]);
}
function buildHub(org, sites) {
  const W = 880, H = 300, cx = W / 2, cy = H / 2 + 10, R = 120;
  const shown = sites.slice(0, 14);
  let threads = "", nodes = "";
  shown.forEach((site, i) => {
    const ang = (-Math.PI / 2) + (i / shown.length) * Math.PI * 2;
    const x = cx + Math.cos(ang) * R * (W / H) * 0.62;
    const y = cy + Math.sin(ang) * R;
    threads += '<path class="thread" style="animation-delay:' + (i * 0.05).toFixed(2) + 's" d="M' + cx + " " + cy +
      " Q " + ((cx + x) / 2) + " " + ((cy + y) / 2 - 18) + " " + x.toFixed(1) + " " + y.toFixed(1) + '"/>';
    const anchor = x < cx - 20 ? "end" : x > cx + 20 ? "start" : "middle";
    const lx = x + (anchor === "end" ? -8 : anchor === "start" ? 8 : 0);
    nodes += '<circle class="site-node" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3.5"/>' +
      '<text class="site-label" x="' + lx.toFixed(1) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="' + anchor + '">' + esc(site) + "</text>";
  });
  const extra = sites.length > shown.length ? "+" + (sites.length - shown.length) + " more" : "";
  return '<svg class="hub" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="xMidYMid meet">' + threads +
    '<circle class="center-ring" cx="' + cx + '" cy="' + cy + '" r="30"/>' +
    '<circle class="center-node" cx="' + cx + '" cy="' + cy + '" r="6"/>' +
    '<text class="center-label" x="' + cx + '" y="' + (cy + 52) + '">' + esc(org) + "</text>" +
    (extra ? '<text class="site-label" x="' + cx + '" y="' + (cy + 70) + '" text-anchor="middle">' + extra + "</text>" : "") +
    nodes + "</svg>";
}

/* ---------- temporal graph: each watcher a line across your day ---------- */
function renderGraph(visits, followers) {
  const orderedVisits = visits.slice().sort((a, b) => a.ts - b.ts);
  const idx = new Map(orderedVisits.map((v, i) => [v.id, i]));
  const n = orderedVisits.length;

  const gutter = 150, rightPad = 26, laneH = 34, axisH = 28;
  const topPad = 74; // headroom for angled origin labels above the "you" lane
  const step = Math.max(46, Math.min(90, 620 / Math.max(n - 1, 1)));
  const plotW = step * Math.max(n - 1, 1);
  const W = gutter + plotW + rightPad;
  const lanes = followers.slice(0, 6);
  const H = topPad + (lanes.length + 1) * laneH + axisH;
  const xFor = (i) => gutter + i * step;
  const yYou = topPad + laneH / 2;
  const yOrg = (row) => topPad + (row + 1) * laneH + laneH / 2;
  const clip = (s, m) => (s.length > m ? s.slice(0, m - 1) + "\u2026" : s);

  let s = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '">';

  // vertical guide per visit + lane separators
  for (let i = 0; i < n; i++) s += '<line class="g-lane-sep" x1="' + xFor(i) + '" y1="' + (topPad - 6) + '" x2="' + xFor(i) + '" y2="' + (H - axisH) + '"/>';
  for (let r = 0; r <= lanes.length; r++) {
    const y = topPad + r * laneH;
    s += '<line class="g-lane-sep" x1="' + gutter + '" y1="' + y + '" x2="' + (W - rightPad) + '" y2="' + y + '"/>';
  }

  // ORIGIN labels (the site you opened) + YOU lane
  s += '<text class="g-lane-label you" x="' + (gutter - 12) + '" y="' + (yYou + 4) + '">you</text>';
  let youPath = "";
  for (let i = 0; i < n; i++) { youPath += (i ? " L" : "M") + xFor(i) + " " + yYou; }
  s += '<path class="g-you-line" d="' + youPath + '"/>';
  orderedVisits.forEach((v, i) => {
    const lx = xFor(i), ly = topPad - 8;
    s += '<text class="g-origin" x="' + lx + '" y="' + ly + '" text-anchor="end" transform="rotate(-32 ' + lx + " " + ly + ')">' + esc(clip(v.domain, 22)) + "</text>";
    s += '<circle class="g-you-dot" cx="' + lx + '" cy="' + yYou + '" r="4"><title>' + esc(v.domain) + " \u00b7 " + fmtTime(v.ts) + "</title></circle>";
  });

  // ORG lanes
  lanes.forEach((f, row) => {
    const worst = row === 0 ? " worst" : "";
    const y = yOrg(row);
    s += '<text class="g-lane-label" x="' + (gutter - 12) + '" y="' + (y + 4) + '">' + esc(clip(f.org, 18)) + "</text>";
    const cols = [...f.visitIds].map((vid) => idx.get(vid)).filter((i) => i != null).sort((a, b) => a - b);
    if (cols.length > 1) {
      let p = "";
      cols.forEach((i, k) => { p += (k ? " L" : "M") + xFor(i) + " " + y; });
      s += '<path class="g-org-line' + worst + '" style="animation-delay:' + (0.15 * row).toFixed(2) + 's" d="' + p + '"/>';
    }
    cols.forEach((i) => {
      const solo = cols.length === 1 ? " solo" : "";
      s += '<circle class="g-org-dot' + worst + solo + '" cx="' + xFor(i) + '" cy="' + y + '" r="3.6"><title>' +
        esc(f.org) + " watched you on " + esc(orderedVisits[i].domain) + "</title></circle>";
    });
  });

  // time axis
  const thin = n > 12 ? 2 : 1;
  orderedVisits.forEach((v, i) => {
    if (i % thin) return;
    s += '<text class="g-tick" x="' + xFor(i) + '" y="' + (H - 8) + '" text-anchor="middle">' + fmtTime(v.ts) + "</text>";
  });

  s += "</svg>";
  document.getElementById("graph").innerHTML = s;
}

/* ---------- follow one company: the temporal trail for a single org ----------
   Pure query over the edges we already have — (visitId, ts, pageDomain, org).
   One "stop" = one page-visit where any of that org's tracker domains fired,
   timestamped at first contact. No engine changes, no new data stored. */
let CHAINS = new Map();   // org -> ordered [stop]
let CHAIN_ORGS = [];      // orgs, ranked as in the watchers list
let chainOrg = null;

function buildChains(edges) {
  const chains = new Map();
  for (const e of edges) {
    let stops = chains.get(e.org);
    if (!stops) { stops = new Map(); chains.set(e.org, stops); }
    let st = stops.get(e.visitId);
    if (!st) { st = { site: e.pageDomain, ts: e.ts, hits: 0, domains: new Set(), signals: {}, fpDomains: new Map() }; stops.set(e.visitId, st); }
    st.ts = Math.min(st.ts, e.ts);   // first moment this org saw this page-visit
    st.hits += e.count;
    st.domains.add(e.trackerDomain);
    if (e.fingerprinting) st.fpDomains.set(e.trackerDomain, e.fpScore || 2);
    if (e.signals) for (const k in e.signals) if (e.signals[k]) st.signals[k] = true;
  }
  const out = new Map();
  for (const [org, stops] of chains) out.set(org, [...stops.values()].sort((a, b) => a.ts - b.ts));
  return out;
}

function initChains(followers, edges) {
  CHAINS = buildChains(edges);
  CHAIN_ORGS = followers.map((f) => f.org).filter((o) => CHAINS.has(o));
  if (!CHAIN_ORGS.length) { document.getElementById("chain-block").hidden = true; return; }
  showChain(chainOrg && CHAINS.has(chainOrg) ? chainOrg : CHAIN_ORGS[0], false);
}

// selects an org and repaints the picker + trail; scrolls into view when the
// click came from elsewhere on the page.
function showChain(org, scroll) {
  if (!CHAINS.has(org)) return;
  chainOrg = org;

  document.getElementById("chain-picker").innerHTML = CHAIN_ORGS.map((o) => {
    const stops = CHAINS.get(o);
    return '<button type="button" class="chain-pick' + (o === org ? " on" : "") + '" data-chain-org="' + esc(o) + '"' +
      (o === org ? ' aria-current="true"' : "") + ">" + esc(o) +
      '<span class="cp-n">' + stops.length + "</span></button>";
  }).join("");

  renderChain(org, CHAINS.get(org));
  if (scroll) document.getElementById("chain-block").scrollIntoView({ behavior: "smooth", block: "start" });
}

function gapLabel(ms) {
  const sec = Math.round(ms / 1000);
  if (sec < 45) return sec <= 2 ? "moments later" : sec + " sec later";
  const min = Math.round(sec / 60);
  if (min < 60) return min + " min later";
  const hr = Math.floor(min / 60), rem = min % 60;
  if (hr < 24) return hr + "h" + (rem ? " " + rem + "m" : "") + " later";
  const day = Math.round(hr / 24);
  return day + (day === 1 ? " day later" : " days later");
}

function renderChain(org, stops) {
  const sites = new Set(stops.map((s) => s.site));
  const fpAll = new Map();
  const sigAll = {};
  for (const s of stops) {
    for (const [d, score] of s.fpDomains) fpAll.set(d, Math.max(score, fpAll.get(d) || 0));
    for (const k in s.signals) if (s.signals[k]) sigAll[k] = true;
  }
  const first = stops[0].ts, last = stops[stops.length - 1].ts;
  const span = fmtTime(first) + (stops.length > 1 ? " → " + fmtTime(last) : "");

  // the plain-English version of the trail, in the user's own words
  const recap = stops.slice(0, 3).map((s) => esc(s.site) + " at " + fmtTime(s.ts)).join(", ");
  const more = stops.length > 3 ? ", and " + (stops.length - 3) + " more" : "";

  const order = ["id", "geo", "ua", "screen", "tz", "lang", "page", "referrer", "consent"];
  const sigs = order.filter((k) => sigAll[k]).map((k) => {
    const cls = k === "id" ? "id" : (SIGNAL_META[k].kind === "identity" ? "identity" : "");
    return '<span class="sig-chip ' + cls + '">' + SIGNAL_META[k].label + "</span>";
  }).join("");

  let rows = "";
  stops.forEach((s, i) => {
    const prev = i ? stops[i - 1] : null;
    const gap = prev ? '<li class="gap"><span class="gap-tx">' + gapLabel(s.ts - prev.ts) + "</span></li>" : "";
    const dayMark = !prev || !sameDay(prev.ts, s.ts) ? '<span class="st-day">' + fmtDay(s.ts) + "</span>" : "";
    const via = [...s.domains].sort().join(", ");
    rows += gap +
      '<li class="stop' + (i === 0 ? " first" : "") + (i === stops.length - 1 ? " last" : "") + '">' +
        '<span class="st-when"><span class="st-time">' + fmtTime(s.ts) + "</span>" + dayMark + "</span>" +
        '<span class="st-rail"><span class="st-dot' + (s.fpDomains.size ? " fp" : "") + '"></span></span>' +
        '<span class="st-body">' +
          '<span class="st-site">' + esc(s.site) + "</span>" +
          '<span class="st-meta">' + s.hits + (s.hits === 1 ? " request" : " requests") +
            ' · via <span class="st-via">' + esc(via) + "</span></span>" +
        "</span>" +
      "</li>";
  });

  document.getElementById("chain").innerHTML =
    '<div class="chain-card">' +
      '<div class="chain-head">' +
        '<div><span class="ch-org">' + esc(org) + "</span>" + fpBadge(fpAll) + "</div>" +
        '<span class="ch-span mono">' + span + "</span>" +
      "</div>" +
      '<p class="chain-recap">' + esc(org) + " saw you on " + recap + more + ".</p>" +
      '<p class="chain-stat">' + stops.length + (stops.length === 1 ? " stop" : " stops") +
        " across " + sites.size + (sites.size === 1 ? " site" : " sites") +
        (stops.length > 1 ? " · " + gapLabel(last - first).replace(/ later$/, " end to end") : "") + "</p>" +
      (sigs ? '<div class="chain-sigs">' + sigs + "</div>" : "") +
      '<ol class="trail">' + rows + "</ol>" +
    "</div>";
}

/* ---------- re-id: what they figured out ---------- */
function renderReid(followers) {
  const tagged = followers.filter((f) => f.signals.id);
  // worst single company = has-id first, then most fingerprint bits
  const scored = followers.map((f) => ({ f, r: reidEstimate(f.signals) }));
  scored.sort((a, b) => (b.r.hasId - a.r.hasId) || (b.r.bits - a.r.bits));
  const worst = scored[0];

  const lede = document.getElementById("reid-lede");
  if (tagged.length) {
    lede.innerHTML = "<b>" + tagged.length + "</b> " + (tagged.length === 1 ? "company" : "companies") +
      " attached a durable ID to you \u2014 that's a name-tag they recognize across every site. Here's the one that learned the most.";
  } else {
    lede.textContent = "No durable ID caught yet \u2014 but passive signals still narrow down who you are. Here's the most revealing case.";
  }

  const card = document.getElementById("reid");
  const w = worst.r, org = worst.f.org;
  let scoreHtml;
  if (w.hasId) {
    scoreHtml = '<div class="reid-score tagged"><p class="reid-big">Tagged by ' + tagged.length + '</p>' +
      '<p class="reid-who">a durable ID means no guessing \u2014 they know it\'s you</p>' +
      '<p class="reid-method">When a stable identifier rides along, fingerprinting is moot: you\'re recognized by name-tag, not odds. Every site that shares this ID can be stitched into one profile.</p></div>';
  } else {
    scoreHtml = '<div class="reid-score fingerprint"><p class="reid-big">' + formatOneIn(w.oneInN) + '</p>' +
      '<p class="reid-who">how rare ' + esc(org) + " could make your browser</p>" +
      '<p class="reid-method">Rough estimate from the combined entropy of passive signals (\u2248' + w.bits +
      ' bits, EFF-style). Directional, not a promise \u2014 but the more boxes below, the fewer people look like you.</p></div>';
  }

  const meta = SIGNAL_META;
  const order = ["id", "geo", "ua", "screen", "tz", "lang", "page", "referrer", "consent"];
  const rows = order.filter((k) => worst.f.signals[k]).map((k) => {
    const m = meta[k];
    return '<div class="sig ' + m.kind + '"><span class="tick"></span>' +
      '<span class="s-label">' + m.label + "</span>" +
      '<span class="s-kind">' + m.kind + "</span></div>";
  }).join("");

  card.innerHTML = scoreHtml +
    '<div class="reid-detail"><h3>What ' + esc(org) + " collected from you</h3>" +
    '<div class="sig-list">' + (rows || '<div class="sig"><span class="s-label" style="color:var(--ink-dim)">nothing legible \u2014 payload was opaque</span></div>') + "</div></div>";
}

/* ---------- watchers list ---------- */
function renderWatchers(followers, siteCount) {
  document.getElementById("watchers-lede").textContent =
    followers.length + " companies were told where you were \u2014 ranked by how many of your " + siteCount + " sites each one caught.";

  const order = ["id", "geo", "ua", "screen", "tz", "lang", "page", "referrer", "consent"];
  document.getElementById("watchers").innerHTML = followers.map((f, i) => {
    const worst = i === 0 ? " worst" : "";
    const chips = [...f.sites].sort().map((s) => '<span class="chip">' + esc(s) + "</span>").join("");
    const sigs = order.filter((k) => f.signals[k]).map((k) => {
      const cls = k === "id" ? "id" : (SIGNAL_META[k].kind === "identity" ? "identity" : "");
      return '<span class="sig-chip ' + cls + '">' + SIGNAL_META[k].label + "</span>";
    }).join("");
    return '<li><details class="watcher' + worst + '"' + (i === 0 ? " open" : "") + ">" +
      "<summary>" +
      '<span class="rank">' + String(i + 1).padStart(2, "0") + "</span>" +
      '<span><span class="w-name">' + esc(f.org) + '</span><span class="w-cat">' + (CATS[f.category] || f.category) + "</span>" +
      fpBadge(f.fpDomains) + "</span>" +
      '<button type="button" class="chain-btn" data-chain-org="' + esc(f.org) + '">follow chain</button>' +
      '<span class="w-count">' + f.sites.size + '<span class="of"> / ' + siteCount + " sites</span></span>" +
      "</summary>" +
      (sigs ? '<div class="w-signals">' + sigs + "</div>" : "") +
      '<div class="w-sites">' + chips + "</div>" +
      "</details></li>";
  }).join("");
}

/* ---------- origin-anchored: each site you opened, and who it told ---------- */
function renderVisits(visits, edges, strangers) {
  // fastest time-to-first-stranger per site, for the per-row readout
  const ttfs = new Map();
  if (strangers) for (const m of strangers.sites) ttfs.set(m.visit.domain, m);
  // per origin domain: last time seen, how many times, and which orgs fired
  const meta = new Map(); // domain -> { domain, lastTs, count }
  for (const v of visits) {
    const m = meta.get(v.domain) || { domain: v.domain, lastTs: 0, count: 0 };
    m.lastTs = Math.max(m.lastTs, v.ts);
    m.count += 1;
    meta.set(v.domain, m);
  }
  const orgsByOrigin = new Map(); // domain -> Map(org -> { cat, fp })
  for (const e of edges) {
    if (!orgsByOrigin.has(e.pageDomain)) orgsByOrigin.set(e.pageDomain, new Map());
    const at = orgsByOrigin.get(e.pageDomain);
    const cur = at.get(e.org) || { cat: e.category, fp: false };
    if (e.fingerprinting) cur.fp = true;
    at.set(e.org, cur);
  }

  const rows = [...meta.values()].sort((a, b) => b.lastTs - a.lastTs);
  document.getElementById("visits").innerHTML = rows.map((m) => {
    const orgs = orgsByOrigin.get(m.domain) || new Map();
    const chips = [...orgs.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([org, info]) => '<button type="button" class="org-chip ' + info.cat + (info.fp ? " fp" : "") +
        '" data-chain-org="' + esc(org) + '" title="' + esc(org) + (info.fp ? " — runs fingerprinting scripts" : "") +
        '. Click to follow its chain.">' + (info.fp ? '<span class="fp-dot"></span>' : "") + esc(org) + "</button>").join("");
    const times = m.count > 1 ? " \u00b7 visited " + m.count + "\u00d7" : "";
    const watchers = orgs.size ? orgs.size + (orgs.size === 1 ? " company" : " companies") : "nothing third-party";
    const s = ttfs.get(m.domain);
    const stranger = s
      ? '<p class="vr-stranger" title="Time to first ID-bearing request to a third-party org. ' +
        'The request firing means the ID was sent \u2014 not that it was logged server-side.">' +
        "On <b>" + esc(m.domain) + "</b>, <b>" + esc(s.org) + "</b> had a durable ID on you " +
        '<span class="vr-secs">' + fmtSecs(s.seconds) + "</span> after the page opened.</p>"
      : "";
    return '<li class="visit-row">' +
      '<div class="vr-head"><span class="vr-origin">' + esc(m.domain) + "</span>" +
      '<span class="vr-meta">' + watchers + " told" + times + "</span>" +
      '<span class="vr-time">' + fmtTime(m.lastTs) + "</span></div>" +
      stranger +
      '<div class="vr-orgs">' + (chips || '<span class="org-chip">no third parties fired</span>') + "</div>" +
      "</li>";
  }).join("");

  // seed the "how one visit works" explainer with the best real example
  let example = null, best = -1;
  for (const m of rows) {
    const orgs = orgsByOrigin.get(m.domain);
    if (orgs && orgs.size > best) { best = orgs.size; example = { domain: m.domain, orgs: [...orgs.entries()] }; }
  }
  renderHowTo(example);
}

/* ---------- explainer: how one page visit contacts many companies ---------- */
function renderHowTo(example) {
  const host = document.getElementById("howto");
  if (!host) return;
  if (!example || example.orgs.length === 0) { host.innerHTML = ""; return; }

  const domain = example.domain;
  const cos = example.orgs.slice(0, 3).map(([org, info]) => ({ org, cat: info.cat }));
  const n = cos.length;
  const catColor = { ad: "var(--amber)", analytics: "var(--peri)", social: "var(--violet)", cdn: "var(--muted)", other: "var(--ink-dim)" };

  const W = 880, H = 300;
  const youX = 92, siteX = 366, coX = 706;
  const coY = n === 1 ? [150] : n === 2 ? [108, 192] : [72, 150, 228];

  // step-3 flows drawn first (they pass behind the site + nodes)
  let flows3 = "", coNodes = "", badges = "";
  cos.forEach((c, i) => {
    const y = coY[i];
    flows3 += '<path class="flow s3" data-step="3" marker-end="url(#arw)" d="M' + (youX + 30) + " 150 Q " + siteX + " " + y + " " + (coX - 6) + " " + y + '"/>';
    coNodes += '<g class="node co" data-step="3" data-co="' + i + '">' +
      '<rect x="' + coX + '" y="' + (y - 21) + '" rx="8" width="150" height="42" fill="var(--panel-2)" stroke="' + catColor[c.cat] + '"/>' +
      '<circle cx="' + (coX + 16) + '" cy="' + y + '" r="4" fill="' + catColor[c.cat] + '"/>' +
      '<text x="' + (coX + 30) + '" y="' + (y + 4) + '" class="ht-co-label">' + esc(c.org.length > 14 ? c.org.slice(0, 13) + "\u2026" : c.org) + "</text></g>";
    badges += '<g class="badge" data-step="4" data-payload="' + i + '"><text x="' + (coX + 75) + '" y="' + (y + 34) + '" text-anchor="middle" class="ht-badge-tx">knows: page \u00b7 your IP \u00b7 cookie</text></g>';
  });

  const svg =
    '<svg viewBox="0 0 ' + W + " " + H + '" class="ht-svg">' +
    '<defs><marker id="arw" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">' +
    '<path d="M0,0 L6,3 L0,6 Z" fill="var(--amber)"/></marker></defs>' +
    flows3 +
    // step 1: you -> site
    '<path class="flow s1" data-step="1" marker-end="url(#arw)" d="M' + (youX + 30) + " 150 L " + (siteX - 66) + ' 150"/>' +
    // site (the page you opened) drawn over the flows
    '<g><rect x="' + (siteX - 62) + '" y="104" rx="10" width="124" height="92" fill="var(--panel)" stroke="var(--hair)"/>' +
    '<text x="' + siteX + '" y="99" class="ht-origin" text-anchor="middle">' + esc(domain) + "</text>" +
    '<text x="' + siteX + '" y="140" text-anchor="middle" class="ht-page-tx">the page</text>' +
    // embedded-tag squares appear at step 2
    '<g class="node" data-step="2">' +
    cos.map((c, i) => '<rect x="' + (siteX - 40 + i * 28) + '" y="156" width="18" height="18" rx="3" fill="' + catColor[c.cat] + '" opacity="0.85"/>').join("") +
    '<text x="' + siteX + '" y="188" text-anchor="middle" class="ht-tag-tx">hidden tags</text></g></g>' +
    // you (your browser) drawn on top
    '<g><rect x="' + (youX - 34) + '" y="128" rx="8" width="68" height="44" fill="var(--panel)" stroke="var(--teal)"/>' +
    '<text x="' + youX + '" y="154" text-anchor="middle" class="ht-you-tx">you</text>' +
    '<text x="' + youX + '" y="192" text-anchor="middle" class="ht-sub-tx">your browser</text></g>' +
    coNodes + badges +
    "</svg>";

  host.innerHTML =
    '<div class="ht-card">' +
      '<div class="ht-top"><span class="ht-title">How one visit works</span>' +
      '<button class="btn ghost-btn ht-replay">\u21ba Play again</button></div>' +
      svg +
      '<p class="ht-caption" id="ht-caption">\u2014</p>' +
      '<p class="ht-hint">Tap a company to see what its request carried.</p>' +
    "</div>";

  const captions = [
    "You open " + domain + " \u2014 your browser requests the page.",
    "The page comes back carrying hidden instructions to load content from other companies.",
    "Your browser obeys and contacts each one. That request reveals the page, your IP, and any cookie ID.",
    n + (n === 1 ? " company was" : " companies were") + " contacted \u2014 each now knows you opened " + domain + ". That's what \u201c" + n + (n === 1 ? " company" : " companies") + " told\u201d means."
  ];

  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const cap = document.getElementById("ht-caption");
  const stepEls = (nn) => host.querySelectorAll('[data-step="' + nn + '"]');
  let timers = [];
  function show(k) { stepEls(k).forEach((el) => el.classList.add("vis")); if (captions[k - 1]) cap.textContent = captions[k - 1]; }
  function reset() { timers.forEach(clearTimeout); timers = []; host.querySelectorAll("[data-step]").forEach((el) => el.classList.remove("vis")); host.querySelectorAll("[data-payload]").forEach((el) => el.classList.remove("open")); }
  function play() {
    reset();
    if (reduce) { [1, 2, 3, 4].forEach(show); return; }
    [1, 2, 3, 4].forEach((k, i) => timers.push(setTimeout(() => show(k), 150 + i * 850)));
  }
  host.querySelector(".ht-replay").addEventListener("click", play);
  host.querySelectorAll("[data-co]").forEach((g) => g.addEventListener("click", () => {
    const i = g.getAttribute("data-co");
    const b = host.querySelector('[data-payload="' + i + '"]');
    if (b) b.classList.toggle("vis");
  }));
  play();
}

/* ---------- stop it at the source: GPC + cookie blocking ---------- */
function renderPrevention() {
  document.getElementById("gpc-control").innerHTML =
    '<div class="gpc-card">' +
      '<div class="gpc-info">' +
        '<div class="gpc-head"><span class="gpc-title">Global Privacy Control</span>' +
        '<span class="gpc-badge">legally binding in ~12 states</span></div>' +
        '<p class="gpc-blurb">A Do-Not-Sell / Do-Not-Share signal sent on every request. Binding under California\u2019s CCPA and similar state laws \u2014 actively enforced, with fines up to $7,500 per violation. Trace can send it for you, right now.</p>' +
        '<p class="gpc-note">It stops future selling and sharing. It doesn\u2019t delete data they already hold, and it isn\u2019t a tracker blocker \u2014 pair it with cookie-blocking and the requests below.</p>' +
        '<p class="gpc-status" id="gpc-status">Checking\u2026</p>' +
      "</div>" +
      '<button class="switch" id="gpc-switch" role="switch" aria-checked="false" aria-label="Toggle Global Privacy Control"><span class="knob"></span></button>' +
    "</div>";

  document.getElementById("prevent-cards").innerHTML =
    '<div class="p-card">' +
      '<h3 class="p-title">Block third-party cookies</h3>' +
      '<p class="p-body">In 2026 Chrome still <em>doesn\u2019t</em> block third-party cookies for you \u2014 Google dropped that plan in 2025, so it\u2019s off unless you switch it on. This kills the cross-site cookie IDs that stitch your browsing into one profile.</p>' +
      '<button class="btn" id="open-cookie-settings">Open Chrome\u2019s cookie settings</button>' +
      '<p class="p-foot">Or switch to a browser that blocks them by default: Firefox, Brave, or Safari.</p>' +
    "</div>" +
    '<div class="p-card">' +
      '<h3 class="p-title">Go a layer deeper</h3>' +
      '<p class="p-body">Cookies are one channel. To cut trackers before they load at all:</p>' +
      '<ul class="p-list">' +
        '<li><a href="https://ublockorigin.com/" target="_blank" rel="noopener noreferrer">uBlock Origin</a> \u2014 blocks tracker and ad requests using community filter lists.</li>' +
        '<li><a href="https://nextdns.io/" target="_blank" rel="noopener noreferrer">NextDNS</a> \u2014 network-wide blocking that also covers your phone and TV, no hardware.</li>' +
      "</ul>" +
      '<p class="p-foot">Honest limit: none of this stops the first-party data you hand walled gardens directly, or fingerprinting from the signals above. Layers, not a silver bullet.</p>' +
    "</div>";

  syncGpc();
}

function setGpcUi(on) {
  const sw = document.getElementById("gpc-switch");
  const status = document.getElementById("gpc-status");
  if (!sw) return;
  sw.classList.toggle("on", on);
  sw.setAttribute("aria-checked", on ? "true" : "false");
  if (status) {
    status.textContent = on ? "On \u2014 sending your opt-out on every request." : "Off \u2014 you\u2019re not signaling an opt-out.";
    status.classList.toggle("on", on);
  }
}
function syncGpc() {
  try {
    chrome.runtime.sendMessage({ type: "getGpc" }, (res) => setGpcUi(res && res.enabled));
  } catch { setGpcUi(false); }
}

/* ---------- take it back: opt-outs + drafted requests ---------- */
function renderActions(followers) {
  document.getElementById("universal").innerHTML = UNIVERSAL.map((u, i) =>
    '<div class="u-card' + (i === 0 ? " lead" : "") + '">' +
      '<div class="u-top"><span class="u-title">' + esc(u.title) + "</span>" +
      '<span class="u-teeth ' + (i === 0 ? "strong" : "") + '">' + esc(u.teeth) + "</span></div>" +
      '<p class="u-blurb">' + esc(u.blurb) + "</p>" +
      '<a class="btn" href="' + esc(u.url) + '" target="_blank" rel="noopener noreferrer">Open</a>' +
    "</div>").join("");

  document.getElementById("actions").innerHTML = followers.map((f, i) => {
    const p = portalFor(f.org);
    const req = buildRequest(f.org, f.signals);
    const mailto = p.email
      ? "mailto:" + p.email + "?subject=" + encodeURIComponent(req.subject) + "&body=" + encodeURIComponent(req.body)
      : "";
    const has = f.signals.id
      ? '<span class="a-has id">holds a durable ID on you</span>'
      : '<span class="a-has">' + Object.keys(f.signals).filter((k) => SIGNAL_META[k] && SIGNAL_META[k].kind === "identity").length + " identity signals</span>";
    const portalLabel = p.curated ? "Opt-out portal" : "Find their portal";
    return '<div class="act-row" data-org="' + esc(f.org) + '">' +
      '<div class="a-main"><span class="a-name">' + esc(f.org) + "</span>" + has + "</div>" +
      '<div class="a-actions">' +
        '<a class="btn ghost-btn" href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer">' + portalLabel + "</a>" +
        '<button class="btn draft-toggle">Draft erasure request</button>' +
      "</div>" +
      (p.note ? '<p class="a-note">' + esc(p.note) + "</p>" : "") +
      '<div class="draft-panel">' +
        '<div class="d-subject">Subject: ' + esc(req.subject) + "</div>" +
        '<textarea class="d-body" readonly rows="16">' + esc(req.body) + "</textarea>" +
        '<div class="d-actions"><button class="btn copy-btn">Copy request</button>' +
        (mailto ? '<a class="btn ghost-btn" href="' + mailto + '">Open in email</a>' : "") +
        '<span class="copied" hidden>copied</span></div>' +
      "</div></div>";
  }).join("");
}

// one delegated listener for the whole action list
document.addEventListener("click", (e) => {
  // follow-chain selection: picker chips, watcher rows, per-visit org chips
  const pick = e.target.closest("[data-chain-org]");
  if (pick) {
    e.preventDefault();      // these live inside <summary>; don't toggle the row
    e.stopPropagation();
    showChain(pick.getAttribute("data-chain-org"), !pick.closest("#chain-picker"));
    return;
  }
  const gpc = e.target.closest("#gpc-switch");
  if (gpc) {
    const turningOn = !gpc.classList.contains("on");
    setGpcUi(turningOn); // optimistic
    const status = document.getElementById("gpc-status");
    if (status) status.textContent = "Applying\u2026";
    chrome.runtime.sendMessage({ type: "setGpc", on: turningOn }, (res) => setGpcUi(res ? res.enabled : turningOn));
    return;
  }
  if (e.target.closest("#open-cookie-settings")) {
    chrome.tabs.create({ url: "chrome://settings/cookies" });
    return;
  }
  const toggle = e.target.closest(".draft-toggle");
  if (toggle) {
    const panel = toggle.closest(".act-row").querySelector(".draft-panel");
    const open = panel.classList.toggle("open");
    toggle.textContent = open ? "Hide request" : "Draft erasure request";
    return;
  }
  const copy = e.target.closest(".copy-btn");
  if (copy) {
    const row = copy.closest(".act-row");
    const ta = row.querySelector(".d-body");
    const text = row.querySelector(".d-subject").textContent + "\n\n" + ta.value;
    navigator.clipboard.writeText(text).then(() => {
      const tag = row.querySelector(".copied");
      tag.hidden = false;
      setTimeout(() => { tag.hidden = true; }, 1600);
    }).catch(() => { ta.select(); document.execCommand("copy"); });
  }
});

load();
