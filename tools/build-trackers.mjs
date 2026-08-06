#!/usr/bin/env node
// build-trackers.mjs — regenerates data/trackers.json from DuckDuckGo Tracker Radar.
//
// Usage:
//   git clone --depth 1 https://github.com/duckduckgo/tracker-radar.git
//   node tools/build-trackers.mjs ./tracker-radar
//
// Tracker Radar ships one JSON file per domain per region (~49k files, ~100MB).
// We don't want that in the extension, so this flattens it to the three fields
// Trace actually renders:
//
//   { domain: [org, category, fingerprintingScore?] }
//
// fingerprintingScore is Radar's raw 0-3 "likelihood this domain is
// fingerprinting users", and is OMITTED when 0. Keeping the raw score rather
// than a boolean is deliberate: ~49% of Radar domains score >=1, so a boolean
// flattened at >=1 badges half the web and means nothing. lib/domains.js picks
// the badge threshold (currently >=2) and can move it without a rebuild.
//
// Regions are merged as a union — a tracker that only shows up in the GB crawl
// still follows you if you load a GB site. First region wins on conflicts,
// which only affects domains whose category differs by region (rare).

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "data", "trackers.json");

const radarRoot = resolve(process.argv[2] || "./tracker-radar");
const domainsRoot = join(radarRoot, "domains");
if (!existsSync(domainsRoot)) {
  console.error("No domains/ directory under " + radarRoot + "\n\n" +
    "  git clone --depth 1 https://github.com/duckduckgo/tracker-radar.git\n" +
    "  node tools/build-trackers.mjs ./tracker-radar\n");
  process.exit(1);
}

// Radar's category vocabulary -> Trace's five buckets, most-specific first.
// A domain carries several categories; the first bucket that matches wins, so
// order is the priority: an ad network that also serves a CDN reads as "ad".
const BUCKETS = [
  ["ad", ["Ad Motivated Tracking", "Advertising", "Action Pixels", "Ad Fraud"]],
  ["analytics", ["Analytics", "Third-Party Analytics Marketing", "Audience Measurement",
    "Session Replay", "Tag Manager"]],
  ["social", ["Social - Share", "Social Network", "Social - Comment", "Federated Login", "SSO"]],
  ["cdn", ["CDN"]]
];
const CAT_BUCKET = new Map();
for (const [bucket, cats] of BUCKETS) for (const c of cats) if (!CAT_BUCKET.has(c)) CAT_BUCKET.set(c, bucket);

function bucketFor(categories) {
  if (!categories || !categories.length) return "other";
  for (const [bucket] of BUCKETS) {
    for (const c of categories) if (CAT_BUCKET.get(c) === bucket) return bucket;
  }
  return "other";
}

const map = Object.create(null);
const regions = readdirSync(domainsRoot).sort();
let files = 0, skipped = 0;

for (const region of regions) {
  const dir = join(domainsRoot, region);
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const domain = file.slice(0, -5);
    if (map[domain]) continue;              // union across regions, first wins
    files++;
    let j;
    try { j = JSON.parse(readFileSync(join(dir, file), "utf8")); }
    catch { skipped++; continue; }

    const org = (j.owner && (j.owner.displayName || j.owner.name)) || domain;
    const entry = [org, bucketFor(j.categories)];
    const fp = Number(j.fingerprinting) || 0;
    if (fp > 0) entry.push(fp);             // 0 is the common case; omit to save ~200KB
    map[domain] = entry;
  }
}

const dist = { 0: 0, 1: 0, 2: 0, 3: 0 };
for (const d in map) dist[map[d][2] || 0]++;

const out = {
  _meta: {
    domains: Object.keys(map).length,
    generated: new Date().toISOString().slice(0, 10),
    source: "DuckDuckGo Tracker Radar",
    sourceUrl: "https://github.com/duckduckgo/tracker-radar",
    license: "Apache-2.0",
    regions,
    schema: "map[domain] = [org, category, fingerprintingScore?]  // score 0-3, omitted when 0",
    fingerprintingDistribution: dist
  },
  map
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
console.log("read " + files + " domain files across " + regions.length + " regions" +
  (skipped ? " (" + skipped + " unparseable, skipped)" : ""));
console.log("wrote " + Object.keys(map).length + " domains -> " + OUT);
console.log("fingerprinting score distribution: " + JSON.stringify(dist));
